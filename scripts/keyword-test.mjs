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
const panelTabs = await bundle("src/core/panelTabs.ts", "panelTabs.mjs");
// 错误码翻译与请求策略都是纯逻辑（后者用注入的时钟），一起在这里钉住
const errno = await bundle("src/core/errno.ts", "errno.mjs");
const netPolicy = await bundle("src/core/netPolicy.ts", "netPolicy.mjs");
const mutual = await bundle("src/core/mutualFollows.ts", "mutualFollows.mjs");
// 证据行 HTML（类型标签 / 时间 / 跳转 / 查楼层）也是纯逻辑，直接钉死
const evidenceHtml = await bundle("src/core/evidenceHtml.ts", "evidenceHtml.mjs");

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
		"按吧计数；空吧名归到「未知贴吧」（不丢条数）",
		counts["百度"] === 2 && counts["小红书"] === 1 &&
			counts["未知贴吧"] === 1 && Object.keys(counts).length === 3,
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

	// 用户 2026-09-27：有些用户"其它"占比很大，需要能展开看每一个吧
	const { buildForumStats, buildForumListHtml } = postStats;
	const stats = buildForumStats({ 百度: 6, 小红书: 3, 未知贴吧: 1 });
	check(
		"全部吧的列表：按条数排序、占比按总条数算",
		stats.length === 3 && stats[0].forum === "百度" &&
			stats[0].percentText === "60.0%" && stats[2].percentText === "10.0%",
		stats.map((item) => `${item.forum}=${item.percentText}`).join(" / "),
	);
	check(
		"列表里包含「其它 N 个吧」里的那些吧（不聚合、一个不落）",
		(function () {
			const many = {};
			for (let i = 1; i <= 8; i += 1) many[`吧${i}`] = i;
			const pie = buildForumPieSvg(many, 5);
			const list = buildForumListHtml(many, true);
			return pie.includes("其它 3 个吧") &&
				list.includes("共 8 个吧 · 36 条发言") &&
				[1, 2, 3, 4, 5, 6, 7, 8].every((i) => list.includes(`吧${i}`));
		})(),
		buildForumListHtml({ 吧1: 1, 吧2: 2, 吧3: 3, 吧4: 4, 吧5: 5, 吧6: 6, 吧7: 7, 吧8: 8 }, true).slice(0, 260),
	);
	check(
		"收起状态只给按钮，不给列表",
		buildForumListHtml({ 百度: 2, 贴吧: 1 }, false).includes("查看全部 2 个吧的占比") &&
			!buildForumListHtml({ 百度: 2, 贴吧: 1 }, false).includes("tb-eztb-pielist\"") &&
			buildForumListHtml({ 百度: 2, 贴吧: 1 }, true).includes("收起"),
	);
	check(
		"只有一个吧时不给按钮（图例已经列全了）",
		buildForumListHtml({ 百度: 5 }, false) === "",
	);
	check(
		"列表里的吧名同样要转义",
		buildForumListHtml({ "<b>吧": 1, "正常吧": 1 }, true).includes("&lt;b&gt;吧"),
	);

	// 用户 2026-09-27 第二次反馈：「初次点进时饼图有时只统计了主题帖」。
	// 回复那一页要按吧反查吧名（串行限速），冷启动时比主题帖晚好几秒才到；
	// 在它回来之前饼图只有主题帖的段，看起来却和完整的一样。
	const { buildPieNotes } = postStats;
	check(
		"两路都到齐（且都没失败）时不加任何提示",
		buildPieNotes([{ label: "主题帖" }, { label: "回复" }]) === "",
		buildPieNotes([{ label: "主题帖" }, { label: "回复" }]),
	);
	check(
		"回复还没回来时，图上要写明「还在加载 / 还不完整」（不能说成完整结果）",
		(function () {
			const html = buildPieNotes([{ label: "主题帖" }, { label: "回复", loading: true }]);
			return (
				html.includes("tb-eztb-pie-pending") &&
				html.includes("回复") &&
				html.includes("还不完整") &&
				!html.includes("主题帖」的数据还在加载")
			);
		})(),
		buildPieNotes([{ label: "主题帖" }, { label: "回复", loading: true }]),
	);
	check(
		"某一路取数失败：写明缺的是哪一路，且错误文本要转义",
		(function () {
			const html = buildPieNotes([{ label: "主题帖", error: "<b>炸了</b>" }]);
			return (
				html.includes("tb-eztb-warn") &&
				html.includes("主题帖") &&
				html.includes("饼图里缺这一路的条数") &&
				html.includes("&lt;b&gt;") &&
				!html.includes("<b>炸了</b>")
			);
		})(),
		buildPieNotes([{ label: "主题帖", error: "<b>炸了</b>" }]),
	);
	// 复查时发现的措辞问题：某一路"第一页成功、翻后面某页失败"时，
	// 饼图里**已经有**它前面那几页的条数，再说"饼图里缺这一路的条数"就是错的。
	check(
		"已经取到过这一路的行、只是后续页失败：措辞要改成「后续页没取到」，不能说成整路都缺",
		(function () {
			const html = buildPieNotes([
				{ label: "主题帖" },
				{ label: "回复", error: "网络错误", hasRows: true },
			]);
			return (
				html.includes("后续页没取到") &&
				html.includes("只统计到已经加载出来的那部分") &&
				!html.includes("饼图里缺这一路的条数")
			);
		})(),
		buildPieNotes([{ label: "回复", error: "网络错误", hasRows: true }]),
	);
	check(
		"同一路同时标着 loading 与 error 时只报「还在加载」（不叠两条自相矛盾的提示）",
		(function () {
			const html = buildPieNotes([{ label: "回复", loading: true, error: "boom" }]);
			return html.includes("tb-eztb-pie-pending") && !html.includes("tb-eztb-warn");
		})(),
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
		"按吧统计发言条数；吧名没解析出来的行归到「未知贴吧」，不丢条数",
		JSON.stringify(countPostsByForum([
			{ forumName: "百度" },
			{ forumName: "百度" },
			{ forumName: "" },
			{ forumName: "贴吧" },
		])) === JSON.stringify({ 百度: 2, 未知贴吧: 1, 贴吧: 1 }),
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

// ── 「发帖」页签里的按吧筛选 / 内容搜索 / 合并视图 ────────────────────
console.log("筛选与搜索");
{
	const {
		buildForumFilterOptionsHtml,
		buildPostFilterHint,
		buildSearchAllSummary,
		postMatchesQuery,
		mergePostRows,
	} = postStats;

	const options = buildForumFilterOptionsHtml(
		{ 百度: 2, 贴吧: 1, 未知贴吧: 3 },
		"",
	);
	check(
		"下拉框：第一项是「全部吧」且默认选中，其余按条数从多到少",
		options.startsWith('<option value="" selected>全部吧</option>') &&
			options.indexOf("未知贴吧（3）") < options.indexOf("百度（2）") &&
			options.indexOf("百度（2）") < options.indexOf("贴吧（1）"),
		options,
	);
	check(
		"下拉框：能把当前选中的吧还原成 selected（重建选项后不会跳回全部吧）",
		buildForumFilterOptionsHtml({ 百度: 1, 贴吧: 1 }, "贴吧").includes(
			'<option value="贴吧" selected>贴吧（1）</option>',
		),
		buildForumFilterOptionsHtml({ 百度: 1, 贴吧: 1 }, "贴吧"),
	);
	check(
		"下拉框：吧名转义（吧名来自页面数据，不能拼进 HTML）",
		buildForumFilterOptionsHtml({ '"><img src=x>吧': 1 }, "").includes(
			"&quot;&gt;&lt;img",
		),
		buildForumFilterOptionsHtml({ '"><img src=x>吧': 1 }, ""),
	);
	check(
		"提示：只看某个吧时给出主题帖 / 回复的条数",
		buildPostFilterHint({
			forum: "百度",
			query: "",
			matched: { topic: 3, reply: 5 },
			loadedTotal: 60,
		}) === "筛选「百度」：主题帖 3 个 · 回复 5 条",
		buildPostFilterHint({
			forum: "百度",
			query: "",
			matched: { topic: 3, reply: 5 },
			loadedTotal: 60,
		}),
	);
	check(
		"提示：这个吧一条都没有时要明说，而不是显示 0 条",
		buildPostFilterHint({
			forum: "百度",
			query: "",
			matched: { topic: 0, reply: 0 },
			loadedTotal: 12,
		}) === "筛选「百度」：该用户在这个吧没有发帖或回复",
	);
	check(
		"提示：只搜索时写明搜索词与命中条数",
		buildPostFilterHint({
			forum: "",
			query: "原神",
			matched: { topic: 1, reply: 2 },
			loadedTotal: 60,
		}) === "搜索「原神」：主题帖 1 个 · 回复 2 条",
	);
	check(
		"提示：搜索没命中时说清是「已加载的 N 条里没有命中」，不能说成「他没发过」",
		buildPostFilterHint({
			forum: "",
			query: "原神",
			matched: { topic: 0, reply: 0 },
			loadedTotal: 60,
		}) === "搜索「原神」：已加载的 60 条里没有命中",
	);
	check(
		"提示：筛选与搜索同时有时，两个条件都写出来",
		buildPostFilterHint({
			forum: "百度",
			query: "原神",
			matched: { topic: 1, reply: 0 },
			loadedTotal: 60,
		}) === "筛选「百度」+ 搜索「原神」：主题帖 1 个 · 回复 0 条",
	);
	check(
		"提示：既不筛也不搜时返回空串，界面上不留一行废话",
		buildPostFilterHint({
			forum: "",
			query: "",
			matched: { topic: 9, reply: 9 },
			loadedTotal: 18,
		}) === "",
	);
	check(
		"搜索：标题或正文命中即可，大小写不敏感、首尾空白忽略",
		postMatchesQuery({ title: "关于原神", preview: "" }, " 原神 ") === true &&
			postMatchesQuery({ title: "", preview: "今天聊 Java" }, "java") ===
				true &&
			postMatchesQuery({ title: "原神", preview: "" }, "星铁") === false,
	);
	check(
		"搜索：空搜索词一律算命中（等于没筛）",
		postMatchesQuery({ title: "原神", preview: "" }, "   ") === true,
	);
	check(
		"合并：主题帖与回复按时间倒序合成一个列表",
		(function () {
			const rows = mergePostRows(
				[
					{ kind: "topic", createTime: 30 },
					{ kind: "topic", createTime: 10 },
				],
				[{ kind: "reply", createTime: 20 }],
			);
			return rows.map((row) => row.createTime).join(",") === "30,20,10";
		})(),
	);
	check(
		"合并：时间相同也不丢行（稳定排序，主题帖排在前面）",
		(function () {
			const rows = mergePostRows(
				[{ kind: "topic", createTime: 5 }],
				[{ kind: "reply", createTime: 5 }],
			);
			return rows.length === 2 && rows[0].kind === "topic";
		})(),
	);

	// 「搜全部」的结论（把没加载的页也翻完之后再说话）
	check(
		"搜全部结论：翻完时说清翻了几页、看了多少条、命中多少",
		buildSearchAllSummary({
			query: "原神",
			pages: { topic: 3, reply: 1 },
			loaded: { topic: 180, reply: 12 },
			matched: { topic: 4, reply: 1 },
			complete: true,
			pageLimit: 50,
		}) ===
			"搜索「原神」：已翻完主题帖 3 页、回复 1 页，共 192 条，命中 5 条（主题帖 4 · 回复 1）。",
		buildSearchAllSummary({
			query: "原神",
			pages: { topic: 3, reply: 1 },
			loaded: { topic: 180, reply: 12 },
			matched: { topic: 4, reply: 1 },
			complete: true,
			pageLimit: 50,
		}),
	);
	check(
		"搜全部结论：到上限停了必须说「还有更早的没加载」，不能装作翻完了",
		buildSearchAllSummary({
			query: "原神",
			pages: { topic: 3, reply: 3 },
			loaded: { topic: 180, reply: 180 },
			matched: { topic: 1, reply: 0 },
			complete: false,
			pageLimit: 3,
		}).includes("翻到上限（每路最多 3 页）时仍有更早的没加载"),
	);
	check(
		"搜全部结论：一条都没命中时明说「没有命中」，不给「他没发过」这种结论",
		buildSearchAllSummary({
			query: "原神",
			pages: { topic: 2, reply: 1 },
			loaded: { topic: 120, reply: 12 },
			matched: { topic: 0, reply: 0 },
			complete: true,
			pageLimit: 50,
		}).includes("共 132 条，没有命中"),
	);
}

// ── 页签注册表（设置里的「默认打开页签」） ────────────────────────────
console.log("页签注册表");
{
	const { PANEL_TABS, DEFAULT_PANEL_TAB, normalizePanelTabId } = panelTabs;
	check(
		"六个页签的 id 与标签都齐（面板、设置、存储共用这一份）",
		PANEL_TABS.length === 7 &&
			PANEL_TABS.map((tab) => tab.id).join(",") ===
				"profile,composition,follow,mutual,forums,fans,posts",
		JSON.stringify(PANEL_TABS),
	);
	check(
		"「共同关注」排在「关注的人」后面（同一个话题挨着）",
		PANEL_TABS[3].id === "mutual" && PANEL_TABS[3].label === "共同关注",
		JSON.stringify(PANEL_TABS.map((tab) => tab.label)),
	);
	check(
		"默认页签是「资料」",
		DEFAULT_PANEL_TAB === "profile" &&
			PANEL_TABS[0].id === "profile" &&
			PANEL_TABS[0].label === "资料",
	);
	check(
		"非法值一律退回默认页签（存储里的旧值 / 手改的导入 JSON 都不能把面板打开成空白）",
		normalizePanelTabId("nope") === "profile" &&
			normalizePanelTabId(undefined) === "profile" &&
			normalizePanelTabId(123) === "profile" &&
			normalizePanelTabId("fans") === "fans",
	);
}

// ── 贴吧错误码翻译 ────────────────────────────────────────────────────
console.log("贴吧错误码翻译");
{
	const {
		KNOWN_ERRNO,
		formatServerError,
		describeRequestError,
		recentUnknownErrno,
		clearUnknownErrno,
		recordUnknownErrno,
	} = errno;

	check(
		"已实测过的码给出人话说明，并带上错误码与贴吧自己的 errmsg",
		formatServerError(300000, "服务繁忙").includes("300000") &&
			formatServerError(300000, "服务繁忙").includes("服务繁忙") &&
			formatServerError(300000, "服务繁忙").includes(KNOWN_ERRNO[300000].hint) &&
			!formatServerError(300000, "服务繁忙").includes("未收录"),
		formatServerError(300000, "服务繁忙"),
	);
	check(
		"每个收录的码都必须写明出处（不许凭空猜含义）",
		Object.values(KNOWN_ERRNO).every(
			(note) => typeof note.observed === "string" && note.observed.length > 10,
		),
	);
	check(
		"没见过的码原样显示，并标明未收录",
		formatServerError(123456, "") ===
			"贴吧接口返回错误 123456（贴吧没有给出说明文字）（未收录的错误码，已记进诊断日志）",
		formatServerError(123456, ""),
	);

	clearUnknownErrno();
	check("没有遇到未收录的码时缓冲是空的", recentUnknownErrno().length === 0);
	describeRequestError({ code: 999999, msg: "?" }, "主题帖");
	const unknown = recentUnknownErrno();
	check(
		"遇到未收录的码会记一条（诊断报告据此收集证据）",
		unknown.length === 1 && unknown[0].includes("errno=999999") && unknown[0].includes("主题帖"),
		JSON.stringify(unknown),
	);
	describeRequestError({ code: 300000, msg: "" }, "主题帖");
	check(
		"已收录的码不往缓冲里记（不制造噪音）",
		recentUnknownErrno().length === 1,
		JSON.stringify(recentUnknownErrno()),
	);
	recordUnknownErrno(1, "x", "y");
	clearUnknownErrno();
	check("缓冲可以清空", recentUnknownErrno().length === 0);

	check(
		"SDK 的业务错误对象被翻译成中文",
		describeRequestError({ code: 300000, msg: "" }, "发帖").includes("贴吧接口返回错误 300000"),
	);
	check(
		"网络层错误各有各的说法（超时 / 连不上 / 取消）",
		describeRequestError({ kind: "timeout" }).includes("超时") &&
			describeRequestError({ kind: "network" }).includes("连不上") &&
			describeRequestError({ kind: "abort" }) === "请求已取消",
	);
	check(
		"普通 Error 原样透传 message",
		describeRequestError(new Error("尚未设置 BDUSS")) === "尚未设置 BDUSS",
	);
}

// ── 请求重试与熔断 ────────────────────────────────────────────────────
console.log("请求重试与熔断");
{
	const {
		withRequestPolicy,
		isRetryableError,
		breakerSnapshot,
		resetBreaker,
		RequestPausedError,
		RETRY_MAX_ATTEMPTS,
		RETRY_BASE_DELAY_MS,
		BREAKER_FAILURE_THRESHOLD,
		BREAKER_COOLDOWN_MS,
	} = netPolicy;

	check(
		"只有网络类错误才重试（业务错误码重试没有意义）",
		isRetryableError({ kind: "network" }) &&
			isRetryableError({ kind: "timeout" }) &&
			isRetryableError({ _tag: "FetchError" }) &&
			!isRetryableError({ code: 300000, msg: "" }) &&
			!isRetryableError(new Error("x")),
	);

	// 注入时钟：测试不真的等 2 秒
	const makeClock = () => {
		let now = 1_000_000;
		const slept = [];
		return {
			now: () => now,
			sleep: async (ms) => {
				slept.push(ms);
				now += ms;
			},
			slept,
			advance: (ms) => {
				now += ms;
			},
		};
	};

	{
		resetBreaker();
		const clock = makeClock();
		let attempts = 0;
		const result = await withRequestPolicy(
			async () => {
				attempts += 1;
				if (attempts < 3) throw { kind: "network" };
				return "ok";
			},
			"测试请求",
			clock,
		);
		check("网络错误会重试到成功", result === "ok" && attempts === 3, `尝试 ${attempts} 次`);
		check(
			"退避是指数增长（第一次 700ms、第二次 1400ms）",
			clock.slept.join(",") === `${RETRY_BASE_DELAY_MS},${RETRY_BASE_DELAY_MS * 2}`,
			clock.slept.join(","),
		);
		check(
			"重试成功后失败计数清零",
			breakerSnapshot(clock.now()).consecutiveFailures === 0,
		);
	}

	{
		resetBreaker();
		const clock = makeClock();
		let attempts = 0;
		let caught = null;
		try {
			await withRequestPolicy(
				async () => {
					attempts += 1;
					throw { code: 300000, msg: "" };
				},
				"测试请求",
				clock,
			);
		} catch (error) {
			caught = error;
		}
		check(
			"业务错误码只试一次就放弃（不浪费请求）",
			attempts === 1 && caught?.code === 300000,
			`尝试 ${attempts} 次`,
		);
		check("业务错误也算一次失败（计入熔断）", breakerSnapshot(clock.now()).consecutiveFailures === 1);
	}

	{
		resetBreaker();
		const clock = makeClock();
		const fail = () =>
			withRequestPolicy(
				async () => {
					throw { kind: "network" };
				},
				"测试请求",
				clock,
			);
		for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) {
			await fail().catch(() => {});
		}
		const snapshot = breakerSnapshot(clock.now());
		check(
			`连续失败 ${BREAKER_FAILURE_THRESHOLD} 次后熔断`,
			snapshot.open && snapshot.remainingMs === BREAKER_COOLDOWN_MS,
			JSON.stringify(snapshot),
		);

		let attempts = 0;
		let caught = null;
		try {
			await withRequestPolicy(
				async () => {
					attempts += 1;
					return "unreachable";
				},
				"测试请求",
				clock,
			);
		} catch (error) {
			caught = error;
		}
		check(
			"熔断期间请求被立刻挡回去（连一次都不发）",
			caught instanceof RequestPausedError && attempts === 0,
			`attempts=${attempts}`,
		);
		check(
			"被挡回去的请求会被计数（诊断报告要显示）",
			breakerSnapshot(clock.now()).pausedRequests === 1,
		);
		check(
			"熔断的错误信息里写明了怎么办",
			caught.message.includes("诊断当前页面") && caught.message.includes("重置熔断"),
			caught.message,
		);

		clock.advance(BREAKER_COOLDOWN_MS);
		const afterCooldown = await withRequestPolicy(
			async () => "recovered",
			"测试请求",
			clock,
		);
		check(
			"冷却时间过去后自动恢复，且计数清零",
			afterCooldown === "recovered" &&
				!breakerSnapshot(clock.now()).open &&
				breakerSnapshot(clock.now()).consecutiveFailures === 0,
		);
	}
}

