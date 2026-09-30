/**
 * 「成分」页签：把关键词命中的结论摆出来。
 *
 * 输入：面板编排层传进来的容器元素、被查看的用户引用 ref（检测要重新按它取数）
 * 与 force（「重新检测」要绕过缓存）；不持有任何模块级状态。
 */

import {
	badgeHue,
	highlightKeywords,
	parseRules,
} from "../../core/composition.ts";
import { describeRequestError } from "../../core/errno.ts";
import { getSettings } from "../../core/settings.ts";
import { escapeHtml } from "../../core/util.ts";
import type { UserRef } from "../../page/adapters.ts";
import { type CompositionCheckResult, checkUser } from "../compositionScan.ts";
import { openSettingsDialog } from "../settingsDialog.ts";

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
				const evidences = hit.evidences
					.map((evidence) => {
						const excerpt = evidence.excerpt
							? `<div class="tb-eztb-evidence-text">${highlightKeywords(evidence.excerpt, [evidence.keyword])}</div>`
							: "";
						return (
							`<div class="tb-eztb-evidence">` +
							`<span class="tb-eztb-evidence-reason">${escapeHtml(evidence.reason)}</span>` +
							`<span class="tb-eztb-evidence-keyword">${escapeHtml(evidence.keyword)}</span>` +
							excerpt +
							`</div>`
						);
					})
					.join("");
				return (
					`<div class="tb-eztb-hit">` +
					`<div class="tb-eztb-hit-head">` +
					`<span class="tb-eztb-badge" style="--tb-eztb-badge-hue:${badgeHue(hit.rule.name)}">${escapeHtml(hit.rule.name)}</span>` +
					(hit.sure
						? ""
						: `<span class="tb-eztb-hit-unsure">证据较弱，可能是误判</span>`) +
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
		bindRecheck();

		function bindRecheck(): void {
			body
				.querySelector('[data-act="recheck"]')
				?.addEventListener("click", () => renderCompositionTab(body, ref, true));
		}
	})();
}
