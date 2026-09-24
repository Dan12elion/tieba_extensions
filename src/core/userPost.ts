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
import { TiebaServerError, getClient, processUserPosts } from "tieba.js";
import { UserPostReqIdl } from "tieba.js/generated/UserPostReqIdl";
import { UserPostResIdl } from "tieba.js/generated/UserPostResIdl";
import { requestQueue } from "./queue.ts";
import { ensureClient } from "./sdk.ts";
import { toNumber } from "./util.ts";

const ENDPOINT = "/c/u/feed/userpost?cmd=303002";
const CLIENT_VERSION_OLD = "8.9.8.5";

export type PostKind = "topic" | "reply" | "sub";

export interface PostRow {
	kind: PostKind;
	threadId: string;
	title: string;
	/** 正文摘要：主题帖取正文，回复取回复内容 */
	preview: string;
	forumName: string;
	createTime: number;
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
): Promise<any[]> {
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
		return (decoded?.data?.postList ?? []) as any[];
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
export async function loadTopicRows(
	uid: number,
	page: number,
): Promise<PostRow[]> {
	const raw = await fetchRaw(uid, 1, page);
	return raw.map((item) => ({
		kind: "topic" as const,
		threadId: String(item.threadId ?? ""),
		title: item.title || "",
		preview: textOf(item.firstPostContent),
		forumName: item.forumName || "",
		createTime: toNumber(item.createTime),
	}));
}

/** 一页回复（含楼中楼，楼中楼用 affiliated 标记）。 */
export async function loadReplyRows(
	uid: number,
	page: number,
): Promise<PostRow[]> {
	const raw = await fetchRaw(uid, 0, page);
	const posts = await requestQueue.run(async () => {
		const result = processUserPosts(raw as never, true);
		return (await Effect.runPromise(result)) as any[];
	});
	return (posts ?? []).map((post) => ({
		kind: post.affiliated ? ("sub" as const) : ("reply" as const),
		threadId: String(post.threadId ?? ""),
		title: post.title || post.content || "",
		preview: post.content || "",
		forumName: post.forumName || "",
		createTime: toNumber(post.createTime),
	}));
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