// ── 共同关注（交集）与规则校验器 ──────────────────────────────────────
console.log("共同关注（交集）");
{
	const { followKey, intersectFollows, buildMutualSummary } = mutual;

	check(
		"认人优先用 id，其次 portrait（去掉 query），最后才是名字",
		followKey({ id: 12, portrait: "tb.1.x", name: "甲" }) === "id:12" &&
			followKey({ portrait: "tb.1.x?t=1", name: "甲" }) === "portrait:tb.1.x" &&
			followKey({ name: "甲" }) === "name:甲" &&
			followKey(null) === "",
	);

	const mine = [
		{ id: 1, name: "甲" },
		{ id: 2, name: "乙" },
		{ id: 3, name: "丙" },
	];
	const theirs = [
		{ id: 9, name: "己" },
		{ id: 2, name: "乙" },
		{ id: 3, name: "丙" },
		{ id: 2, name: "乙（重复出现）" },
	];
	const result = intersectFollows(mine, theirs);
	check(
		"交集按对方的顺序给出，且去重",
		result.common.map((user) => user.id).join(",") === "2,3",
		JSON.stringify(result.common.map((user) => user.id)),
	);
	check("按 id 比上的不算「按名字」", result.byName === 0, String(result.byName));

	const byName = intersectFollows([{ name: "甲" }], [{ name: "甲" }, { name: "乙" }]);
	check(
		"没有 id / portrait 时按用户名比，并计数（结论里要提示可能有同名）",
		byName.common.length === 1 && byName.byName === 1,
		`common=${byName.common.length} byName=${byName.byName}`,
	);
	check(
		"两边都没人时不报错",
		intersectFollows([], []).common.length === 0,
	);

	const summary = buildMutualSummary({
		common: 2,
		byName: 1,
		mineRead: 60,
		minePages: 3,
		theirsRead: 40,
		theirsPages: 2,
		capped: true,
	});
	check(
		"结论必须写明读了多少页、多少人（不然会被读成「一共只有这么多」）",
		summary.includes("共同关注 2 人") &&
			summary.includes("读了 60 人（3 页）") &&
			summary.includes("读了 40 人（2 页）"),
		summary,
	);
	check(
		"靠名字比上时要提示可能有同名",
		summary.includes("按用户名比上"),
		summary,
	);
	check(
		"到了页数上限要写明「可能还有没比对到的」",
		summary.includes("可能还有没比对到的"),
		summary,
	);
	check(
		"没到上限时不留这句废话",
		!buildMutualSummary({
			common: 0,
			mineRead: 20,
			minePages: 1,
			theirsRead: 20,
			theirsPages: 1,
		}).includes("可能还有没比对到的"),
	);
}

