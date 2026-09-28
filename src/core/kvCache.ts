/**
 * 油猴存储的 KV 缓存工厂。
 *
 * 抽出来的原因：资料 / 成分 / 吧内等级 / 回复楼层 / 签到检测这五个缓存，
 * 各自抄了一遍「内存 Map + 磁盘 Record + TTL + 按 ts 淘汰 + GM_setValue」，
 * 五份实现里的存盘失败还都被 `try/catch` 静默吞掉了——用户以为缓存住了，
 * 其实一条都没写进去，界面上也看不到任何提示。
 *
 * 这里统一成一份，并且：
 *   1. 磁盘里存的就是条目本身（带 `ts`），所以**老版本写下的数据仍然读得出来**；
 *   2. 存盘失败会记进 `getStorageIssues()`（诊断面板可以显示），并降级重试
 *      ——撞上油猴的存储配额时砍掉一半再写一次，而不是整块丢掉；
 *   3. 磁盘读取是懒的：没用到某个缓存就不会去读它。
 */

import { log } from "./log.ts";

export interface KvEntry {
	ts: number;
}

export interface KvCacheOptions<T extends KvEntry> {
	/** 油猴存储的键名 */
	storageKey: string;
	/** 最多保留多少条，超出按 ts 淘汰最旧的 */
	max: number;
	/**
	 * 过期时间（毫秒）。传函数则每次读取时求值
	 * ——「成分缓存天数」是设置项，改完设置要立刻生效。
	 * 不传表示不过期。
	 */
	ttlMs?: number | (() => number);
	/**
	 * 额外的有效性判断：返回 false 视同过期。
	 * 目前用于「隐藏了发帖记录的结果不算数」这种带业务含义的过滤。
	 */
	validate?: (entry: T) => boolean;
}

export interface KvCache<T extends KvEntry> {
	read(key: string): T | null;
	/** 写入并补上 ts；返回落库后的完整条目 */
	write(key: string, value: Omit<T, "ts">): T;
	delete(key: string): void;
	/** 内存 + 磁盘一起清空 */
	clear(): void;
	/** 只清内存：同一次会话里"重新检测"时要拿到最新数据 */
	clearMemory(): void;
	/** 磁盘里的条数（会触发一次读取） */
	count(): number;
}

export interface KvStorageIssue {
	storageKey: string;
	message: string;
	at: number;
}

const issues: KvStorageIssue[] = [];

/** 存储写入失败的历史（去重）。诊断面板用来回答"为什么设置没生效"。 */
export function getStorageIssues(): KvStorageIssue[] {
	return issues.slice();
}

function noteStorageIssue(storageKey: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (
		issues.some(
			(issue) => issue.storageKey === storageKey && issue.message === message,
		)
	) {
		return;
	}
	issues.push({ storageKey, message, at: Date.now() });
	log.warn(
		`写入油猴存储失败（${storageKey}）：${message}` +
			"。通常是存储配额已满，本次结果可能不会保留。",
	);
}

export function createKvCache<T extends KvEntry>(
	options: KvCacheOptions<T>,
): KvCache<T> {
	const { storageKey, max } = options;
	const memory = new Map<string, T>();
	/** 懒加载：第一次真正用到这个缓存时才读磁盘 */
	let disk: Record<string, T> | null = null;

	const load = (): Record<string, T> => {
		if (disk) return disk;
		try {
			const stored = GM_getValue<Record<string, T>>(storageKey, {});
			disk = stored && typeof stored === "object" ? stored : {};
		} catch {
			disk = {};
		}
		return disk;
	};

	const ttlMs = (): number => {
		const raw =
			typeof options.ttlMs === "function" ? options.ttlMs() : options.ttlMs;
		return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
	};

	const isUsable = (entry: T): boolean => {
		if (!entry || typeof entry !== "object") return false;
		const limit = ttlMs();
		if (limit > 0 && Date.now() - (entry.ts ?? 0) > limit) return false;
		if (options.validate && !options.validate(entry)) return false;
		return true;
	};

	const drop = (key: string): void => {
		memory.delete(key);
		const store = load();
		if (key in store) delete store[key];
	};

	const persist = (store: Record<string, T>): boolean => {
		try {
			GM_setValue(storageKey, store);
			return true;
		} catch (error) {
			noteStorageIssue(storageKey, error);
			return false;
		}
	};

	const trim = (store: Record<string, T>, limit: number): void => {
		const keys = Object.keys(store);
		if (keys.length <= limit) return;
		keys.sort((a, b) => (store[a]?.ts ?? 0) - (store[b]?.ts ?? 0));
		for (const stale of keys.slice(0, keys.length - limit)) {
			delete store[stale];
		}
	};

	return {
		read(key: string): T | null {
			const hit = memory.get(key) ?? load()[key];
			if (!hit) return null;
			if (!isUsable(hit)) {
				// 过期的条目直接从内存里拿掉，但**不落盘**——否则每读一次都要写一次存储
				drop(key);
				return null;
			}
			memory.set(key, hit);
			return hit;
		},

		write(key: string, value: Omit<T, "ts">): T {
			const entry = { ...value, ts: Date.now() } as T;
			const store = load();
			memory.set(key, entry);
			store[key] = entry;
			trim(store, max);
			if (!persist(store)) {
				// 存不进去多半是撞了油猴的存储配额：砍一半再试，宁可少留几条也别整块丢
				trim(store, Math.max(1, Math.floor(max / 2)));
				persist(store);
			}
			return entry;
		},

		delete(key: string): void {
			drop(key);
		},

		clear(): void {
			memory.clear();
			disk = {};
			persist({});
		},

		clearMemory(): void {
			memory.clear();
		},

		count(): number {
			return Object.keys(load()).length;
		},
	};
}
