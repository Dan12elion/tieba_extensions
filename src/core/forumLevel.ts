/**
 * 「他在某个吧的等级」——点了才查。
 *
 * 常规来源只有两个（见 userForums.ts）：`getLikeForum` 与 `panel.honor.grade`，
 * 两者都拿不到时（隐藏关注贴吧 + 没有用户名），还有最后一条路：
 * **他在这个吧发过帖子**，而帖子接口（`/c/f/pb/page`）返回的 `userList` 里，
 * 每个人的 `levelId` 就是他在**这个吧**的等级（实测：例子里的楼主 levelId=9）。
 *
 * 这条路要额外请求（每个吧最多 1~4 个），所以做成"点了才查"，
 * 查到的结果缓存起来，下次打开面板直接显示。
 */

import { getPosts } from "tieba.js";
import { callSdkLoose } from "./identity.ts";
import { loadReplyRows, loadTopicRows } from "./userPost.ts";
import { errorMessage, toNumber } from "./util.ts";

const CACHE_KEY = "tbEztbToolboxForumLevelV1";
const CACHE_MAX = 500;
/** 一个吧最多试几个帖子（他自己的主题帖最靠谱，排在最前面） */
const MAX_THREADS = 3;

interface CachedForumLevel {
	level: number;
	ts: number;
}

const memory = new Map<string, number>();
let disk: Record<string, CachedForumLevel> = loadDisk();

function loadDisk(): Record<string, CachedForumLevel> {
	try {
		const stored = GM_getValue<Record<string, CachedForumLevel>>(
			CACHE_KEY,
			{},
		);
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

const cacheKey = (targetId: number, forumName: string) =>
	`${targetId}:${forumName}`;

export function readForumLevelCache(
	targetId: number,
	forumName: string,
): number | null {
	const key = cacheKey(targetId, forumName);
	const hit = memory.get(key) ?? disk[key]?.level;
	return hit && hit > 0 ? hit : null;
}

function writeForumLevelCache(
	targetId: number,
	forumName: string,
	level: number,
): void {
	const key = cacheKey(targetId, forumName);
	memory.set(key, level);
	disk[key] = { level, ts: Date.now() };
	const keys = Object.keys(disk);
	if (keys.length > CACHE_MAX) {
		keys.sort((a, b) => (disk[a].ts ?? 0) - (disk[b].ts ?? 0));
		for (const stale of keys.slice(0, keys.length - CACHE_MAX)) {
			delete disk[stale];
		}
	}
	try {
		GM_setValue(CACHE_KEY, disk);
	} catch {
		/* 存储失败时至少内存里有效 */
	}
}

export function clearForumLevelCache(): void {
	memory.clear();
	disk = {};
	try {
		GM_setValue(CACHE_KEY, {});
	} catch {
		/* 忽略 */
	}
}

export interface ForumLevelResult {
	level?: number;
	/** 等级是从哪种帖子里读到的 */
	via?: "cache" | "topic" | "reply";
	/** 查不到时的原因（给界面显示用） */
	reason?: string;
}

interface ThreadCandidate {
	tid: string;
	via: "topic" | "reply";
}

/** 找出他在这个吧发过的帖子（先看自己的主题帖，再看回复过的帖子）。 */
async function findThreads(
	targetId: number,
	forumName: string,
): Promise<ThreadCandidate[]> {
	const candidates: ThreadCandidate[] = [];
	const collect = (rows: Array<{ forumName: string; threadId: string }>, via: ThreadCandidate["via"]) => {
		for (const row of rows) {
			if (row.forumName !== forumName || !row.threadId) continue;
			if (candidates.some((item) => item.tid === row.threadId)) continue;
			candidates.push({ tid: row.threadId, via });
		}
	};

	// 主题帖：他自己是 1 楼，一定出现在第 1 页，最可靠
	try {
		collect(await loadTopicRows(targetId, 1), "topic");
	} catch {
		/* 主题帖取不到就继续 */
	}
	if (!candidates.length) {
		try {
			collect(await loadReplyRows(targetId, 1), "reply");
		} catch {
			/* 回复也取不到就只能放弃 */
		}
	}
	return candidates;
}

/**
 * 查"他在这个吧的等级"。
 *
 * 只在用户点按钮时调用：每个候选帖子一次 `pb/page` 请求，最多 3 次。
 */
export async function fetchUserForumLevel(
	targetId: number,
	forumName: string,
): Promise<ForumLevelResult> {
	const cached = readForumLevelCache(targetId, forumName);
	if (cached) return { level: cached, via: "cache" };

	const candidates = await findThreads(targetId, forumName);
	if (!candidates.length) {
		return {
			reason: `最近一页帖子里没有他在「${forumName}」的帖子，读不到他在这个吧的等级`,
		};
	}

	let lastError = "";
	for (const candidate of candidates.slice(0, MAX_THREADS)) {
		try {
			const page: any = await callSdkLoose(() =>
				getPosts(Number(candidate.tid), 1, { rn: 30 }),
			);
			const users: any[] = page?.userList ?? [];
			const me = users.find((user) => String(user?.id) === String(targetId));
			const level = toNumber(me?.levelId);
			if (level > 0) {
				writeForumLevelCache(targetId, forumName, level);
				return { level, via: candidate.via };
			}
		} catch (error) {
			lastError = errorMessage(error);
		}
	}

	return {
		reason:
			lastError ||
			`在他这几个帖子的第 1 页里没找到他的楼层（回复可能在后几页），读不到等级`,
	};
}