console.log("规则校验器（行号级报错）");
{
	const { parseRulesDetailed, parseRules } = await import(
		pathToFileURL(outFile).href
	);

	const text = [
		"# 注释行不算问题",
		"",
		"🎮原神 | 原神 | 原神吧",
		"只有名字",
		"🎮原神 | 重复同名 | 另一个吧",
		"🎁抽奖 | 互动 抽奖",
		"🚫矛盾 | 原神 | | 原神",
		"🛒七段 | a | b | c | d | e | f",
		"| 没有名称",
	].join("\n");
	const { rules, issues } = parseRulesDetailed(text);

	check("解析出的规则条数不变（容错策略没改）", rules.length === 4, `共 ${rules.length} 条`);
	check(
		"parseRules 与 parseRulesDetailed 的结果一致（老调用方不受影响）",
		JSON.stringify(parseRules(text)) === JSON.stringify(rules),
	);
	const byLine = (n) => issues.filter((issue) => issue.line === n);
	check(
		"只有名称没有条件的行会点出行号",
		byLine(4).some((issue) => issue.message.includes("没有任何条件")),
		JSON.stringify(byLine(4)),
	);
	check(
		"同名规则会指出与第几行重复",
		byLine(5).some((issue) => issue.message.includes("第 3 行")),
		JSON.stringify(byLine(5)),
	);
	check(
		"关键词里的空格会被提示（脚本不按空格切分）",
		byLine(6).some((issue) => issue.message.includes("不按空格切分")),
		JSON.stringify(byLine(6)),
	);
	check(
		"同一个词同时在关键词与排除词里会被提示（那条证据永远被自己否决）",
		byLine(7).some((issue) => issue.message.includes("永远会被自己否决")),
		JSON.stringify(byLine(7)),
	);
	check(
		"超过 6 段会提示第 7 段起被忽略",
		byLine(8).some((issue) => issue.message.includes("第 7 段起会被忽略")),
		JSON.stringify(byLine(8)),
	);
	check(
		"没有名称的行是错误级，并指出行号",
		byLine(9).some((issue) => issue.level === "error"),
		JSON.stringify(byLine(9)),
	);
	check(
		"注释行 / 空行不产生问题（不制造噪音）",
		byLine(1).length === 0 && byLine(2).length === 0,
	);
	check(
		"干净的规则表零问题",
		parseRulesDetailed("🎮原神 | 原神,米哈游 | 原神吧").issues.length === 0,
		JSON.stringify(parseRulesDetailed("🎮原神 | 原神,米哈游 | 原神吧").issues),
	);

	/*
	 * 内置示例（EXAMPLE_RULES）是**要发给用户**的预设：设置面板里的「填入示例」就是它。
	 * 所以它自己必须零问题——少一个 `|`、多写一段、两条同名，用户点一下「填入示例」
	 * 就会看到一片红字。这几条把它挡在测试里。
	 */
	const { EXAMPLE_RULES } = await import(pathToFileURL(outFile).href);
	const example = parseRulesDetailed(EXAMPLE_RULES);
	check(
		"内置示例零问题（预设写错会在这里红）",
		example.issues.length === 0,
		JSON.stringify(example.issues.slice(0, 3)),
	);
	check(
		"内置示例至少有一条可用规则",
		example.rules.length > 0,
		`共 ${example.rules.length} 条`,
	);
	check(
		"内置示例里没有同名规则（同名会被静默丢掉）",
		new Set(example.rules.map((rule) => rule.name)).size === example.rules.length,
		`${example.rules.length} 条规则 / ${new Set(example.rules.map((rule) => rule.name)).size} 个名字`,
	);
	check(
		"内置示例里每条规则都至少有一个条件（只有名称的行会被丢掉）",
		example.rules.every(
			(rule) =>
				rule.postKeywords.length > 0 ||
				rule.forumKeywords.length > 0 ||
				rule.postForumKeywords.length > 0 ||
				rule.uids.length > 0,
		),
	);
	/*
	 * 这套内置清单的设计是「关注的吧」与「发帖所在吧」写同一份名单，
	 * 于是"只关注没发言"和"只在吧里发言没关注"都能命中。
	 * 两段一旦漂移（漏抄一个吧、只补了一边），命中率就悄悄下降，肉眼很难发现——
	 * 用户报过一次（鸣潮的「北落野」、同的「燕淋十六声」只写了一边），所以在这里钉死。
	 */
	const drifted = example.rules
		.filter((rule) => rule.forumKeywords.length && rule.postForumKeywords.length)
		.filter((rule) => {
			const left = new Set(rule.forumKeywords.map((item) => item.toLowerCase()));
			const right = new Set(rule.postForumKeywords.map((item) => item.toLowerCase()));
			if (left.size !== right.size) return true;
			for (const item of left) if (!right.has(item)) return true;
			return false;
		})
		.map((rule) => rule.name);
	check(
		"内置示例里「关注的吧」与「发帖所在吧」两段一致（这套清单的设计就是两边同一份）",
		drifted.length === 0,
		drifted.length ? `对不上的规则：${drifted.join("、")}` : "",
	);
}

