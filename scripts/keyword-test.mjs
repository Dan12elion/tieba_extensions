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

/** 一个纯逻辑模块 → 一个可 import 的 ESM 包（与线上跑的是同一份代码） */
async function bundle(source, name) {
	const file = path.join(outDir, name);
	await esbuild.build({
		entryPoints: [path.join(projectRoot, source)],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: ["es2020"],
		outfile: file,
		nodePaths: [path.join(eztbRoot, "node_modules")],
		plugins: [createShimPlugin({ projectRoot, eztbRoot })],
		logLevel: "silent",
	});
	return import(pathToFileURL(file).href);
}

await bundle("src/core/composition.ts", "composition.mjs");
const postStats = await bundle("src/core/postStats.ts", "postStats.mjs");
const activityRule = await bundle("src/core/activityRule.ts", "activityRule.mjs");

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

// ── 「发帖所在吧」= 规则的第 6 列 ─────────────────────────────────────
console.log("发帖所在吧（规则第 6 列）");
{
	const rules = parseRules(
		[
			"🛒带货 | | | | | 拼多多,淘宝",
			"老规则 | 关键词 | 某个吧 | 排除词 | 1234567890",
			"尾分隔符的老规则 | 关键词 | 某个吧 | 排除词 | 1234567890 | ",
		].join("\n"),
	);

	check(
		"第 6 段解析成 postForumKeywords",
		rules[0].postForumKeywords.join(",") === "拼多多,淘宝",
		JSON.stringify(rules[0].postForumKeywords),
	);
	check(
		"老规则（5 段）的列序不变",
		rules[1].postKeywords.join(",") === "关键词" &&
			rules[1].forumKeywords.join(",") === "某个吧" &&
			rules[1].excludes.join(",") === "排除词" &&
			rules[1].uids.join(",") === "1234567890" &&
			rules[1].postForumKeywords.length === 0,
		JSON.stringify(rules[1]),
	);
	check(
		"老规则末尾多写一个分隔符也不会被误读成第 6 列",
		rules[2].excludes.join(",") === "排除词" &&
			rules[2].uids.join(",") === "1234567890" &&
			rules[2].postForumKeywords.length === 0,
		JSON.stringify(rules[2]),
	);
	check(
		"改第 6 列会让规则指纹变化（旧缓存自动失效）",
		hashRules("带货 | | | | | 拼多多") !== hashRules("带货 | | | | | 淘宝"),
	);

	const topicHit = matchComposition(
		{
			uid: "",
			forums: [],
			posts: [
				{
					title: "转卖这个",
					preview: "便宜出",
					kind: "topic",
					forumName: "拼多多吧",
				},
			],
		},
		parseRules("🛒带货 | | | | | 拼多多"),
	);
	check(
		"在他发过主题帖的吧命中，且算强证据",
		topicHit.length === 1 &&
			topicHit[0].sure &&
			topicHit[0].evidences.some((item) => item.source === "postForum"),
		topicHit[0]?.summary ?? "没有命中",
	);

	const replyOnly = matchComposition(
		{
			uid: "",
			forums: [],
			posts: [
				{
					title: "回复：求推荐",
					preview: "我也买过",
					kind: "reply",
					forumName: "拼多多吧",
				},
			],
		},
		parseRules("🛒带货 | | | | | 拼多多"),
	);
	check(
		"只在回复里出现该吧 → 命中但只是弱证据",
		replyOnly.length === 1 && !replyOnly[0].sure,
		replyOnly[0]?.summary ?? "没有命中",
	);

	const excluded = matchComposition(
		{
			uid: "",
			forums: [],
			posts: [
				{
					title: "转卖这个",
					preview: "便宜出",
					kind: "topic",
					forumName: "拼多多吧",
				},
			],
		},
		parseRules("🛒带货 | | | 拼多多吧 | | 拼多多"),
	);
	check("排除词对「发帖所在吧」同样生效", excluded.length === 0, "仍然命中");

	const untouched = matchComposition(
		{
			uid: "",
			forums: ["拼多多吧"],
			posts: [
				{ title: "t", preview: "p", kind: "topic", forumName: "别的吧" },
			],
		},
		parseRules("🛒带货 | | | | | 拼多多"),
	);
	check(
		"关注了吧但没在那儿发过帖：第 6 列不命中",
		untouched.length === 0,
		untouched[0]?.summary ?? "没有命中",
	);
}

