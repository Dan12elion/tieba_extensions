/**
 * 请求层的重试、退避与熔断。
 *
 * 以前（1.8.4 及之前）请求只有**一次**机会：一次网络抖动 = 那一路数据直接没了
 * （面板里写「取数失败」，饼图上少一块），用户只能手动刷新再试。
 * 现在分两层：
 *
 *   1. **重试**：只对网络类错误（连不上 / 超时）重试，最多 3 次尝试，退避 700ms → 1400ms。
 *      **业务错误码不重试**——服务端已经明确答复了，重试只是白费一次请求。
 *   2. **熔断**：连续 5 次请求最终失败就暂停 30 秒，期间新的请求立刻失败并说明原因，
 *      不再让用户对着转圈等。成功一次就清零。
 *
 * 熔断上限刻意做得很保守：这是给「网络断了 / 被风控」这种情况一个明确的说法，
 * 而不是替用户决定"别再查了"。诊断面板里可以一键重置。
 *
 * 重试发生在**同一个限速名额内部**（见 shims/undici.ts），所以不会绕过 SerialQueue
 * 的串行约束；退避时间（≥700ms）本身也比默认间隔长。
 */

import { log } from "./log.ts";

/** 一次操作最多尝试几次（含首次） */
export const RETRY_MAX_ATTEMPTS = 3;
/** 首次重试前等多久，之后翻倍 */
export const RETRY_BASE_DELAY_MS = 700;
/** 连续失败多少次就熔断 */
export const BREAKER_FAILURE_THRESHOLD = 5;
/** 熔断后暂停多久 */
export const BREAKER_COOLDOWN_MS = 30_000;

/** 熔断期间发起请求会立刻收到这个错误 */
export class RequestPausedError extends Error {
	readonly remainingMs: number;

	constructor(remainingMs: number) {
		super(
			`连续 ${BREAKER_FAILURE_THRESHOLD} 次请求失败，已暂停请求约 ${Math.ceil(remainingMs / 1000)} 秒；` +
				`可在「诊断当前页面」里点「重置熔断」立即恢复`,
		);
		this.name = "RequestPausedError";
		this.remainingMs = remainingMs;
	}
}

/**
 * 这个错误值不值得重试。
 *
 * 只看网络层：连不上、超时。业务错误码（TiebaServerError）与参数错误一律不重试。
 */
export function isRetryableError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const kind = (error as { kind?: unknown }).kind;
	if (kind === "network" || kind === "timeout") return true;
	// SDK 的 FetchError（HTTP >= 400 / 网络层），不 import SDK 也能认出来
	const tag = (error as { _tag?: unknown })._tag;
	if (tag === "FetchError") return true;
	return (error as { name?: unknown }).name === "FetchError";
}

let consecutiveFailures = 0;
let openUntil = 0;
let pausedRequests = 0;

export interface BreakerSnapshot {
	open: boolean;
	consecutiveFailures: number;
	openUntil: number;
	remainingMs: number;
	/** 熔断期间被直接挡回去的请求数（诊断报告用） */
	pausedRequests: number;
	threshold: number;
	cooldownMs: number;
}

export function breakerSnapshot(now = Date.now()): BreakerSnapshot {
	const remainingMs = Math.max(0, openUntil - now);
	return {
		open: remainingMs > 0,
		consecutiveFailures,
		openUntil,
		remainingMs,
		pausedRequests,
		threshold: BREAKER_FAILURE_THRESHOLD,
		cooldownMs: BREAKER_COOLDOWN_MS,
	};
}

export function recordRequestSuccess(): void {
	consecutiveFailures = 0;
	openUntil = 0;
}

export function recordRequestFailure(now = Date.now()): void {
	consecutiveFailures += 1;
	if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD && openUntil <= now) {
		openUntil = now + BREAKER_COOLDOWN_MS;
	}
}

export function resetBreaker(): void {
	consecutiveFailures = 0;
	openUntil = 0;
	pausedRequests = 0;
}

/** 给界面用的一句话；没熔断时返回 null */
export function breakerNotice(now = Date.now()): string | null {
	const snapshot = breakerSnapshot(now);
	if (!snapshot.open) return null;
	return `已暂停请求（连续失败 ${snapshot.consecutiveFailures} 次），约 ${Math.ceil(snapshot.remainingMs / 1000)} 秒后自动恢复`;
}

/** 测试用的注入点：默认就是真的 Date.now / setTimeout */
export interface PolicyDeps {
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

export async function withRequestPolicy<T>(
	task: () => Promise<T>,
	label = "请求",
	deps: PolicyDeps = {},
): Promise<T> {
	const now = deps.now ?? Date.now;
	const sleep =
		deps.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	for (let attempt = 1; ; attempt += 1) {
		const snapshot = breakerSnapshot(now());
		if (snapshot.open) {
			pausedRequests += 1;
			throw new RequestPausedError(snapshot.remainingMs);
		}
		try {
			const result = await task();
			recordRequestSuccess();
			return result;
		} catch (error) {
			if (isRetryableError(error) && attempt < RETRY_MAX_ATTEMPTS) {
				const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
				log.warn(
					`${label}失败（第 ${attempt}/${RETRY_MAX_ATTEMPTS} 次尝试），${delay}ms 后重试`,
					error,
				);
				await sleep(delay);
				continue;
			}
			recordRequestFailure(now());
			const after = breakerSnapshot(now());
			if (after.open) {
				log.warn(
					`已连续失败 ${after.consecutiveFailures} 次，暂停请求 ${Math.round(after.cooldownMs / 1000)} 秒`,
				);
			}
			throw error;
		}
	}
}