console.log("「没有命中」还是「证据不足」");
{
	const { compositionVerdict } = await import(pathToFileURL(outFile).href);
	const base = {
		hits: 0,
		failed: [],
		hidden: false,
		needForums: true,
		needPosts: true,
		forums: 5,
		posts: 60,
	};

	check(
		"真的有数据却没命中 → 不是证据不足（这才可以不挂标记）",
		!compositionVerdict(base).insufficient,
	);
	check(
		"有命中就不掺「证据不足」",
		!compositionVerdict({ ...base, hits: 2, failed: ["主题帖：xxx"] }).insufficient,
	);
	check(
		"取数失败 → 证据不足，并列出缺的是哪几路",
		compositionVerdict({
			...base,
			failed: ["主题帖：网络错误", "回复：超时"],
		}).note.includes("有 2 路数据没取到") &&
			compositionVerdict({ ...base, failed: ["主题帖：网络错误"] }).note.includes("主题帖"),
		compositionVerdict({ ...base, failed: ["主题帖：网络错误"] }).note,
	);
	check(
		"对方隐藏发帖 → 证据不足，且说清是「私密」",
		compositionVerdict({ ...base, hidden: true, posts: 0 }).note.includes("私密"),
		compositionVerdict({ ...base, hidden: true, posts: 0 }).note,
	);
	check(
		"规则要用发帖、却一条都没读到 → 证据不足（不是「没有命中」）",
		compositionVerdict({ ...base, posts: 0 }).note.includes("一条发帖记录都没读到"),
		compositionVerdict({ ...base, posts: 0 }).note,
	);
	check(
		"规则要用关注的吧、列表却是空的 → 证据不足",
		compositionVerdict({ ...base, needPosts: false, posts: 0, forums: 0 }).note.includes(
			"关注贴吧列表是空的",
		),
		compositionVerdict({ ...base, needPosts: false, posts: 0, forums: 0 }).note,
	);
	check(
		"规则里没用到的东西为空，不算证据不足",
		!compositionVerdict({
			...base,
			needForums: false,
			forums: 0,
			needPosts: true,
			posts: 60,
		}).insufficient,
	);
	check(
		"结论里必须写明「这不等于没有命中」",
		compositionVerdict({ ...base, posts: 0 }).note.includes("不等于"),
	);
}

