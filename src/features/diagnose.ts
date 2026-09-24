/**
 * 页面诊断：报告当前页面的结构特征，用于定位「某类页面不出按钮」。
 *
 * 多数这类问题靠截图看不出来，需要知道页面实际用的是什么类名、
 * 扫描器命中了几个元素。把这些信息一次性打出来，一次就能定位。
 */

import { escapeHtml } from "../core/util.ts";
import { BUTTON_CLASS } from "../page/scanner.ts";
import { openDialog } from "../ui/modal.ts";

const SELECTORS = [
	".l_post",
	".p_author_name",
	".d_author",
	".lzl_cnt > .at",
	"a.frs-author-name",
	".head-line",
	".head-name",
	"a.name-info-link",
];

function countOf(selector: string): number {
	try {
		return document.querySelectorAll(selector).length;
	} catch {
		return -1;
	}
}

/** 统计页面上所有「用户主页链接」的 class，看有没有扫描器没覆盖的形态。 */
function userLinkClasses(): Array<{ className: string; count: number }> {
	const tally = new Map<string, number>();
	for (const link of Array.from(
		document.querySelectorAll('a[href*="home/main?id="]'),
	)) {
		const className = link.getAttribute("class") ?? "(无 class)";
		tally.set(className, (tally.get(className) ?? 0) + 1);
	}
	return Array.from(tally, ([className, count]) => ({ className, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 12);
}

export function buildDiagnoseReport(): string {
	const lines = [
		`URL: ${location.href}`,
		`标题: ${document.title}`,
		`脚本已运行: 是`,
		"",
		"扫描器选择器命中数：",
		...SELECTORS.map((selector) => `  ${selector} = ${countOf(selector)}`),
		`  [本脚本已处理标记] = ${countOf("[data-tb-eztb-toolbox-done]")}`,
		`  [旧脚本遗留按钮] = ${countOf(".tb-eztb-follow-btn")}`,
		`  [已注入按钮] = ${countOf(`.${BUTTON_CLASS}`)}`,
		"",
		"页面上的用户主页链接（按 class 统计）：",
		...userLinkClasses().map((item) => `  ${item.count} × ${item.className}`),
		"",
		`UA: ${navigator.userAgent}`,
	];
	return lines.join("\n");
}

export function openDiagnoseDialog(): void {
	const report = buildDiagnoseReport();
	const dialog = openDialog({
		title: "eztb 页面诊断",
		subtitleHtml: "把下面的内容整段复制发给开发者",
	});

	dialog.body.innerHTML =
		`<pre class="tb-eztb-report">${escapeHtml(report)}</pre>` +
		`<div class="tb-eztb-actions">` +
		`<button data-act="copy" class="primary">复制报告</button>` +
		`</div>`;

	dialog.body
		.querySelector('[data-act="copy"]')
		?.addEventListener("click", () => {
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="copy"]',
			);
			navigator.clipboard
				?.writeText(report)
				.then(() => {
					if (button) button.textContent = "已复制";
				})
				.catch(() => {
					if (button) button.textContent = "复制失败，请手动选中";
				});
		});

	console.log("[eztb] 页面诊断\n" + report);
}
