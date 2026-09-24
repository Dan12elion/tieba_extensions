/**
 * 「成分」结果缓存。
 *
 * 一个用户的成分要读关注吧 + 两路发帖 feed，成本不低；同一个用户在同一个帖子里
 * 可能连着出现十几次，所以结果必须缓存。缓存里记着规则指纹（rulesHash）：
 * 用户一改规则表，旧结果立刻失效，不需要手动清缓存。
 */

import type { CompositionHit } from "./composition.ts";
import type { CompositionScanStat } from "./compositionDetect.ts";
import { profileCacheKey } from "./cached.ts";
import { getSettings } from "./settings.ts";

const CACHE_KEY = "tbEztbToolboxCompositionCacheV1";
const CACHE_MAX = 300;

export interface CachedComposition {
	/** 生成这条结果时的规则指纹 */
	rulesHash: string;
	hits: CompositionHit[];
	stat: CompositionScanStat;
	ts: number;
}

const memory = new Map<string, CachedComposition>();
let disk: Record<string, CachedComposition> = loadDisk();

function loadDisk(): Record<string, CachedComposition> {
	try {
		const stored = GM_getValue<Record<string, CachedComposition>>(
			CACHE_KEY,
			{},
		);
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

function ttlMs(): number {
	const days = Number(getSettings().compositionCacheDays);
	const safe = Number.isFinite(days) && days > 0 ? days : 3;
	return safe * 24 * 60 * 60 * 1000;
}

/** 与资料缓存同一套 key 规则（头像串 → 用户 ID → 用户名）。 */
export function compositionCacheKey(ref: {
	portrait?: string;
	userId?: number | null;
	un?: string;
}): string | null {
	return profileCacheKey(ref);
}

export function readCompositionCache(
	key: string | null,
	rulesHash: string,
): CachedComposition | null {
	if (!key) return null;
	const hit = memory.get(key) ?? disk[key];
	if (!hit) return null;
	if (hit.rulesHash !== rulesHash || Date.now() - (hit.ts ?? 0) > ttlMs()) {
		memory.delete(key);
		delete disk[key];
		return null;
	}
	return hit;
}

export function writeCompositionCache(
	key: string | null,
	entry: Omit<CachedComposition, "ts">,
): void {
	if (!key) return;
	const value: CachedComposition = { ...entry, ts: Date.now() };
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

/** 只清内存：同一次会话里"重新检测"时要拿到最新数据。 */
export function dropCompositionMemory(): void {
	memory.clear();
}

export function clearCompositionCache(): void {
	memory.clear();
	disk = {};
	try {
		GM_setValue(CACHE_KEY, {});
	} catch {
		/* 忽略 */
	}
}
