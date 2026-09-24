// 「成分」关键词规则的离线测试。
//
// 规则解析与匹配全是纯逻辑，不需要 BDUSS、不碰网络，所以单独用一个脚本把它们钉死。
// 用 esbuild 打包真实的 src/core/composition.ts（与线上跑的是同一份代码）。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createShimPlugin, DEFAULT_EZTB_ROOT } from "./shims-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eztbRoot = process.env.EZTB_ROOT ?? DEFAULT_EZTB_ROOT;

const require = createRequire(import.meta.url);
const esbuild = require(path.join(eztbRoot, "node_modules/esbuild"));

const outDir = path.join(projectRoot, "dist/.verify");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "composition.mjs");
await esbuild.build({
	entryPoints: [path.join(projectRoot, "src/core/composition.ts")],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: ["es2020"],
	outfile: outFile,
	nodePaths: [path.join(eztbRoot, "node_modules")],
	plugins: [createShimPlugin({ projectRoot, eztbRoot })],
	logLevel: "silent",
});

const {
	parseRules,
	matchComposition,
	hashRules,
	highlightKeywords,
	excerptAround,
} = await import(pathToFileURL(outFile).href);

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// ── 规则解析 ──────────────────────────────────────────────────────────
console.log("规则解析");
{
	const rules = parseRules(
		[
			"# 这是注释",
			"",
			"🎮原神 | 原神, 芙宁娜,米哈游 | 原神吧,米哈游吧 | 原神怎么你了",
			"🎁抽奖 | 互动抽奖 #原神, 转发本条动态",
			"⚠️名单 | | | | 1234567890",
			"只有名字",
			"🎮原神 | 会被去重丢掉",
		].join("\n"),
	);

	check("注释与空行被忽略，同名只保留第一条", rules.length === 3, `共 ${rules.length} 条`);
	check("只有名称没有条件的行被忽略", !rules.some((rule) => rule.name === "只有名字"));
	check(
		"五个字段各自解析到对应位置",
		rules[0].name === "🎮原神" &&
			rules[0].postKeywords.join(",") === "原神,芙宁娜,米哈游" &&
			rules[0].forumKeywords.join(",") === "原神吧,米哈游吧" &&
			rules[0].excludes.join(",") === "原神怎么你了",
		JSON.stringify(rules[0]),
	);
	check(
		"省略后三段不影响解析",
		rules[1].name === "🎁抽奖" &&
			rules[1].forumKeywords.length === 0 &&
			rules[1].uids.length === 0,
		JSON.stringify(rules[1]),
	);
	check(
		"关键词里的空格不会被切开（参考脚本里有「互动抽奖 #原神」这种词）",
		rules[1].postKeywords.includes("互动抽奖 #原神"),
		JSON.stringify(rules[1].postKeywords),
	);
	check(
		"只有名单的规则也能成立",
		rules[2].uids.join(",") === "1234567890" && rules[2].postKeywords.length === 0,
		JSON.stringify(rules[2]),
	);
}

// ── 规则指纹 ──────────────────────────────────────────────────────────
console.log("规则指纹");
{
	const a = hashRules("原神 | 原神 | 原神吧");
	const b = hashRules("# 注释\n原神    |   原神    |   原神吧\n");
	const c = hashRules("原神 | 崩坏 | 原神吧");
	check("只改空白/注释不影响指纹", a === b, `${a} vs ${b}`);
	check("改了关键词就换指纹", a !== c, `${a} vs ${c}`);
}

// ── 匹配 ──────────────────────────────────────────────────────────────
console.log("命中判定");
const rules = parseRules(
	[
		"🎮原神 | 原神,芙宁娜 | 原神吧 | 原神怎么你了",
		"🎁抽奖 | 互动抽奖 | ",
		"⚠️名单 | | | | 1234567890",
	].join("\n"),
);
const listed = rules[2];

{
	const hits = matchComposition(
		{ uid: null, userId: 111, forums: ["原神吧", "崩坏3rd吧"], posts: [] },
		rules,
	);
	check("关注了规则里的吧 → 命中", hits.length === 1, `命中 ${hits.length} 条`);
	check(
		"吧命中的证据是强证据，原因里带吧名",
		hits[0]?.sure === true && hits[0].summary.includes("原神吧"),
		hits[0]?.summary,
	);
}

{
	const hits = matchComposition(
		{
			userId: 111,
			forums: [],
			posts: [
				{ title: "【讨论】原神这个活动怎么打", preview: "如题", kind: "topic" },
			],
		},
		rules,
	);
	check(
		"主题帖命中关键词 → 强证据",
		hits.length === 1 && hits[0].sure === true,
		JSON.stringify(hits[0]?.evidences),
	);
	check(
		"证据里带命中的关键词与截取到的原文",
		hits[0]?.evidences[0]?.keyword === "原神" &&
			hits[0].evidences[0].excerpt.includes("原神"),
		hits[0]?.evidences[0]?.excerpt,
	);
	check(
		"大小写不敏感（英文关键词）",
		matchComposition(
			{
				userId: 1,
				forums: [],
				posts: [{ title: "Genshin", preview: "", kind: "topic" }],
			},
			parseRules("游戏 | genshin"),
		).length === 1,
	);
}

