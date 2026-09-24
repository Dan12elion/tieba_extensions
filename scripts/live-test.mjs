/**
 * 真实接口连通性测试（不需要 BDUSS）。
 *
 * 用 Node 的 fetch 顶替 GM_xmlhttpRequest，其余全部走本工程真实的
 * shim + SDK 代码，验证：HTTPS 升级、protobuf 编码、multipart 上传、
 * arraybuffer 响应、protobuf 解码。
 *
 * 选用的都是 proto 接口——它们不携带 BDUSS，匿名即可读取。
 */
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
const { Effect } = await import(
	pathToFileURL(path.join(eztbRoot, "node_modules/effect/dist/esm/index.js")).href
).catch(() => import("effect"));

// ── 1. 用 Node fetch 顶替 GM_xmlhttpRequest ────────────────────────────
const seenUrls = [];
// 本工程模块会读油猴存储，这里给最小桩
globalThis.GM_getValue = (key, fallback) =>
	key === "tbEztbToolboxSettingsV1" ? { bduss: "TEST_DUMMY_BDUSS" } : fallback;
globalThis.GM_setValue = () => {};
globalThis.GM_registerMenuCommand = () => 1;

globalThis.GM_xmlhttpRequest = (details) => {
	seenUrls.push(`${details.method ?? "GET"} ${details.url}`);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), details.timeout ?? 30000);
	fetch(details.url, {
		method: details.method ?? "GET",
		headers: details.headers,
		body: details.data ?? undefined,
		signal: controller.signal,
	})
		.then(async (response) => {
			const buffer = await response.arrayBuffer();
			clearTimeout(timer);
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
			clearTimeout(timer);
			console.error(`    网络层错误：${error?.name} ${error?.message}`);
			if (error?.name === "AbortError") details.ontimeout?.({});
			else details.onerror?.({});
		});
	return { abort: () => controller.abort() };
};

