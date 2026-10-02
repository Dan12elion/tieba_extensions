/**
 * 「成分」结果缓存。
 *
 * 一个用户的成分要读关注吧 + 两路发帖 feed，成本不低；同一个用户在同一个帖子里
 * 可能连着出现十几次，所以结果必须缓存。缓存里记着规则指纹（rulesHash）：
 * 用户一改规则表，旧结果立刻失效，不需要手动清缓存。
 */

import { type KvEntry, createKvCache } from "./kvCache.ts";
import type { CompositionHit } from "./composition.ts";
import type { CompositionScanStat } from "./compositionDetect.ts";
import { profileCacheKey } from "./cached.ts";
import { getSettings } from "./settings.ts";

const CACHE_KEY = "tbEztbToolboxCompositionCacheV1";
const CACHE_MAX = 300;

/**
 * 结果的形状版本（不是存储键名版本）。
 *
 * 1.10.0 给证据加了 `at` / `post`（时间、跳转、楼层都要用），
 * 旧缓存里没有这些字段——读出来会渲染成"没有时间和链接的证据"，看起来像功能没生效。
 * 所以带上这个数字，对不上就当没缓存（重新检测一次），**不改存储键名**
 * （改键名会让用户已经攒下的缓存整块孤立，没必要）。
 */
const CACHE_SCHEMA = 2;

export interface CachedComposition extends KvEntry {
	/** 生成这条结果时的规则指纹 */
	rulesHash: string;
	/** 结果结构的版本，见 CACHE_SCHEMA */
	schema?: number;
	hits: CompositionHit[];
	stat: CompositionScanStat;
}

function ttlMs(): number {
	const days = Number(getSettings().compositionCacheDays);
	const safe = Number.isFinite(days) && days > 0 ? days : 3;
	return safe * 24 * 60 * 60 * 1000;
}

const cache = createKvCache<CachedComposition>({
	storageKey: CACHE_KEY,
	max: CACHE_MAX,
	ttlMs,
});

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
	const hit = cache.read(key);
	// 规则指纹对不上就整条作废：用户改过规则表，旧结论不能再用
	if (!hit || hit.rulesHash !== rulesHash) {
		if (hit) cache.delete(key);
		return null;
	}
	// 结构版本对不上也作废（老结果缺少时间 / 跳转信息，见 CACHE_SCHEMA）
	if (hit.schema !== CACHE_SCHEMA) {
		cache.delete(key);
		return null;
	}
	return hit;
}

export function writeCompositionCache(
	key: string | null,
	entry: Omit<CachedComposition, "ts" | "schema">,
): void {
	if (!key) return;
	cache.write(key, { ...entry, schema: CACHE_SCHEMA });
}

/** 只清内存：同一次会话里"重新检测"时要拿到最新数据。 */
export function dropCompositionMemory(): void {
	cache.clearMemory();
}

export function clearCompositionCache(): void {
	cache.clear();
}