{
	const hits = matchComposition(
		{
			userId: 111,
			forums: [],
			posts: [{ title: "回复：原神好玩吗", preview: "", kind: "reply" }],
		},
		rules,
	);
	check(
		"只在回复里出现 → 弱证据（界面上会提示可能是误判）",
		hits.length === 1 && hits[0].sure === false,
		JSON.stringify(hits[0]?.evidences),
	);
}

{
	const hits = matchComposition(
		{
			userId: 111,
			forums: [],
			posts: [
				{ title: "回复：原神", preview: "", kind: "reply" },
				{ title: "原神萌新报道", preview: "", kind: "topic" },
			],
		},
		rules,
	);
	check(
		"同时有主题帖和回复时取主题帖那条（强证据优先）",
		hits.length === 1 && hits[0].sure === true && hits[0].evidences.length === 1,
		JSON.stringify(hits[0]?.evidences),
	);
}

{
	const mixed = matchComposition(
		{
			userId: 111,
			forums: ["原神吧"],
			posts: [{ title: "原神怎么你了", preview: "", kind: "topic" }],
		},
		rules,
	);
	check(
		"排除词命中 → 这条发帖证据不算数",
		mixed.length === 1 && mixed[0].evidences.every((e) => e.source === "forum"),
		JSON.stringify(mixed[0]?.evidences),
	);
	check(
		"只有被排除的内容 → 不命中",
		matchComposition(
			{
				userId: 111,
				forums: [],
				posts: [{ title: "原神怎么你了", preview: "", kind: "topic" }],
			},
			rules,
		).length === 0,
	);
}

{
	const hits = matchComposition({ userId: 1234567890, forums: [], posts: [] }, rules);
	check(
		"名单命中（不需要任何请求）",
		hits.length === 1 && hits[0].rule.name === listed.name,
		JSON.stringify(hits[0]?.evidences),
	);
	check(
		"名单里的数字按字符串比对，不会因为类型不同而漏掉",
		hits[0]?.evidences[0]?.keyword === "1234567890",
		hits[0]?.evidences[0]?.keyword,
	);
}

{
	const both = matchComposition(
		{
			userId: 111,
			forums: ["原神吧"],
			posts: [{ title: "今天抽卡出了芙宁娜", preview: "", kind: "topic" }],
		},
		rules,
	);
	check(
		"同一条规则的吧证据与发帖证据合并成一个命中（不会变成两个徽章）",
		both.length === 1 && both[0].evidences.length === 2,
		JSON.stringify(both[0]?.evidences.map((e) => e.source)),
	);
	check(
		"命中顺序与规则表一致",
		matchComposition(
			{
				userId: 1234567890,
				forums: ["原神吧"],
				posts: [{ title: "互动抽奖", preview: "", kind: "topic" }],
			},
			rules,
		)
			.map((hit) => hit.rule.name)
			.join(" > ") === rules.map((rule) => rule.name).join(" > "),
	);
	check(
		"互不相关的用户不会命中",
		matchComposition(
			{
				userId: 999,
				forums: ["摄影吧"],
				posts: [{ title: "今天天气不错", preview: "", kind: "topic" }],
			},
			rules,
		).length === 0,
	);
	check(
		"规则表为空时永远不命中",
		matchComposition({ userId: 1, forums: ["原神吧"], posts: [] }, parseRules(""))
			.length === 0,
	);
	check("没有条件只有名称的规则会被解析阶段丢掉", parseRules("空壳 | | | ").length === 0);
}

// ── 高亮 ──────────────────────────────────────────────────────────────
console.log("高亮与截取");
{
	const html = highlightKeywords("我在原神里抽到了芙宁娜", ["原神", "芙宁娜"]);
	check(
		"命中的关键词被包成 mark",
		html ===
			'我在<mark class="tb-eztb-mark">原神</mark>里抽到了<mark class="tb-eztb-mark">芙宁娜</mark>',
		html,
	);

	const unsafe = highlightKeywords('<img src=x onerror="alert(1)"> 原神', ["原神"]);
	check(
		"高亮时先转义：被检测的内容不会变成可执行 HTML",
		!unsafe.includes("<img") && unsafe.includes("&lt;img"),
		unsafe,
	);

	check(
		"重叠的关键词只包一次",
		highlightKeywords("aaa", ["aa", "aaa"]) ===
			'<mark class="tb-eztb-mark">aaa</mark>',
		highlightKeywords("aaa", ["aa", "aaa"]),
	);

	check(
		"没有关键词时只做转义",
		highlightKeywords("<b>", []) === "&lt;b&gt;",
		highlightKeywords("<b>", []),
	);

	const excerpt = excerptAround(
		"前面一些无关的话再往后一点点到了这里才是原神相关的内容后面还有",
		"原神",
		5,
	);
	check(
		"截取命中位置前后并带省略号",
		excerpt.includes("原神") && excerpt.startsWith("…") && excerpt.endsWith("…"),
		excerpt,
	);
}

console.log(failures === 0 ? "\n关键词逻辑全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