// ── 2. 用真实 shim 打包 SDK ───────────────────────────────────────────
const outDir = path.join(projectRoot, "dist/.verify");
fs.mkdirSync(outDir, { recursive: true });
const sdkOut = path.join(outDir, "sdk.live.mjs");
await esbuild.build({
	entryPoints: [path.join(projectRoot, "src/shims/live-entry.ts")],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: ["es2020"],
	outfile: sdkOut,
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

const sdk = await import(pathToFileURL(sdkOut).href);
sdk.initClient(new sdk.TiebaClient({ bduss: "anonymous-probe" }));

let failures = 0;
function report(label, ok, detail = "") {
	console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
}

// ── 3. 拉取吧内主题列表（proto + multipart + 匿名）────────────────────
console.log("真实接口测试（匿名 proto 接口）");
let threads = [];
try {
	const result = await Effect.runPromise(
		sdk.getThreads({ fname: "百度", page: 1, rn: 30 }),
	);
	threads = result?.threadList ?? result?.thread_list ?? [];
	report(
		"getThreads(百度) 返回主题列表",
		Array.isArray(threads) && threads.length > 0,
		`共 ${Array.isArray(threads) ? threads.length : "?"} 条`,
	);
} catch (error) {
	report("getThreads(百度)", false, error?.message ?? String(error));
}

console.log(`  实际请求：${seenUrls.join(" | ") || "（无）"}`);
report(
	"请求已升级为 HTTPS",
	seenUrls.length > 0 && seenUrls.every((u) => !u.startsWith("GET http://")),
);

// ── 3.5 发帖列表：多试几个用户，避免被单个用户的隐私设置误导 ──────────
const authorIds = Array.from(
	new Set(
		threads
			.map(
				(t) =>
					t?.authorId ?? t?.author_id ?? t?.firstPostAuthorId ?? t?.author?.id,
			)
			.filter(Boolean),
	),
).slice(0, 4);

let postHits = 0;
let firstUidWithPosts = 0;
for (const uid of authorIds) {
	try {
		const posts = await Effect.runPromise(
			sdk.getUserPost(Number(uid), 1, false),
		);
		const count = Array.isArray(posts) ? posts.length : 0;
		if (count > 0) {
			postHits += 1;
			if (!firstUidWithPosts) firstUidWithPosts = Number(uid);
		}
		console.log(`    getUserPost(${uid}) → ${count} 条`);
	} catch (error) {
		console.log(`    getUserPost(${uid}) → 异常 ${error?.message ?? error}`);
	}
}
report(
	"getUserPost 至少对一个用户返回发帖记录",
	postHits > 0,
	`${postHits}/${authorIds.length} 个用户有数据`,
);

// 吧名解析：面板「发帖」页签要显示具体吧名，必须走 needForumName=true
let namedHits = 0;
let namedSample = "";
for (const uid of authorIds.slice(0, 2)) {
	try {
		const posts = await Effect.runPromise(
			sdk.getUserPost(Number(uid), 1, true),
		);
		const named = (posts ?? []).filter((post) => post.forumName);
		if (named.length) {
			namedHits += 1;
			namedSample = named
				.slice(0, 3)
				.map((post) => post.forumName)
				.join(" / ");
		}
	} catch (error) {
		console.log(`    getUserPost(needForumName) ${uid} 异常：${error?.message ?? error}`);
	}
}
report(
	"needForumName=true 时能解析出吧名",
	namedHits > 0,
	namedHits ? namedSample : "没有解析出任何吧名",
);

// ── 主题帖 / 回复 是两个独立 feed（由 is_thread 切换），这是「发帖」页签分类的基础 ──
try {
	const topics = await sdk.loadTopicRows(Number(firstUidWithPosts), 1);
	const replies = await sdk.loadReplyRows(Number(firstUidWithPosts), 1);
	report("主题帖 feed 能取到条目", topics.length > 0, `${topics.length} 条`);
	report(
		"主题帖条目自带吧名（无需反查）",
		topics.length > 0 && topics.every((row) => row.forumName),
		topics[0]?.forumName ?? "",
	);
	report(
		"回复条目类型只可能是 回复/楼中楼",
		replies.length > 0 &&
			replies.every((row) => row.kind === "reply" || row.kind === "sub"),
		`${replies.length} 条`,
	);
	report(
		"主题帖条目的 kind 均为 topic",
		topics.every((row) => row.kind === "topic"),
		"",
	);

	// 楼中楼（affiliated）在回复 feed 里：换几个用户找一条来验证
	let subFound = 0;
	for (const uid of authorIds.slice(0, 4)) {
		const rows = await sdk.loadReplyRows(Number(uid), 1);
		const subs = rows.filter((row) => row.kind === "sub");
		if (subs.length) {
			subFound = subs.length;
			break;
		}
	}
	report("回复 feed 中的楼中楼被标记为 sub", subFound > 0, `${subFound} 条`);
} catch (error) {
	report("发帖分类取数", false, error?.message ?? String(error));
}

// ── 分页：两个子页签各自翻页，前提是 pn 真能翻到不同的下一页 ──────────
{
	let found = null;
	let scanned = 0;
	for (const uid of authorIds.slice(0, 4)) {
		scanned += 1;
		const first = await sdk.loadTopicRows(Number(uid), 1);
		if (first.length < 20) {
			if (process.env.EZTB_PROBE) {
				console.log(`    分页探查 uid=${uid} 第1页仅 ${first.length} 条（不足一页）`);
			}
			continue;
		}
		const second = await sdk.loadTopicRows(Number(uid), 2);
		found = {
			uid,
			first: first.length,
			second: second.length,
			distinct: first[0]?.threadId !== second[0]?.threadId,
		};
		break;
	}
	report(
		"主题帖 pn 能翻到不同的下一页",
		Boolean(found && found.second > 0 && found.distinct),
		found
			? `uid=${found.uid} 第1页 ${found.first} 条 / 第2页 ${found.second} 条 / 内容不同=${found.distinct}`
			: `扫了 ${scanned} 个作者，主题帖都不足一页（无法验证翻页）`,
	);
}

// ── 关注的吧（含"隐藏关注贴吧"的回退）────────────────────────────────
// 面板与成分检测共用 loadUserForums：这里直接调它，验证隐藏情况真的能拿到吧名。
{
	let hidden = null;
	// 顺便把 click-test 用的两个用户也探一遍（临时，看完就删）
	const probeIds = process.env.EZTB_PROBE
		? [...authorIds.slice(0, 4), 1941147376, 3408054413]
		: authorIds.slice(0, 4);
	for (const uid of probeIds) {
		try {
			const loaded = await sdk.loadUserForums(Number(uid));
			if (process.env.EZTB_PROBE) {
				console.log(
					`    关注吧探查 uid=${uid} → ${loaded.forums.length} 个 / 隐藏回退=${loaded.hidden}`,
				);
				// 顺带看看 profile 里本来就带着的"关注贴吧"字段，和回退结果是否一致
				const profile = await Effect.runPromise(sdk.getProfile(Number(uid)));
				const profileNames = (profile?.user?.likeForum ?? []).map(
					(forum) => forum.forumName,
				);
				console.log(
					`      profile.likeForum = [${profileNames.join(", ")}]（${profileNames.length} 个）`,
				);
			}
			if (loaded.hidden && loaded.forums.length > 0) {
				hidden = { uid, count: loaded.forums.length, sample: loaded.forums.slice(0, 3).map((f) => f.name) };
				if (!process.env.EZTB_PROBE) break;
			}
		} catch (error) {
			if (process.env.EZTB_PROBE) {
				console.log(`    关注吧探查 uid=${uid} → 失败：${error?.message ?? error}`);
			}
		}
	}
	report(
		"隐藏关注贴吧时也能恢复出吧名（面板与成分检测共用这条路径）",
		Boolean(hidden),
		hidden
			? `uid=${hidden.uid} 恢复 ${hidden.count} 个，例如 ${hidden.sample.join(" / ")}`
			: "扫过的用户里没有隐藏关注贴吧的",
	);

	// 成分检测看的是"合并后的吧名"：接口没给全时，profile 里带的关注吧也要并进来
	const mergedProbe = await sdk.loadUserForums(Number(authorIds[0]), [
		"eztb 测试用吧",
	]);
	const names = mergedProbe.forums.map((forum) => forum.name);
	report(
		"profile 里的关注吧会并入结果，且不重复",
		names.includes("eztb 测试用吧") &&
			new Set(names).size === names.length &&
			mergedProbe.recovered >= 1,
		`共 ${names.length} 个 / 补充 ${mergedProbe.recovered} 个 / 去重后 ${new Set(names).size} 个`,
	);
}

// ── 关键词匹配：拿真实主题帖数据跑一遍规则（真实数据 + 线上同一份匹配代码）──
try {
	const probeUid = Number(firstUidWithPosts);
	const rows = await sdk.loadTopicRows(probeUid, 1);
	const sample = rows.find((row) => (row.title ?? "").length >= 2);
	// 从真实标题里取一个词当规则关键词：这样"数据取到了但匹配没生效"也能被发现
	const needle = sample ? sample.title.replace(/[|\s]/g, "").slice(0, 2) : "";
	const posts = rows.map((row) => ({
		title: row.title,
		preview: row.preview,
		kind: "topic",
	}));

	if (needle) {
		const hits = sdk.matchComposition(
			{ userId: probeUid, forums: [], posts },
			sdk.parseRules(`${needle} | ${needle}`),
		);
		report(
			"真实发帖数据跑关键词规则能命中",
			hits.length === 1 &&
				hits[0].sure === true &&
				hits[0].evidences[0]?.keyword === needle,
			hits.length ? `关键词「${needle}」→ ${hits[0].summary}` : "没有命中",
		);
		report(
			"不相关的关键词不会误报",
			sdk.matchComposition(
				{ userId: probeUid, forums: [], posts },
				sdk.parseRules("不存在的成分 | 这个词组肯定不存在zzz"),
			).length === 0,
		);
		report(
			"排除词能把已经命中的内容否决掉",
			sdk.matchComposition(
				{ userId: probeUid, forums: [], posts },
				sdk.parseRules(`${needle} | ${needle} | | ${needle}`),
			).length === 0,
			`关键词与排除词都是「${needle}」`,
		);
	} else {
		report("真实发帖数据跑关键词规则能命中", false, "没取到可用的主题帖标题");
	}
} catch (error) {
	report("关键词匹配（真实数据）", false, error?.message ?? String(error));
}

// ── 探查原始结构：找出区分「主题帖 / 楼层回复 / 楼中楼」的信号 ──
if (process.env.EZTB_PROBE) {
	// ── 手工构造 protobuf，验证 is_thread 字段的作用 ──
	const vint = (n) => {
		const out = [];
		let v = Number(n);
		while (v > 127) {
			out.push((v & 127) | 128);
			v = Math.floor(v / 128);
		}
		out.push(v);
		return out;
	};
	const fVarint = (f, v) => [...vint((f << 3) | 0), ...vint(v)];
	const fBytes = (f, bytes) => [...vint((f << 3) | 2), ...vint(bytes.length), ...bytes];
	const utf8 = (s) => Array.from(new TextEncoder().encode(s));

	const buildUserPostRequest = (uid, isThread, pn = 1) => {
		const common = [...fVarint(1, 2), ...fBytes(2, utf8("8.9.8.5"))];
		const data = [
			...fVarint(1, uid),
			...fVarint(4, isThread),
			...fVarint(5, 1),
			...fVarint(26, pn),
			...fBytes(27, common),
		];
		return new Uint8Array(fBytes(1, data));
	};

	const probeId = String(firstUidWithPosts);
	const probeIds = Array.from(
		new Set([firstUidWithPosts, ...authorIds].map((id) => String(id))),
	).slice(0, 4);
	for (const isThread of [0, 1]) {
		const response = await Effect.runPromise(
			sdk
				.getClient()
				.postProtobuf(
					"/c/u/feed/userpost?cmd=303002",
					buildUserPostRequest(Number(probeId), isThread),
				),
		);
		const decoded = sdk.UserPostResIdl.decode(response);
		const items = decoded?.data?.postList ?? [];
		const prefixed = items.filter((i) => /^回复[：:]/.test(i.title ?? ""));
		console.log(
			`\n  is_thread=${isThread} → ${items.length} 条（其中 ${prefixed.length} 条带「回复：」前缀）`,
		);
		for (const item of items.slice(0, 5)) {
			console.log(
				`    threadType=${item.threadType} postType=${(item.content ?? []).map((e) => e.postType).join(",")} title=${JSON.stringify(item.title ?? "").slice(0, 44)}`,
			);
		}
		if (isThread === 1) {
			const sample = items[0];
			console.log(
				`    字段探查: content=${(sample.content ?? []).length} firstPostContent=${(sample.firstPostContent ?? []).length} replyNum=${sample.replyNum} forumName=${JSON.stringify(sample.forumName ?? "")} postId=${sample.postId} threadId=${sample.threadId} createTime=${sample.createTime}`,
			);
			const flattened = await Effect.runPromise(
				sdk.processUserPosts(items, false),
			);
			console.log(
				`    processUserPosts(is_thread=1) → ${flattened.length} 条展平结果`,
			);
		}
	}

	console.log("\n原始 PostInfoList 结构：");
	// 复现面板「发帖」页签的完整取数路径
	try {
		const rows = await sdk.loadPostPage(Number(probeId), 1);
		const byKind = {};
		for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
		console.log(
			`\n  loadPostPage(${probeId}, 1) → ${rows.length} 条 ${JSON.stringify(byKind)}`,
		);
		for (const row of rows.slice(0, 4)) {
			console.log(
				`    [${row.kind}] ${row.forumName} | ${String(row.title).slice(0, 30)}`,
			);
		}
	} catch (error) {
		console.log(`\n  loadPostPage 失败：${error?.message}`);
		console.log(String(error?.stack ?? "").split("\n").slice(0, 6).join("\n"));
	}

	// 楼中楼标记是否生效
	try {
		console.log("\n  各用户回复 feed 的楼中楼条目数：");
		for (const uid of probeIds) {
			const rawUser = await Effect.runPromise(
				sdk.getRawUserPost(Number(uid), 1),
			);
			const subs = (rawUser ?? []).reduce(
				(acc, item) =>
					acc + (item.content ?? []).filter((e) => e.postType === "1").length,
				0,
			);
			const types = new Set();
			for (const item of rawUser ?? []) {
				for (const entry of item.content ?? []) {
					types.add(`${entry.postType}(${typeof entry.postType})`);
				}
			}
			console.log(
				`    用户 ${uid}: ${(rawUser ?? []).length} 条，楼中楼 ${subs}，postType 取值 ${[...types].join("/")}`,
			);
		}

		const replies = await sdk.loadReplyRows(Number(probeId), 1);
		const subs = replies.filter((r) => r.kind === "sub");
		console.log(
			`\n  loadReplyRows(${probeId}, 1) → ${replies.length} 条，其中楼中楼 ${subs.length} 条`,
		);
		for (const sub of subs.slice(0, 3)) {
			console.log(`    [楼中楼] ${String(sub.title).slice(0, 30)}`);
		}
	} catch (error) {
		console.log(`  loadReplyRows 失败：${error?.message}`);
	}

	for (const uid of probeIds) {
		const raw = await Effect.runPromise(sdk.getRawUserPost(Number(uid), 1));
		const items = raw ?? [];
		const replies = items.filter((i) => /^回复[：:]/.test(i.title ?? ""));
		console.log(
			`\n  用户 ${uid}：共 ${items.length} 条，其中 ${replies.length} 条带「回复：」前缀`,
		);
		for (const item of items.slice(0, 10)) {
			const types = (item.content ?? []).map((e) => e.postType).join(",");
			const prefixed = /^回复[：:]/.test(item.title ?? "");
			console.log(
				`    [${prefixed ? "回复" : "主题?"}] threadType=${item.threadType} postType=${types} firstPost=${(item.firstPostContent ?? []).length} replyNum=${item.replyNum} title=${JSON.stringify(item.title ?? "").slice(0, 46)}`,
			);
		}
	}
}

// ── 4. 用列表里的作者验证 getProfile（proto + 匿名）──────────────────
const firstThread = threads[0];
const authorId =
	firstThread?.authorId ??
	firstThread?.author_id ??
	firstThread?.firstPostAuthorId ??
	firstThread?.author?.id;

if (authorId) {
	try {
		const profile = await Effect.runPromise(sdk.getProfile(Number(authorId)));
		const user = profile?.user;
		report(
			`getProfile(${authorId}) 解析出用户`,
			Boolean(user?.id),
			user ? `${user.nameShow || user.name} / 贴吧号 ${user.tiebaUid || "无"}` : "",
		);

		// 用户面板：隐藏关注贴吧时靠它恢复「关注的吧 + 吧内等级」
		if (user?.name) {
			try {
				const panel = await Effect.runPromise(sdk.getPanel(user.name));
				const grades = Object.entries(panel?.honor?.grade ?? {});
				const sample = grades
					.slice(0, 3)
					.map(([level, group]) => `${level}级×${group?.forum_list?.length ?? 0}`)
					.join(" ");
				report(
					"getPanel 的 grade 键即吧内等级",
					grades.length > 0 && grades.every(([level]) => /^\d+$/.test(level)),
					grades.length ? sample : "该用户无等级分组数据",
				);
			} catch (error) {
				report("getPanel", false, error?.message ?? String(error));
			}
		}
	} catch (error) {
		report(`getProfile(${authorId})`, false, error?.message ?? String(error));
	}
} else {
	console.log(
		`  跳过 getProfile：列表项里没找到作者 ID，字段为 ${Object.keys(firstThread ?? {}).slice(0, 12).join(", ")}`,
	);
}

console.log(failures === 0 ? "\n真实链路全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
