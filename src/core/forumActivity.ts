/**
 * 「他最近在哪些吧发过言」——点了才查。
 *
 * 等级与活跃度不符（等级高、几乎不发言）的判定需要两样东西：
 *   1. 吧内等级 → 面板「关注的吧」本来就有（getLikeForum / panel.honor.grade）
 *   2. 该吧的发言条数 → 没有"按吧统计发帖"的接口，只能用**发帖 feed 的最近一页**
 *      （主题帖 60 条 + 回复 60 条）自己数。两次请求就能覆盖所有吧，
 *      比"每个吧查一次"便宜得多。
 *
 * 因为多花两个请求，所以做成"点了才查"，结果按天缓存。
 * 判定本身是纯逻辑，在 activityRule.ts。
 */

import { countPostsByForum } from "./activityRule.ts";
import { loadReplyPage, loadTopicPage } from "./userPost.ts";
import { errorMessage } from "./util.ts";

const CACHE_KEY = "tbEztbToolboxForumActivityV1";
const CACHE_MAX = 300;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface ForumActivity {
	/** 吧名 → 最近一页发帖里他在该吧的发言条数 */
	byForum: Record<string, number>;
	/** 样本大小 */
	topics: number;
	replies: number;
	/** 对方的发帖记录被隐藏了：活跃度无从判断 */
	hidden: boolean;
	/** 取数失败的部分（局部失败不影响其余） */
	failed: string[];
	ts: number;
}

const memory = new Map<string, ForumActivity>();
let disk: Record<string, ForumActivity> = loadDisk();

function loadDisk(): Record<string, ForumActivity> {
	try {
		const stored = GM_getValue<Record<string, ForumActivity>>(CACHE_KEY, {});
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

/** 同步读缓存（面板渲染时就地补上，不用等请求）。过期或隐藏的结果不返回。 */
export function readForumActivityCache(
	uid: number,
	maxAgeMs = TTL_MS,
): ForumActivity | null {
	const key = String(uid);
	const hit = memory.get(key) ?? disk[key];
	if (!hit) return null;
	if (Date.now() - (hit.ts ?? 0) > maxAgeMs) return null;
	if (hit.hidden) return null;
	return hit;
}

function writeForumActivityCache(uid: number, value: ForumActivity): void {
	const key = String(uid);
	memory.set(key, value);
	disk[key] = value;

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

export function clearForumActivityCache(): void {
	memory.clear();
	disk = {};
	try {
		GM_setValue(CACHE_KEY, {});
	} catch {
		/* 忽略 */
	}
}

/**
 * 取「最近一页发帖」并按吧统计。两次请求，走串行限速队列。

 * `force` 为 true 时忽略缓存重新取（面板上的「重新检测」用）。
 */
export async function loadForumActivity(
	uid: number,
	force = false,
): Promise<ForumActivity> {
	if (!force) {
		const cached = readForumActivityCache(uid);
		if (cached) return cached;
	}

	const failed: string[] = [];
	const rows: Array<{ forumName: string }> = [];
	let topics = 0;
	let replies = 0;
	let hidden = false;

	try {
		const page = await loadTopicPage(uid, 1);
		topics = page.rows.length;
		hidden = hidden || page.hidden;
		rows.push(...page.rows);
	} catch (error) {
		failed.push(`主题帖：${errorMessage(error)}`);
	}
	try {
		const page = await loadReplyPage(uid, 1);
		replies = page.rows.length;
		hidden = hidden || page.hidden;
		rows.push(...page.rows);
	} catch (error) {
		failed.push(`回复：${errorMessage(error)}`);
	}

	const value: ForumActivity = {
		byForum: countPostsByForum(rows),
		topics,
		replies,
		hidden,
		failed,
		ts: Date.now(),
	};
	// 失败或者被隐藏的结果不写缓存：下次点还要能重新取
	if (!failed.length && !hidden) writeForumActivityCache(uid, value);
	return value;
}