console.log("命中证据：时间排序与跳转");
{
	const {
		matchComposition,
		sortEvidencesByRecency,
		sortHitsByRecency,
		newestEvidenceAt,
	} = await import(pathToFileURL(outFile).href);
	const { buildEvidenceHtml, evidenceLink } = evidenceHtml;

	check(
		"证据按时间倒序：最近的排前面，没有时间的不参与比较（保持原顺序、排在后面）",
		(function () {
			const sorted = sortEvidencesByRecency([
				{ source: "post", keyword: "a", reason: "", excerpt: "", sure: true, at: 100 },
				{ source: "uid", keyword: "b", reason: "", excerpt: "", sure: true },
				{ source: "post", keyword: "c", reason: "", excerpt: "", sure: true, at: 300 },
				{ source: "forum", keyword: "d", reason: "", excerpt: "", sure: true },
			]);
			return (
				sorted.map((e) => e.keyword).join(",") === "c,a,b,d"
			);
		})(),
	);

	const rules = parseRules(
		[
			"🅰️名单规则 | | | | 12345",
			"🅱️发帖规则 | 原神",
			"🅲吧规则 | | 原神吧",
		].join("\n"),
	);
	const posts = [
		{
			kind: "reply",
			title: "回复：原神怎么样",
			preview: "原神还行",
			forumName: "原神吧",
			createTime: 1_700_000_000,
			threadId: "111",
			postId: "222",
		},
		{
			kind: "topic",
			title: "原神的主题帖",
			preview: "聊聊原神",
			forumName: "原神吧",
			createTime: 1_600_000_000,
			threadId: "333",
			postId: "444",
		},
	];
	const hits = matchComposition(
		{ uid: "12345", userId: 0, forums: ["原神吧"], posts },
		rules,
	);
	check(
		"命中规则也按时间倒序：有发帖依据的排在只有名单/关注吧的前面",
		hits.map((hit) => hit.rule.name).join(",") === "🅱️发帖规则,🅰️名单规则,🅲吧规则",
		hits.map((hit) => hit.rule.name).join(","),
	);
	check(
		"没有时间依据的命中之间保持规则表顺序",
		hits[1].rule.name === "🅰️名单规则" && hits[2].rule.name === "🅲吧规则",
	);
	check(
		"规则内多条证据都带上了时间",
		hits[0].evidences.every((e) => e.source !== "post" || typeof e.at === "number"),
		JSON.stringify(hits[0].evidences.map((e) => [e.source, e.at])),
	);
	check(
		"命中里最新的证据时间可以取出来（面板要显示「最近依据」）",
		newestEvidenceAt(hits[0]) === 1_600_000_000,
		String(newestEvidenceAt(hits[0])),
	);
	check(
		"没有时间的命中，最新时间是 0",
		newestEvidenceAt(hits[1]) === 0,
		String(newestEvidenceAt(hits[1])),
	);

	// 证据带上了"出处"：类型 / 帖子 id / 回复对象都要能传到界面上
	const postEvidence = hits[0].evidences.find((e) => e.source === "post");
	check(
		"发帖证据带上了出处（类型、帖子 id、时间）",
		postEvidence?.post?.kind === "topic" &&
			postEvidence?.post?.threadId === "333" &&
			postEvidence?.post?.postId === "444" &&
			postEvidence?.at === 1_600_000_000,
		JSON.stringify(postEvidence?.post),
	);
	check(
		"主题帖与回复同时命中时优先取主题帖（原本的设计不变）",
		postEvidence?.post?.kind === "topic",
		postEvidence?.post?.kind,
	);

	// 只用回复的场景：弱证据 + 要能跳到那一楼
	const replyOnly = matchComposition(
		{ uid: "1", userId: 0, forums: [], posts: [posts[0]] },
		parseRules("🅱️发帖规则 | 原神"),
	);
	const replyEvidence = replyOnly[0].evidences[0];
	check("只有回复命中时仍是弱证据", replyEvidence.sure === false && replyEvidence.post?.kind === "reply");

	const topicLink = evidenceLink(postEvidence);
	check(
		"主题帖的跳转指向帖子本身",
		topicLink?.href === "https://tieba.baidu.com/p/333" && topicLink.label === "打开主题帖",
		JSON.stringify(topicLink),
	);
	const replyLink = evidenceLink(replyEvidence);
	check(
		"回复 / 楼中楼用 pid 精确跳到那一楼",
		replyLink?.href === "https://tieba.baidu.com/p/111?pid=222" &&
			replyLink.label === "打开这一楼",
		JSON.stringify(replyLink),
	);
	check(
		"名单 / 关注的吧这类证据没有跳转（它们不是帖子）",
		evidenceLink(hits[1].evidences[0]) === null &&
			evidenceLink({
				source: "forum",
				keyword: "x",
				reason: "",
				excerpt: "",
				sure: true,
			}) === null,
	);

	const topicHtml = buildEvidenceHtml(postEvidence);
	check(
		"证据行写出了类型标签与时间",
		topicHtml.includes("tb-eztb-tag-topic") &&
			topicHtml.includes("主题") &&
			/\d{4}-\d{2}-\d{2}/.test(topicHtml),
		topicHtml.slice(0, 160),
	);
	check(
		"证据行有「打开主题帖」链接",
		topicHtml.includes('href="https://tieba.baidu.com/p/333"') &&
			topicHtml.includes("打开主题帖"),
	);
	check(
		"主题帖证据没有「查楼层」（主题帖本来就在 1 楼）",
		!topicHtml.includes("查楼层"),
	);
	check(
		"命中的关键词在原文里高亮（转义后的 <mark>）",
		topicHtml.includes("<mark"),
	);

	const replyHtml = buildEvidenceHtml(replyEvidence);
	check(
		"回复证据：类型标签 + 指向那一楼的链接 + 「查楼层」按钮",
		replyHtml.includes("tb-eztb-tag-reply") &&
			replyHtml.includes('href="https://tieba.baidu.com/p/111?pid=222"') &&
			replyHtml.includes("查楼层") &&
			replyHtml.includes('data-thread="111"') &&
			replyHtml.includes('data-post="222"'),
		replyHtml.slice(0, 200),
	);
	check(
		"楼层已经查过就直接写「N楼」，不再给按钮",
		(function () {
			const html = buildEvidenceHtml(replyEvidence, {
				floorFor: () => 12,
			});
			return html.includes("12楼") && !html.includes("查楼层");
		})(),
	);
	check(
		"缓存里没有楼层时仍然给「查楼层」按钮",
		buildEvidenceHtml(replyEvidence, { floorFor: () => null }).includes("查楼层"),
	);
	check(
		"查不到（0）也算没有，照样给按钮",
		buildEvidenceHtml(replyEvidence, { floorFor: () => 0 }).includes("查楼层"),
	);

	const subHtml = buildEvidenceHtml({
		source: "post",
		keyword: "原神",
		reason: "楼中楼命中",
		excerpt: "原神好玩",
		sure: false,
		at: 1_700_000_000,
		post: {
			kind: "sub",
			forumName: "原神吧",
			title: "t",
			preview: "p",
			createTime: 1_700_000_000,
			threadId: "111",
			postId: "999",
			replyTo: "某人",
		},
	});
	check(
		"楼中楼写出「回复 谁」",
		subHtml.includes("楼中楼") && subHtml.includes("回复 某人"),
		subHtml.slice(0, 200),
	);
	check(
		"证据行里的内容会被转义（吧名 / 名字来自接口，不能拼进 HTML）",
		(function () {
			const html = buildEvidenceHtml({
				source: "post",
				keyword: "原神",
				reason: "在「<img src=x>」发过帖",
				excerpt: "",
				sure: true,
				post: {
					kind: "reply",
					forumName: "<b>吧</b>",
					title: "",
					preview: "",
					threadId: "111",
					postId: "222",
				},
			});
			return !html.includes("<img src=x>") && !html.includes("<b>吧</b>");
		})(),
	);
}

