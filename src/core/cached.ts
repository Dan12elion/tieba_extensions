/** 用户资料缓存：避免同一用户反复解析，减少接口压力。 */

import { type KvEntry, createKvCache } from "./kvCache.ts";

const CACHE_KEY = "tbEztbToolboxProfileCacheV1";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export interface CachedProfile extends KvEntry {
	id?: number;
	uid?: string;
	un?: string;
	nickname?: string;
	portrait?: string;
	/** 吧内等级 */
	level?: number;
	/** 吧龄，例如「11.0」 */
	tbAge?: string;
	postNum?: number;
	fansNum?: number;
	concernNum?: number;
	likeNum?: number;
	intro?: string;
	/** IP 属地 */
	ip?: string;
	/** 资料接口里带着的"关注贴吧"名单（成分检测与隐藏关注贴吧的恢复都用它） */
	likeForum?: string[];
	/** 1 = 男，2 = 女 */
	gender?: number;
	isBawu?: boolean;
	bawuType?: string;
	vipLevel?: number;
}

/**
 * 不带时间戳的资料。
 *
 * 面板拿到的 profile 不带 `ts`（只有缓存条目才需要它），所有属性都可选，
 * 所以 `profile ?? {}` 这种写法仍然能正常取字段。
 */
export type ProfileData = Omit<CachedProfile, "ts">;

const cache = createKvCache<CachedProfile>({
	storageKey: CACHE_KEY,
	max: CACHE_MAX,
	ttlMs: CACHE_TTL,
});

function stripQuery(value: string): string {
	return value.split("?")[0];
}

export function profileCacheKey(ref: {
	portrait?: string;
	userId?: number | null;
	un?: string;
}): string | null {
	if (ref.portrait) return `p:${stripQuery(ref.portrait)}`;
	if (ref.userId) return `u:${ref.userId}`;
	if (ref.un) return `n:${ref.un}`;
	return null;
}

export function readProfileCache(key: string | null): CachedProfile | null {
	if (!key) return null;
	return cache.read(key);
}

export function writeProfileCache(
	key: string | null,
	value: ProfileData,
): void {
	if (!key) return;
	cache.write(key, value);
}

export function clearProfileCache(): void {
	cache.clear();
}
