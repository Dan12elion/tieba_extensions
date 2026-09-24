/**
 * 后台成分检测的调度。
 *
 * 页面扫描器每认出一个用户就调 registerUserForComposition：
 *   - 命中缓存 → 立刻把徽章贴上去（不发请求）
 *   - 没缓存   → 排进队列，一个个串行检测（所有请求仍走 requestQueue 的限速）
 *
 * 三条硬约束，都是为了避免把脚本变成刷接口的工具：
 *   1. 只在用户配置了关键词规则时才工作；规则为空则一个请求都不发；
 *   2. 同一个用户只查一次（内存 + 落盘缓存）；
 *   3. 每页最多检测 N 个人（设置里可改，默认 20），超出的不再排队。
 */

import {
	type CompositionHit,
	hashRules,
	parseRules,
} from "../core/composition.ts";
import {
	compositionCacheKey,
	clearCompositionCache,
	dropCompositionMemory,
	readCompositionCache,
	writeCompositionCache,
} from "../core/compositionCache.ts";
import {
	type CompositionScanStat,
	detectComposition,
} from "../core/compositionDetect.ts";
import { resolveIdentity } from "../core/identity.ts";
import { getSettings, hasBduss } from "../core/settings.ts";
import type { UserRef } from "../page/adapters.ts";
import { clearBadges, renderBadges } from "../page/badges.ts";

export interface CompositionCheckResult {
	hits: CompositionHit[];
	stat: CompositionScanStat;
	/** 结果是否来自缓存（面板上会说明） */
	fromCache: boolean;
	/** 规则表是空的，什么都没查 */
	noRules?: boolean;
	/** 还没填 BDUSS */
	noBduss?: boolean;
}

const emptyStat = (): CompositionScanStat => ({
	forums: 0,
	forumsRecovered: 0,
	topics: 0,
	replies: 0,
	failed: [],
});

/** 页面内已经登记过的按钮：key → 按钮集合（同一个用户可能在页面上出现多次） */
const buttonsByKey = new Map<string, Set<HTMLElement>>();
/** 页面内已经登记过的用户：key → ref（重新检测整页时用） */
const refsByKey = new Map<string, UserRef>();
/** 已经查过的 key（内存层，避免同一页反复查） */
const checkedKeys = new Set<string>();
/** 排队中的任务：key → 是否强制跳过缓存（Map 保持插入顺序，逐个串行处理） */
const pending = new Map<string, boolean>();

let draining = false;
let noBdussWarned = false;

function rulesText(): string {
	return getSettings().compositionRules;
}

function rulesHash(): string {
	return hashRules(rulesText());
}

function hasRules(): boolean {
	return parseRules(rulesText()).length > 0;
}

function maxPerPage(): number {
	const value = Number(getSettings().compositionMaxPerPage);
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}

function applyToButtons(key: string, hits: CompositionHit[]): void {
	const ref = refsByKey.get(key);
	const buttons = buttonsByKey.get(key);
	if (!ref || !buttons) return;
	for (const button of buttons) {
		if (!button.isConnected) continue;
		if (hits.length) renderBadges(button, hits, ref);
		else clearBadges(button);
	}
}

/**
 * 检测一个用户。
 *
 * 页面后台检测和面板里的「成分」页签共用这一条路径，所以两边看到的结论一定一致。
 */
export async function checkUser(
	ref: UserRef,
	options: { force?: boolean } = {},
): Promise<CompositionCheckResult> {
	const key = compositionCacheKey(ref);
	if (!hasRules()) {
		return { hits: [], stat: emptyStat(), fromCache: false, noRules: true };
	}
	if (!hasBduss()) {
		return { hits: [], stat: emptyStat(), fromCache: false, noBduss: true };
	}

	if (!options.force && key) {
		const cached = readCompositionCache(key, rulesHash());
		if (cached) {
			applyToButtons(key, cached.hits);
			return { hits: cached.hits, stat: cached.stat, fromCache: true };
		}
	}

	const rules = parseRules(rulesText());
	const identity = await resolveIdentity(ref, options.force === true);
	const detection = await detectComposition(
		{
			id: identity.id,
			uid: identity.uid,
			// profile 里带着关注贴吧名单，交给检测去补齐 / 恢复隐藏的部分
			profileForums: identity.profile?.likeForum ?? [],
		},
		rules,
	);

	if (key) {
		writeCompositionCache(key, {
			rulesHash: rulesHash(),
			hits: detection.hits,
			stat: detection.stat,
		});
		checkedKeys.add(key);
		applyToButtons(key, detection.hits);
	}

	return { hits: detection.hits, stat: detection.stat, fromCache: false };
}

function enqueue(key: string, ref: UserRef, force = false): void {
	if (pending.has(key) || checkedKeys.has(key)) return;
	if (checkedKeys.size + pending.size >= maxPerPage()) return;
	refsByKey.set(key, ref);
	if (force) pending.set(key, true);
	else if (!pending.has(key)) pending.set(key, false);
	void drain();
}

async function drain(): Promise<void> {
	if (draining) return;
	draining = true;
	try {
		while (pending.size) {
			const key = pending.keys().next().value as string;
			const force = pending.get(key) === true;
			pending.delete(key);
			const ref = refsByKey.get(key);
			if (!ref) continue;
			if (checkedKeys.has(key)) continue;
			checkedKeys.add(key);
			try {
				await checkUser(ref, { force });
			} catch (error) {
				// 单个用户失败（比如对方设置了隐私）不影响其他人
				console.warn("[eztb] 成分检测失败", error);
			}
		}
	} finally {
		draining = false;
	}
}

/** 扫描器认出一个用户时调用：先贴缓存，没缓存就排队。 */
export function registerUserForComposition(
	ref: UserRef,
	button: HTMLElement,
): void {
	const key = compositionCacheKey(ref);
	if (!key) return;

	let buttons = buttonsByKey.get(key);
	if (!buttons) {
		buttons = new Set();
		buttonsByKey.set(key, buttons);
	}
	buttons.add(button);
	if (!refsByKey.has(key)) refsByKey.set(key, ref);

	if (!hasRules()) return;
	if (!hasBduss()) {
		if (!noBdussWarned) {
			noBdussWarned = true;
			console.warn("[eztb] 还没设置 BDUSS，成分检测不会工作");
		}
		return;
	}

	const cached = readCompositionCache(key, rulesHash());
	if (cached) {
		applyToButtons(key, cached.hits);
		return;
	}
	enqueue(key, ref);
}

/** 「重新检测本页用户」：清内存缓存后把所有登记过的用户重新排队。 */
export function rescanPage(): void {
	dropCompositionMemory();
	checkedKeys.clear();
	pending.clear();
	for (const [key, ref] of refsByKey) {
		for (const button of buttonsByKey.get(key) ?? []) clearBadges(button);
		// 必须带 force：否则 checkUser 会从落盘缓存里读回旧结果，"重新检测"变成空操作
		enqueue(key, ref, true);
	}
}

export { clearCompositionCache };
