/**
 * 用户「发帖 / 回复」取数。
 *
 * 贴吧把这两类放在**两个不同的 feed** 里，由 protobuf 的 `is_thread` 字段切换：
 *   - `is_thread=1` → 该用户自己开的主题帖
 *   - `is_thread=0`（SDK 默认不传此字段）→ 该用户回复别人的帖子
 *
 * 实测（scripts/live-test.mjs 可复现）：
 *   - 主题帖 feed：条目没有 content[]，正文在 first_post_content[]，
 *     且 forum_name 已直接给出；processUserPosts 对它返回 0 条。
 *   - 回复 feed：正文在 content[]，展平后每条/每层楼中楼各一行，
 *     原始 title 一律带「回复：」前缀（SDK 会把它抹掉）。
 *
 * SDK 的 getUserPost 只能取到回复那一路，所以这里自己构造请求。
 */

import { Effect } from "effect";
import {
	TiebaServerError,
	getClient,
	getForumName,
	processUserPosts,
} from "tieba.js";
import { UserPostReqIdl } from "tieba.js/generated/UserPostReqIdl";
import { UserPostResIdl } from "tieba.js/generated/UserPostResIdl";
import { callSdkLoose } from "./identity.ts";
import { requestQueue } from "./queue.ts";
import { ensureClient } from "./sdk.ts";
import { toNumber } from "./util.ts";

const ENDPOINT = "/c/u/feed/userpost?cmd=303002";
const CLIENT_VERSION_OLD = "8.9.8.5";

export type PostKind = "topic" | "reply" | "sub";

export interface PostRow {
	kind: PostKind;
	threadId: string;
	/** 这条记录自身的帖子 ID（pid）。「查楼层」就是拿它去 /c/f/pb/floor 换楼层号 */
	postId: string;
	title: string;
	/** 正文摘要：主题帖取正文，回复取回复内容 */
	preview: string;
	forumName: string;
	createTime: number;
	/** 楼中楼里被回复的人（只有楼中楼才有） */
	replyTo?: string;
}

/**
 * 一页发帖结果。
 *
 * `hidden` 来自响应里的 `data.hidePost`：实测（2026-09-27 抽样 108 个用户）
 * 用户把发帖记录设为私密时，**两路 feed 都返回 `hidePost=1`、`maskType=3`、postList 为空**；
 * 正常用户是 `hidePost=0`、`maskType=1`（抽样里 93/108 是 1，15/108 是 3）。
 *
 * 结论：被隐藏的帖子**拿不到内容**（服务端根本不返回），但脚本可以据此把
 * 「对方没有公开的帖子」和「对方隐藏了帖子」区分开，而不是一律显示"没有公开的主题帖"。
 */
export interface PostFeedPage {
	rows: PostRow[];
	hidden: boolean;
}

function buildRequest(uid: number, isThread: number, pn: number): Uint8Array {
	// 必须走 fromPartial：生成代码的 encode 用 `字段 !== 默认值` 判断是否写入，
	// 直接传部分对象会让缺失的 int64 字段变成 undefined 传给 BigInt 而抛错。
	const message = UserPostReqIdl.fromPartial({
		data: {
			userId: String(uid),
			isThread,
			needContent: 1,
			pn,
			common: { ClientType: 2, ClientVersion: CLIENT_VERSION_OLD },
		},
	});
	return UserPostReqIdl.encode(message).finish();
}

/** 取一页原始 feed；走限速队列。 */
async function fetchRaw(
	uid: number,
	isThread: 0 | 1,
	pn: number,
): Promise<{ postList: any[]; hidden: boolean }> {
	ensureClient();
	return requestQueue.run(async () => {
		const client = getClient();
		const buffer = await Effect.runPromise(
			client.postProtobuf(ENDPOINT, buildRequest(uid, isThread, pn)),
		);
		const decoded: any = UserPostResIdl.decode(buffer);
		const errorno = decoded?.error?.errorno;
		if (errorno) {
			throw new TiebaServerError(errorno, decoded?.error?.errmsg ?? "");
		}
		return {
			postList: (decoded?.data?.postList ?? []) as any[],
			hidden: toNumber(decoded?.data?.hidePost) > 0,
		};
	});
}

