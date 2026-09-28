/**
 * 「这条回复在第几楼」——点了才查。
 *
 * 用户发帖 feed（`/c/u/feed/userpost`）里**没有楼层号**：
 * `PostInfoList` 只有 threadId / postId / content[]，`Post.floor` 不在其中。
 * 楼层号只存在于帖子接口一侧，实测（2026-09-27）`/c/f/pb/floor?cmd=303002`
 * （SDK 的 `getComments`）返回的 `data.post.floor` 就是它，而且两种情况都适用：
 *
 *   - 普通回复：pid 就是那一楼自己的帖子 ID → `floor=3`
 *   - 楼中楼：pid 是楼中楼那条的帖子 ID → `floor` 是**它所在的那一楼**（实测 2），
 *     同一次返回里的 `data.post.content` 还是那一楼的正文，正好用来说明"回的是哪一楼"
 *
 * 一条回复 = 一个请求，所以做成"点了才查"，结果写缓存（下次打开面板直接显示）。
 */

import { getComments } from "tieba.js";
import { callSdkLoose } from "./identity.ts";
import { type KvEntry, createKvCache } from "./kvCache.ts";
import { errorMessage, toNumber } from "./util.ts";

const CACHE_KEY = "tbEztbToolboxReplyFloorV1";
const CACHE_MAX = 800;

interface CachedReplyFloor extends KvEntry {
	floor: number;
	/** 那一楼的正文摘要（可能是空的：被删、只有图片、或那一楼本身没文字） */
	excerpt: string;
}

const cache = createKvCache<CachedReplyFloor>({
	storageKey: CACHE_KEY,
	max: CACHE_MAX,
	validate: (entry) => entry.floor > 0,
});

const cacheKey = (threadId: string, postId: string) =>
	`${threadId}:${postId}`;

export function readReplyFloorCache(
	threadId: string,
	postId: string,
): CachedReplyFloor | null {
	return cache.read(cacheKey(threadId, postId));
}

function writeReplyFloorCache(
	threadId: string,
	postId: string,
	floor: number,
	excerpt: string,
): CachedReplyFloor {
	return cache.write(cacheKey(threadId, postId), { floor, excerpt });
}

export function clearReplyFloorCache(): void {
	cache.clear();
}

export interface ReplyFloorResult {
	floor?: number;
	/** 那一楼的正文摘要（给界面当上下文用） */
	excerpt?: string;
	via?: "cache" | "request";
	/** 查不到时的原因（给界面显示用） */
	reason?: string;
}

function contentText(contents: unknown): string {
	if (!Array.isArray(contents)) return "";
	return contents
		.map((item: any) => item?.text ?? "")
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 查一条回复所在的楼层。
 *
 * 只在用户点按钮时调用：一条记录一次 `/c/f/pb/floor` 请求。
 */
export async function fetchReplyFloor(
	threadId: string,
	postId: string,
): Promise<ReplyFloorResult> {
	const tid = toNumber(threadId);
	const pid = toNumber(postId);
	if (!tid || !pid) {
		return { reason: "这条记录没有楼层可查（缺 threadId / postId）" };
	}

	const cached = readReplyFloorCache(threadId, postId);
	if (cached) {
		return {
			floor: cached.floor,
			excerpt: cached.excerpt,
			via: "cache",
		};
	}

	try {
		const data: any = await callSdkLoose(() =>
			getComments({ tid, pid, pn: 1 }),
		);
		const floor = toNumber(data?.post?.floor);
		if (!(floor > 0)) {
			return {
				reason: "贴吧没有返回楼层号（这一楼可能已被删除）",
			};
		}
		const entry = writeReplyFloorCache(
			threadId,
			postId,
			floor,
			contentText(data?.post?.content),
		);
		return { floor: entry.floor, excerpt: entry.excerpt, via: "request" };
	} catch (error) {
		return { reason: errorMessage(error) };
	}
}