// ── 占比饼图：按"发帖都发在哪些吧"统计（纯计算，边界比图形更值得钉）──
console.log("按吧统计的占比饼图");
{
	const {
		countPostsByForum,
		mergeForumCounts,
		totalForumCount,
		buildForumSlices,
		buildForumPieSvg,
	} = postStats;

	const counts = countPostsByForum([
		{ forumName: "百度" },
		{ forumName: "百度" },
		{ forumName: "小红书" },
		{ forumName: "" },
	]);
	check(
		"按吧计数，空吧名不计入",
		counts["百度"] === 2 && counts["小红书"] === 1 &&
			Object.keys(counts).length === 2,
		JSON.stringify(counts),
	);
	check(
		"两批行可以累加（两路 feed / 翻页时用）",
		totalForumCount(
			mergeForumCounts({ 百度: 1 }, { 百度: 1, 小红书: 2 }),
		) === 4 &&
			mergeForumCounts({ 百度: 1 }, { 百度: 1 })["百度"] === 2,
	);

	const slices = buildForumSlices({ 百度: 3, 小红书: 1 });
	check(
		"扇段按条数从多到少，百分比保留一位小数",
		slices[0].label === "百度" && slices[0].percentText === "75.0%" &&
			slices[1].percentText === "25.0%",
		slices.map((item) => `${item.label}=${item.percentText}`).join(" / "),
	);
	check(
		"占比之和为 1",
		Math.abs(slices.reduce((sum, item) => sum + item.fraction, 0) - 1) < 1e-9,
	);

	check(
		"吧太多时只画前几个，剩下的合成「其它 N 个吧」",
		(function () {
			const many = {};
			for (let i = 1; i <= 9; i += 1) many[`吧${i}`] = 10 - i;
			const list = buildForumSlices(many, 5);
			const last = list[list.length - 1];
			return list.length === 6 && last.forum === null &&
				last.label === "其它 4 个吧" && last.count === 1 + 2 + 3 + 4;
		})(),
		JSON.stringify(buildForumSlices(
			Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`吧${i + 1}`, 9 - i])),
			5,
		).map((item) => item.label)),
	);

	check(
		"一个吧都没有时占比是 0（不会算出 NaN）",
		buildForumSlices({}).length === 0 &&
			buildForumPieSvg({}).includes("还没有加载到发帖记录"),
	);

	const circumference = 2 * Math.PI * 46;
	const oneForum = buildForumPieSvg({ 百度: 60 });
	check(
		"只有一个吧时只画一段（不会因为起终点重合而崩）",
		(oneForum.match(/class="tb-eztb-pie-slice"/g) ?? []).length === 1 &&
			!oneForum.includes("NaN"),
	);

	const manyForums = buildForumPieSvg({ 百度: 60, 小红书: 30, 贴吧: 10 });
	const dash = Array.from(
		manyForums.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g),
	);
	const lens = dash.map((item) => Number(item[1]));
	check(
		"各段弧长加起来等于整圈（不重不漏）",
		dash.length === 3 &&
			Math.abs(lens.reduce((sum, value) => sum + value, 0) - circumference) < 1,
		`${dash.length} 段 / 合计 ${lens.reduce((sum, value) => sum + value, 0).toFixed(2)} / 整圈 ${circumference.toFixed(2)}`,
	);
	check(
		"图例写了吧名、条数与百分比",
		manyForums.includes("小红书") && manyForums.includes("10.0%") &&
			manyForums.includes("已加载 100 条 · 3 个吧") &&
			!manyForums.includes("NaN"),
	);
	check(
		"吧名会被转义（吧名里可能带引号/尖括号）",
		buildForumPieSvg({ '"><img src=x>吧': 1 }).includes("&quot;&gt;&lt;img"),
	);
}

