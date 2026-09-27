// 单用户数据探查：把某个用户在各个接口下的**原始返回**打出来。
//
// 用途：回答"为什么这个字段拿不到"这类问题——比如"隐藏关注贴吧时为什么没有吧内等级"。
// 用法：node scripts/probe-user.mjs <portrait串|数字ID> [吧名]
//   例：node scripts/probe-user.mjs tb.1.b076219d.9gQz140DRkCjZ4cPljEkfg 汉族
//
// 走的是**线上同一份** shim + SDK + 本项目模块（src/shims/live-entry.ts），
// 匿名即可（getProfile / getPanel 不需要 BDUSS；getLikeForum 需要登录，匿名会返回空）。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createShimPlugin, DEFAULT_EZTB_ROOT } from "./shims-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eztbRoot = process.env.EZTB_ROOT ?? DEFAULT_EZTB_ROOT;

const target = process.argv[2];
const forumName = process.argv[3] ?? "";
if (!target) {
	console.error("用法：node scripts/probe-user.mjs <portrait串|数字ID> [吧名]");
	process.exit(1);
}

// ── 用 Node fetch 顶替 GM_xmlhttpRequest（与 live-test 同一套桩）────────
globalThis.GM_getValue = (key, fallback) =>
	key === "tbEztbToolboxSettingsV1" ? { bduss: "anonymous-probe" } : fallback;
globalThis.GM_setValue = () => {};
globalThis.GM_registerMenuCommand = () => 1;
globalThis.GM_xmlhttpRequest = (details) => {
	const controller = new AbortController();
	fetch(details.url, {
		method: details.method ?? "GET",
		headers: details.headers,
		body: details.data ?? undefined,
		signal: controller.signal,
	})
		.then(async (response) => {
			const buffer = await response.arrayBuffer();
			details.onload?.({
				status: response.status,
				statusText: response.statusText,
				responseHeaders: "",
				response:
					details.responseType === "arraybuffer"
						? buffer
						: new TextDecoder().decode(buffer),
			});
		})
		.catch((error) => {
			console.error(`网络层错误：${error?.message}`);
			details.onerror?.({});
		});
	return { abort: () => controller.abort() };
};

const require = createRequire(import.meta.url);
const esbuild = require(path.join(eztbRoot, "node_modules/esbuild"));

const outDir = path.join(projectRoot, "dist/.verify");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "probe.sdk.mjs");
await esbuild.build({
	entryPoints: [path.join(projectRoot, "src/shims/live-entry.ts")],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: ["es2020"],
	outfile: outFile,
	nodePaths: [path.join(eztbRoot, "node_modules")],
	plugins: [
		createShimPlugin({
			projectRoot,
			eztbRoot,
			extra: new Map([
				[
					"eztb-internal/userpost-req",
					path.join(eztbRoot, "packages/sdk/src/generated/UserPostReqIdl.ts"),
				],
				[
					"eztb-internal/userpost-res",
					path.join(eztbRoot, "packages/sdk/src/generated/UserPostResIdl.ts"),
				],
			]),
		}),
	],
	logLevel: "silent",
});

const { Effect } = await import(
	pathToFileURL(path.join(eztbRoot, "node_modules/effect/dist/esm/index.js")).href
).catch(() => import("effect"));
const sdk = await import(pathToFileURL(outFile).href);
sdk.initClient(new sdk.TiebaClient({ bduss: "anonymous-probe" }));

const run = (effect) => Effect.runPromise(effect);

console.log(`探查目标：${target}\n`);

// ── 1. getProfile ─────────────────────────────────────────────────────
const profile = await run(sdk.getProfile(/^\d+$/.test(target) ? Number(target) : target)).catch(
	(error) => {
		console.error("getProfile 失败：", error?.message ?? error);
		return null;
	},
);
const user = profile?.user;
if (!user) {
	console.error("没拿到 user 字段，后面的检查跳过");
	process.exit(1);
}

