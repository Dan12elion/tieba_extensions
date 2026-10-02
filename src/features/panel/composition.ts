/**
 * 「成分」页签：把关键词命中的结论摆出来。
 *
 * 输入：面板编排层传进来的容器元素、被查看的用户引用 ref（检测要重新按它取数）
 * 与 force（「重新检测」要绕过缓存）；不持有任何模块级状态。
 */

import {
	badgeHue,
	newestEvidenceAt,
	parseRules,
} from "../../core/composition.ts";
import { buildEvidenceHtml } from "../../core/evidenceHtml.ts";
import { describeRequestError } from "../../core/errno.ts";
import { fetchReplyFloor, readReplyFloorCache } from "../../core/replyFloor.ts";
import { getSettings } from "../../core/settings.ts";
import { escapeHtml, formatTimestamp } from "../../core/util.ts";
import type { UserRef } from "../../page/adapters.ts";
import { type CompositionCheckResult, checkUser } from "../compositionScan.ts";
import { openSettingsDialog } from "../settingsDialog.ts";

/**
 * 给证据行上的「查楼层」绑事件。
 *
 * 与「发帖」页签同一套做法（也是为了同一件事）：楼层号不在发帖 feed 里，
 * 一条回复一次 `/c/f/pb/floor` 请求，所以**点了才查**，查过写缓存
 * （下次渲染时 `buildEvidenceHtml` 直接写「N楼」）。
 */
function bindFloorButtons(root: HTMLElement): void {
	for (const button of Array.from(
		root.querySelectorAll<HTMLButtonElement>(".tb-eztb-floorbtn"),
	)) {
		if (button.dataset.bound === "1") continue;
		button.dataset.bound = "1";
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (button.disabled) return;
			const threadId = button.dataset.thread ?? "";
			const postId = button.dataset.post ?? "";
			if (!threadId || !postId) return;
			button.disabled = true;
			button.textContent = "查询中…";
			void (async () => {
				const result = await fetchReplyFloor(threadId, postId);
				if (result.floor) {
					const span = document.createElement("span");
					span.className = "tb-eztb-floor";
					span.textContent = `${result.floor}楼`;
					span.title = result.excerpt
						? `${result.floor} 楼的内容：${result.excerpt}`
						: `${result.floor} 楼`;
					button.replaceWith(span);
					return;
				}
				button.disabled = false;
				button.textContent = "查不到";
				button.title = result.reason ?? "没查到";
			})();
		});
	}
}

/**
 * 「成分」页签：把关键词命中的结论摆出来，命中的关键词在原文里高亮。
 *
 * 检测本身走 features/compositionScan.ts 的 checkUser——与页面上自动标注是同一条路径，
 * 所以「页面上标了什么」和「面板里说了什么」不会打架。
 */
export function renderCompositionTab(
	body: HTMLElement,
	ref: UserRef,
	force = false,
): void {
	body.innerHTML = `<div class="tb-eztb-loading"><div class="tb-eztb-spinner"></div>正在检测成分…</div>`;

	const actions = (html: string) =>
		`<div class="tb-eztb-actions" style="justify-content:flex-start;margin-top:12px;">${html}</div>`;

	void (async () => {
		let result: CompositionCheckResult;
		try {
			result = await checkUser(ref, { force });
		} catch (error) {
			body.innerHTML =
				`<div class="tb-eztb-error">${escapeHtml(describeRequestError(error))}</div>` +
				actions(
					`<button type="button" data-act="recheck" class="primary">重试</button>`,
				);
			bindRecheck();
			return;
		}

		if (result.noRules) {
			body.innerHTML =
				`<div class="tb-eztb-hint">还没有配置成分关键词规则，因此没有做任何检测（也没有发出请求）。</div>` +
				actions(
					`<button type="button" data-act="settings">去配置关键词</button>`,
				);
			body
				.querySelector('[data-act="settings"]')
				?.addEventListener("click", () => openSettingsDialog());
			return;
		}

		if (result.noBduss) {
			body.innerHTML =
				`<div class="tb-eztb-warn">成分检测需要读取关注吧与发帖，请先设置 BDUSS。</div>` +
				actions(
					`<button type="button" data-act="settings" class="primary">去设置 BDUSS</button>`,
				);
			body
				.querySelector('[data-act="settings"]')
				?.addEventListener("click", () =>
					openSettingsDialog({ requireBduss: true }),
				);
			return;
		}

		const { hits, stat } = result;
		const statLine =
			`已检查：关注的吧 ${stat.forums} 个` +
			(stat.forumsRecovered
				? `（其中 ${stat.forumsRecovered} 个来自隐藏关注贴吧的恢复）`
				: "") +
			` · 主题帖 ${stat.topics} 条 · 回复 ${stat.replies} 条` +
			(result.fromCache ? "（来自缓存）" : "");

		const rules = parseRules(getSettings().compositionRules);
		const hitBlocks = hits
			.map((hit) => {
				/*
				 * 证据行：类型标签（主题帖 / 回复 / 楼中楼）、时间、命中的词与原文，
				 * 以及"跳到那条帖子"的链接；回复与楼中楼还要「查楼层」（点了才查）。
				 * 顺序由 core/composition.ts 的 sortHitsByRecency 决定：最近的排前面。
				 */
				const evidences = hit.evidences
					.map((evidence) =>
						buildEvidenceHtml(evidence, {
							floorFor: (target) =>
								readReplyFloorCache(target.threadId, target.postId)?.floor ??
								null,
						}),
					)
					.join("");
				const newest = newestEvidenceAt(hit);
				return (
					`<div class="tb-eztb-hit">` +
					`<div class="tb-eztb-hit-head">` +
					`<span class="tb-eztb-badge" style="--tb-eztb-badge-hue:${badgeHue(hit.rule.name)}">${escapeHtml(hit.rule.name)}</span>` +
					(hit.sure
						? ""
						: `<span class="tb-eztb-hit-unsure">证据较弱，可能是误判</span>`) +
					(newest
						? `<span class="tb-eztb-hit-newest">最近依据 ${escapeHtml(formatTimestamp(newest))}</span>`
						: "") +
					`</div>` +
					evidences +
					`</div>`
				);
			})
			.join("");

		const body_ =
			(hits.length
				? `<div class="tb-eztb-hint">命中 ${hits.length} 条规则（共配置 ${rules.length} 条）</div>` +
					`<div class="tb-eztb-hits">${hitBlocks}</div>`
				: `<div class="tb-eztb-empty">没有命中任何关键词：这个用户关注的吧与发帖里都没出现规则表中的词。</div>`) +
			`<div class="tb-eztb-hint" style="margin-top:12px;">${escapeHtml(statLine)}</div>` +
			(stat.failed.length
				? `<div class="tb-eztb-warn">部分数据没取到：${escapeHtml(stat.failed.join("；"))}</div>`
				: "") +
			actions(
				`<button type="button" data-act="recheck">重新检测</button>` +
					`<button type="button" data-act="settings">关键词设置</button>`,
			);

		body.innerHTML = body_;
		body
			.querySelector('[data-act="settings"]')
			?.addEventListener("click", () => openSettingsDialog());
		bindFloorButtons(body);
		bindRecheck();

		function bindRecheck(): void {
			body
				.querySelector('[data-act="recheck"]')
				?.addEventListener("click", () => renderCompositionTab(body, ref, true));
		}
	})();
}