/** 从 PbContent[] 里抽纯文本。 */
function textOf(contents: unknown): string {
	if (!Array.isArray(contents)) return "";
	return contents
		.map((item: any) => item?.text ?? "")
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

/** 一页主题帖（该用户自己开的帖）。 */
export async function loadTopicPage(
	uid: number,
	page: number,
): Promise<PostFeedPage> {
	const raw = await fetchRaw(uid, 1, page);
	return {
		hidden: raw.hidden,
		rows: raw.postList.map((item) => ({
			kind: "topic" as const,
			threadId: String(item.threadId ?? ""),
			postId: String(item.postId ?? ""),
			title: item.title || "",
			preview: textOf(item.firstPostContent),
			forumName: item.forumName || "",
			createTime: toNumber(item.createTime),
		})),
	};
}

/** 一页回复（含楼中楼，楼中楼用 affiliated 标记）。 */
export async function loadReplyPage(
	uid: number,
	page: number,
): Promise<PostFeedPage> {
	const raw = await fetchRaw(uid, 0, page);
	const posts = await requestQueue.run(async () => {
		// 这里传 false：把"展平"和"反查吧名"拆开。SDK 那边的 names 缓存是**每次
		// Effect.runPromise 都重建**的（模块级存的是 Effect 而不是解析后的 Cache），
		// 于是每取一页回复都要按吧再发一遍 getForumName。实测一条 12 条的回复页会额外发 9 个
		// 请求，"检测签到号"因此从 2 个变成 11 个。下面用本模块自己的缓存兜住。
		const result = processUserPosts(raw.postList as never, false);
		return (await Effect.runPromise(result)) as any[];
	});
	const names = await resolveForumNames(
		raw.postList.map((item) => String(item?.forumId ?? "")),
	);
	return {
		hidden: raw.hidden,
		rows: (posts ?? []).map((post) => ({
			kind: post.affiliated ? ("sub" as const) : ("reply" as const),
			threadId: String(post.threadId ?? ""),
			// 必须用**正文级**的 pid（cid），不能用 PostInfoList.postId：
			// 一条 feed 记录可以带多条正文（他在同一个帖子里连发几楼），
			// 记录级 pid 是这几行共用的，用它去查楼层会让同一帖的每一行都查回同一个楼层。
			// 实测（2026-09-27，uid 874540992）：一条记录含 3 条正文，
			// 记录级 pid 对应 112 楼，而第二、三条正文其实在 111 / 其它楼。
			postId: String(post.cid || post.postId || ""),
			title: post.title || post.content || "",
			preview: post.content || "",
			forumName:
				names.get(String(post.forumId ?? "")) || post.forumName || "",
			createTime: toNumber(post.createTime),
			replyTo: post.replyTo || undefined,
		})),
	};
}

/**
 * 吧名缓存：回复 feed 不返回吧名（只有 forumId），要按吧反查。

 * 同一个吧在面板、成分检测、签到检测里会被反复问到，所以缓存必须跨调用活下来——
 * 这与 §4.2 的"点了才查"缓存是两回事，这里缓存的是**几乎不会变的吧名**。
 */
interface CachedForumName {
	name: string;
	ts: number;
}

const forumNames = new Map<string, CachedForumName>();
const FORUM_NAME_CACHE_MAX = 500;

/**
 * 解析失败（空吧名）只保留这么久，之后允许重新请求。
 *
 * 成功的吧名几乎不变，一直有效；失败的若不设期限，一次网络抖动就会让那个吧
 * 在本次页面会话里永远显示「未知贴吧」（缓存只在页面刷新时重建）。
 */
const FORUM_NAME_EMPTY_TTL_MS = 5 * 60 * 1000;

function isFresh(entry: CachedForumName | undefined): entry is CachedForumName {
	if (!entry) return false;
	if (entry.name) return true;
	return Date.now() - entry.ts < FORUM_NAME_EMPTY_TTL_MS;
}

/** 测试用：清掉吧名缓存，让「第二次不再重复请求」的断言能从冷启动开始量。 */
export function clearForumNameCache(): void {
	forumNames.clear();
}

async function resolveForumNames(ids: string[]): Promise<Map<string, string>> {
	const wanted = Array.from(
		new Set(ids.filter((id) => id && id !== "0")),
	).filter((id) => !isFresh(forumNames.get(id)));

	// 串行解析（requestQueue 本身是串行的，这里不并发，避免一次点出好几个请求）
	for (const id of wanted) {
		try {
			const name = String(
				(await callSdkLoose(() => getForumName(Number(id)))) ?? "",
			);
			forumNames.set(id, { name, ts: Date.now() });
		} catch {
			// 单个吧解析失败不影响其它行：留空（界面上显示「未知贴吧」），并允许稍后重试
			forumNames.set(id, { name: "", ts: Date.now() });
		}
	}
	if (forumNames.size > FORUM_NAME_CACHE_MAX) {
		const stale = Array.from(forumNames.entries())
			.sort((a, b) => a[1].ts - b[1].ts)
			.slice(0, forumNames.size - FORUM_NAME_CACHE_MAX);
		for (const [key] of stale) forumNames.delete(key);
	}
	const out = new Map<string, string>();
	for (const id of ids) {
		const entry = forumNames.get(id);
		if (entry) out.set(id, entry.name);
	}
	return out;
}

/** 只要行的版本（面板、成分检测用）。 */
export async function loadTopicRows(
	uid: number,
	page: number,
): Promise<PostRow[]> {
	return (await loadTopicPage(uid, page)).rows;
}

export async function loadReplyRows(
	uid: number,
	page: number,
): Promise<PostRow[]> {
	return (await loadReplyPage(uid, page)).rows;
}

/** 一页合并结果：主题帖 + 回复，按时间倒序。 */
export async function loadPostPage(
	uid: number,
	page: number,
): Promise<PostRow[]> {
	const [topics, replies] = await Promise.all([
		loadTopicRows(uid, page),
		loadReplyRows(uid, page),
	]);
	return [...topics, ...replies].sort((a, b) => b.createTime - a.createTime);
}