console.log("【getProfile】");
console.log("  id            =", user.id);
console.log("  用户名(name)  =", JSON.stringify(user.name));
console.log("  昵称(nameShow)=", JSON.stringify(user.nameShow));
console.log("  贴吧号        =", user.tiebaUid);
console.log("  levelId(等级) =", user.levelId);
console.log("  likeForum 数量 =", (user.likeForum ?? []).length);
console.log(
	"  likeForum     =",
	(Array.isArray(user.likeForum) ? user.likeForum : [])
		.map((forum) => `${forum.forumName}(fid=${forum.forumId})`)
		.join(" / ") || "(空)",
);

// ── 2. getPanel：隐藏关注贴吧时等级的唯一来源 ──────────────────────────
console.log("\n【getPanel(用户名)】——隐藏关注贴吧时，吧内等级只能从这里来");
let grade = {};
// 依次试试各种标识符：用户名 / 贴吧号 / 内部 ID / portrait。
// 我们的回退逻辑只用 user.name；这里是为了确认「换个标识符能不能查到」，
// 如果能，那就是可以修的方向。
for (const [label, value] of [
	["用户名(name)", user.name],
	["贴吧号", user.tiebaUid],
	["内部 ID", user.id],
	["portrait", typeof target === "string" && !/^\d+$/.test(target) ? target : ""],
]) {
	if (!value) {
		console.log(`  [${label}] 空值，跳过`);
		continue;
	}
	const panel = await run(sdk.getPanel(String(value))).catch((error) => {
		console.log(`  [${label}] getPanel 失败：${error?.message ?? error}`);
		return null;
	});
	const entries = Object.entries(panel?.honor?.grade ?? {});
	if (!panel) continue;
	const flat = entries.flatMap(([, group]) => group?.forum_list ?? []);
	const hit = entries.find(([, group]) => (group?.forum_list ?? []).includes(forumName));
	console.log(
		`  [${label}=${value}] grade 分组 ${entries.length} 组 / ${flat.length} 个吧` +
			(forumName
				? `；「${forumName}」${hit ? `在里面（${hit[0]} 级）` : "不在里面"}`
				: ""),
	);
	if (entries.length && !Object.keys(grade ?? {}).length) grade = panel.honor.grade;
}
if (!Object.keys(grade ?? {}).length) {
	console.log("  结论：这个用户在所有标识符下都拿不到 grade（吧内等级）");
}
if (forumName) {
	const inGrade = Object.entries(grade).find(([, group]) =>
		(group?.forum_list ?? []).includes(forumName),
	);
	console.log(
		`  「${forumName}」在 grade 里：${inGrade ? `是（${inGrade[0]} 级）` : "否"}`,
	);
}

// ── 3. 两个"关注吧列表"接口 ────────────────────────────────────────────
console.log("\n【getLikeForum / getHiddenLikeForum】");
const likeForum = await run(sdk.getLikeForum(user.id)).catch(
	(error) => `失败：${error?.message ?? error}`,
);
console.log(
	"  getLikeForum（登录才完整）=",
	Array.isArray(likeForum)
		? `${likeForum.length} 个${forumName ? `；「${forumName}」${likeForum.some((f) => f.name === forumName) ? `在里面，level_id=${likeForum.find((f) => f.name === forumName).level_id}` : "不在里面"}` : ""}`
		: likeForum,
);

const hidden = await run(sdk.getHiddenLikeForum(user.id)).catch(
	(error) => `失败：${error?.message ?? error}`,
);
if (typeof hidden === "string") {
	console.log("  getHiddenLikeForum =", hidden);
} else {
	console.log("  getHiddenLikeForum 原始返回 =", JSON.stringify(hidden));
	const gradedNames = Object.values(hidden.grade ?? {}).flatMap(
		(group) => group?.forum_list ?? [],
	);
	console.log(
		`  getHiddenLikeForum：grade 里有 ${gradedNames.length} 个吧，plain 里有 ${(hidden.plain ?? []).length} 个吧（plain 的**没有等级**）`,
	);
	if (forumName) {
		console.log(
			`  「${forumName}」：在 grade 里 ${gradedNames.includes(forumName) ? "是" : "否"}；在 plain 里 ${(hidden.plain ?? []).includes(forumName) ? "是" : "否"}`,
		);
	}
}