// ── 发帖行的副标题：楼中楼必须标出「回复了谁」 ────────────────────────
console.log("发帖行副标题（回复正文与楼中楼的回复对象）");
{
	const { postRowSubParts } = postStats;
	const hasReplyTo = (parts) =>
		parts.some((part) => part.includes('class="tb-eztb-row-replyto"'));

	const subWithTo = postRowSubParts({
		kind: "sub",
		forumName: "小红书",
		replyTo: "张三",
		preview: "好的",
	});
	check(
		"楼中楼标出了回复对象",
		hasReplyTo(subWithTo) && subWithTo.join(" ").includes("张三"),
		subWithTo.join(" "),
	);
	check(
		"楼中楼仍然显示自己的正文",
		subWithTo.some((part) => part.includes("好的")),
	);
	check(
		"副标题里带了吧名标签",
		subWithTo.some((part) => part.includes('class="tb-eztb-row-forum"')),
	);
	check(
		"普通回复不标「回复对象」（发帖 feed 里没有这个字段）",
		!hasReplyTo(
			postRowSubParts({ kind: "reply", forumName: "百度", preview: "嗯" }),
		),
	);
	check(
		"主题帖不标「回复对象」",
		!hasReplyTo(
			postRowSubParts({ kind: "topic", forumName: "百度", preview: "正文" }),
		),
	);
	check(
		"楼中楼没给回复对象时就不标（可能在回楼主，接口不给 replyTo）",
		!hasReplyTo(
			postRowSubParts({ kind: "sub", forumName: "百度", preview: "在回楼主" }),
		),
	);
	check(
		"回复对象按文本转义，不会注入 HTML",
		hasReplyTo(postRowSubParts({ kind: "sub", replyTo: "<b>&</b>" })) &&
			postRowSubParts({ kind: "sub", replyTo: "<b>&</b>" })[0].includes(
				"&lt;b&gt;&amp;&lt;/b&gt;",
			),
		postRowSubParts({ kind: "sub", replyTo: "<b>&</b>" })[0],
	);
}

// ── 签到号判定（等级高但几乎不发言） ──────────────────────────────────
console.log("签到号判定");
{
	const { countPostsByForum, findSignInForums, signInSummary } = activityRule;

	check(
		"按吧统计发言条数，空吧名不计入",
		JSON.stringify(countPostsByForum([
			{ forumName: "百度" },
			{ forumName: "百度" },
			{ forumName: "" },
			{ forumName: "贴吧" },
		])) === JSON.stringify({ 百度: 2, 贴吧: 1 }),
	);

	const forums = [
		{ name: "百度", level: 12 },
		{ name: "贴吧", level: 12 },
		{ name: "原神" },
		{ name: "冷吧", level: 2 },
	];
	const byForum = { 百度: 0, 贴吧: 5, 原神: 0, 冷吧: 0 };
	const candidates = findSignInForums(forums, byForum, 6);
	check(
		"只挑「等级达标 + 该吧 0 条发言」",
		candidates.length === 1 && candidates[0].forumName === "百度",
		JSON.stringify(candidates),
	);
	check(
		"没有等级的吧不参与判断（未知不等于达标）",
		!candidates.some((item) => item.forumName === "原神"),
	);
	check(
		"提高门槛后原来的候选不再算",
		findSignInForums(forums, byForum, 13).length === 0,
	);

	const text = signInSummary(candidates, 6, { topics: 60, replies: 60 });
	check(
		"结论里写明了判定条件与样本大小（不许说成「从来不发言」）",
		text.includes("Lv.12") &&
			text.includes("≥ 6") &&
			text.includes("主题帖 60 条") &&
			text.includes("回复 60 条"),
		text,
	);
	check(
		"没有候选时也给一句明确的话",
		signInSummary([], 6, { topics: 0, replies: 0 }).includes("没有发现"),
	);
}

console.log(failures === 0 ? "\n关键词逻辑全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
