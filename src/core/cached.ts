/** 用户资料缓存：避免同一用户反复解析，减少接口压力。 */

const CACHE_KEY = "tbEztbToolboxProfileCacheV1";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export interface CachedProfile {
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
	ts?: number;
}

const memory = new Map<string, CachedProfile>();
let disk: Record<string, CachedProfile> = loadDisk();

function loadDisk(): Record<string, CachedProfile> {
	try {
		const stored = GM_getValue<Record<string, CachedProfile>>(CACHE_KEY, {});
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

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
	const hit = memory.get(key) ?? disk[key];
	if (!hit) return null;
	if (Date.now() - (hit.ts ?? 0) > CACHE_TTL) {
		memory.delete(key);
		delete disk[key];
		return null;
	}
	return hit;
}

export function writeProfileCache(
	key: string | null,
	value: CachedProfile,
): void {
	if (!key) return;
	const entry = { ...value, ts: Date.now() };
	memory.set(key, entry);
	disk[key] = entry;
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
		/* 忽略存储失败 */
	}
}

export function clearProfileCache(): void {
	memory.clear();
	disk = {};
	try {
		GM_setValue(CACHE_KEY, {});
	} catch {
		/* 忽略 */
	}
}