console.log("关键词匹配方式（包含 / 完全匹配）");
{
	const {
		matchComposition,
		keywordMatchesText,
		keywordMatchesForum,
		keywordText,
		isExactKeyword,
		isRiskyShortKeyword,
		parseRulesDetailed,
	} = await import(pathToFileURL(outFile).href);

	/*
	 * 用户实测报的误判（2026-10-01）：某人只在「zerosievert吧」发过言，
	 * 却因为吧名里有个 v，被 `V` 这条规则用**包含匹配**判成了 V 圈。
	 * 下面两条就是那个 case，别再退回去。
	 */
	check(
		"包含匹配下 `V` 会命中「zerosievert吧」（这就是用户报的误判）",
		keywordMatchesForum("zerosievert吧", "V", "contains") === true,
	);
	check(
		"完全匹配下 `=V` 不再命中「zerosievert吧」",
		keywordMatchesForum("zerosievert吧", "=V", "contains") === false &&
			keywordMatchesForum("zerosievert吧", "=V", "exact") === false,
	);
	check(
		"完全匹配下 `=V` 仍然命中吧名就是 V 的（V / V吧 都算）",
		keywordMatchesForum("V", "=V", "exact") === true &&
			keywordMatchesForum("V吧", "=V", "exact") === true &&
			keywordMatchesForum("v吧", "=V", "exact") === true,
	);
	check(
		"完全匹配是「整个吧名相等」而不是前缀：`=V` 不命中「V圈吧」",
		keywordMatchesForum("V圈吧", "=V", "exact") === false &&
			keywordMatchesForum("V圈", "=V", "exact") === false,
	);
	check(
		"吧名与文本的「完全匹配」不是一回事：吧名要整个相等（=原神 不命中「原神内鬼吧」，命中「原神吧」）",
		keywordMatchesForum("原神内鬼吧", "=原神", "exact") === false &&
			keywordMatchesForum("原神吧", "=原神", "exact") === true,
	);
	check(
		"中文关键词打在**文本**上时退化为包含（中文没有词边界，文档里写明了）",
		keywordMatchesText("今天聊聊原神的事儿", "=原神", "exact") === true &&
			keywordMatchesText("今天聊聊原神的事儿", "=原神", "contains") === true,
	);
	check(
		"文本里的英文短词按「独立成词」判断：`=V` 不命中 zerosievert，命中 V圈 / 玩V的",
		keywordMatchesText("zerosievert 真好玩", "=V", "exact") === false &&
			keywordMatchesText("V圈的事", "=V", "exact") === true &&
			keywordMatchesText("我在玩V的", "=V", "exact") === true &&
			keywordMatchesText("asoul 和 V", "=V", "exact") === true,
	);
	check(
		"下划线与数字也算词字符：`=V` 不命中 V_1 / 1V2",
		keywordMatchesText("V_1", "=V", "exact") === false &&
			keywordMatchesText("1V2", "=V", "exact") === false,
	);

	// 全局开关：不带 `=` 的词按它走；带 `=` 的词永远精确
	check(
		"全局切到完全匹配后，普通关键词也变成「整个吧名相等」",
		keywordMatchesForum("zerosievert吧", "V", "exact") === false &&
			keywordMatchesForum("V吧", "V", "exact") === true,
	);
	check(
		"全局是包含匹配时，普通关键词照旧包含",
		keywordMatchesForum("原神内鬼吧", "原神", "contains") === true,
	);
	check(
		"`=` 前缀在两种全局设置下都是完全匹配（单个词优先）",
		keywordMatchesForum("zerosievert吧", "=V", "contains") === false,
	);

	const rules = parseRules(["🅥V | | =V,asoul", "🅥V2 | | V"].join("\n"));
	const hitNames = (forums, mode) =>
		matchComposition({ uid: "1", userId: 0, forums, posts: [] }, rules, {
			mode,
		})
			.map((hit) => hit.rule.name)
			.join(",");
	check(
		"同一个吧名：精确那条不命中、包含那条命中（两条规则的区别一眼可见）",
		hitNames(["zerosievert吧"], "contains") === "🅥V2",
		hitNames(["zerosievert吧"], "contains"),
	);
	check(
		"吧名就是 V 时两条都命中，且证据里的关键词是去掉 `=` 的形式",
		(function () {
			const hits = matchComposition(
				{ uid: "1", userId: 0, forums: ["V吧"], posts: [] },
				rules,
				{ mode: "contains" },
			);
			const exactHit = hits.find((hit) => hit.rule.name === "🅥V");
			return (
				hits.length === 2 &&
				exactHit?.evidences[0].keyword === "V" &&
				!/=/.test(exactHit?.evidences[0].keyword ?? "=")
			);
		})(),
	);
	check(
		"排除词也认 `=`：=V 只否决吧名整个是 V 的，不会误伤 zerosievert",
		(function () {
			const target = { uid: "1", userId: 0, posts: [] };
			// 关键词 =V + 排除词 =V：自己把自己否决 → 不命中
			const selfKilled = matchComposition(
				{ ...target, forums: ["V吧"] },
				parseRules("🅥V | | =V | =V | "),
				{ mode: "contains" },
			);
			// 关键词 =V + 排除词 =V，但吧是 zerosievert：本来就不该命中
			// 关键词 V + 排除词 =V，吧是 zerosievert：包含匹配命中，且没被误排除
			const notExcluded = matchComposition(
				{ ...target, forums: ["zerosievert吧"] },
				parseRules("🅥V | | V | =V | "),
				{ mode: "contains" },
			);
			return selfKilled.length === 0 && notExcluded.length === 1;
		})(),
	);

	check(
		"关键词的显示形式去掉前缀：=V → V",
		keywordText("=V") === "V" &&
			keywordText("asoul") === "asoul" &&
			isExactKeyword("=V") === true &&
			isExactKeyword("V") === false,
	);

	// 解析器要主动提醒这种「短词 + 包含匹配」的写法
	const issues = parseRulesDetailed("🅥V | | V").issues;
	check(
		"解析器会提醒「很短的关键词 + 包含匹配」容易误伤，并告诉你写成 =V",
		issues.some(
			(issue) => issue.message.includes("很短") && issue.message.includes("=V"),
		),
		JSON.stringify(issues.map((issue) => issue.message)),
	);
	check(
		"已经写成 =V 就不再提醒（精确匹配本来是安全的）",
		parseRulesDetailed("🅥V | | =V").issues.length === 0,
		JSON.stringify(parseRulesDetailed("🅥V | | =V").issues),
	);
	check(
		"中长关键词、中文关键词不触发这条提醒（不制造噪音）",
		isRiskyShortKeyword("fgo") === false &&
			isRiskyShortKeyword("原神") === false &&
			isRiskyShortKeyword("V") === true &&
			isRiskyShortKeyword("=V") === false &&
			isRiskyShortKeyword("v") === true,
	);

	// 内置示例里那条 V 规则已经写成 =V（用户点了「填入示例」不该再踩这个坑）
	const { EXAMPLE_RULES } = await import(pathToFileURL(outFile).href);
	check(
		"内置示例里的 V 规则用的是完全匹配（=V）",
		EXAMPLE_RULES.includes("asoul,=V|||asoul,=V"),
		EXAMPLE_RULES.split("\n").find((line) => line.startsWith("V||")) ?? "(没找到)",
	);
	check(
		"内置示例本身不会再触发「短词」提醒",
		parseRulesDetailed(EXAMPLE_RULES).issues.every(
			(issue) => !issue.message.includes("很短"),
		),
		JSON.stringify(
			parseRulesDetailed(EXAMPLE_RULES).issues.map((issue) => issue.message),
		),
	);
}

console.log(failures === 0 ? "\n关键词逻辑全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