// ── 4. 本项目面板实际会给用户看什么 ────────────────────────────────────
console.log("\n【本项目 loadUserForums(id, profileForums) 的结果】");
const loaded = await sdk
	.loadUserForums(
		user.id,
		(user.likeForum ?? []).map((f) => f.forumName),
	)
	.catch((error) => `失败：${error?.message ?? error}`);
if (typeof loaded === "string") {
	console.log(" ", loaded);
} else {
	console.log(
		`  共 ${loaded.forums.length} 个（隐藏回退=${loaded.hidden}，恢复 ${loaded.recovered} 个）`,
	);
	for (const forum of loaded.forums) {
		console.log(`    ${forum.name}${forum.level ? `  Lv.${forum.level}` : "  （无等级）"}`);
	}
}

// ── 5. 他的发帖 feed 里有没有"吧内等级"？─────────────────────────────
// 这是唯一可能绕过 panel 的线索：帖子里的作者对象通常带着**该吧的**等级。
console.log("\n【发帖 feed 里的字段】（看看能不能从发帖反推吧内等级）");
const rawPosts = await run(sdk.getRawUserPost(user.id, 1)).catch((error) => {
	console.log("  取原始发帖失败：", error?.message ?? error);
	return null;
});
if (rawPosts) {
	console.log(`  回复 feed 原始条目：${rawPosts.length} 条`);
	const first = rawPosts[0];
	if (first) {
		console.log("    条目字段 =", Object.keys(first).slice(0, 26).join(", "));
		console.log(
			"    每条的吧名 =",
			rawPosts.slice(0, 6).map((item) => item.forumName || "(无)").join(" / "),
		);
		const withLevel = rawPosts.filter(
			(item) =>
				item.author?.levelId || item.author?.level_id || item.levelId,
		);
		console.log(
			`    带等级字段的条目：${withLevel.length} 条`,
			withLevel[0]?.author
				? `（author.levelId=${withLevel[0].author.levelId ?? withLevel[0].author.level_id}）`
				: "",
		);
	}
}

// ── 6. 展平后的行：面板真正渲染的就是这一份 ─────────────────────────────
// 「回复/楼中楼 显示正文与楼层」「发帖占比饼图」「签到号按吧统计」都吃这里的字段，
// 所以"某个字段为什么拿不到 / 楼中楼有没有回复对象"先用这一段看，不要靠猜。
console.log("\n【本项目 loadTopicRows / loadReplyRows 的展平行】（面板据此渲染）");
for (const [label, loader] of [
	["主题帖", sdk.loadTopicRows],
	["回复", sdk.loadReplyRows],
]) {
	let rows = [];
	try {
		rows = await loader(user.id, 1);
	} catch (error) {
		console.log(`  ${label}：取数失败 ${error?.message ?? error}`);
		continue;
	}
	const withForum = rows.filter((row) => row.forumName).length;
	const withPostId = rows.filter((row) => row.postId).length;
	const subs = rows.filter((row) => row.kind === "sub");
	const withReplyTo = rows.filter((row) => row.replyTo);
	console.log(
		`  ${label}：${rows.length} 行；有吧名 ${withForum}；带 postId（可查楼层）${withPostId}`,
	);
	// 楼中楼只可能出现在回复 feed 里，主题帖那边不用重复打一行
	if (label === "回复") {
		console.log(
			`    楼中楼 ${subs.length} 条；其中带「回复了谁」${withReplyTo.length} 条`,
		);
	}
	for (const row of rows.slice(0, 3)) {
		console.log(
			`    · [${row.kind}] ${row.forumName || "(无吧名)"}` +
				`${row.replyTo ? ` ↩ ${row.replyTo}` : ""} ` +
				`${String(row.preview || row.title || "").slice(0, 24)}`,
		);
	}
	for (const row of withReplyTo.slice(0, 3)) {
		console.log(
			`    ↩ [${row.kind}] 回复 ${row.replyTo}：${String(row.preview ?? "").slice(0, 30)}`,
		);
	}
}
