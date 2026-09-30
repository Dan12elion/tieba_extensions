/**
 * 页面诊断：报告当前页面的结构特征，用于定位「某类页面不出按钮」。
 *
 * 多数这类问题靠截图看不出来，需要知道页面实际用的是什么类名、
 * 扫描器命中了几个元素。把这些信息一次性打出来，一次就能定位。
 */

import { escapeHtml } from "../core/util.ts";
import { abortAllInFlight, inFlightCount } from "../core/gmhttp.ts";
import { getStorageIssues } from "../core/kvCache.ts";
import { recentLogs } from "../core/log.ts";
import {
	breakerSnapshot,
	resetBreaker,
} from "../core/netPolicy.ts";
import { recentUnknownErrno } from "../core/errno.ts";
import { SCRIPT_VERSION } from "../core/version.ts";
import { BADGES_CLASS } from "../page/badges.ts";
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

/**
 * 运行期自检：把「必须成立」的几条约束直接在当前页面上量一遍。
 *
 * 踩坑 #1/#3/#14 那些约束（按钮 `pointer-events: auto`、`z-index: 5`、
 * 徽章绝不折行）以前只写在文档与测试里；用户报「按钮点不动」「标记压住正文」时，
 * 报告里得自带答案，而不是让人去猜。
 */
function selfCheckLines(): string[] {
	const lines: string[] = [];
	const buttons = Array.from(
		document.querySelectorAll<HTMLElement>(`.${BUTTON_CLASS}`),
	).slice(0, 3);

	if (!buttons.length) {
		lines.push("  （本页还没有注入按钮，跳过）");
		return lines;
	}

	const pointerOk = buttons.filter(
		(button) => getComputedStyle(button).pointerEvents === "auto",
	);
	lines.push(
		`  ${
			pointerOk.length === buttons.length ? "PASS" : "FAIL"
		} 按钮 pointer-events = auto —— ${pointerOk.length}/${buttons.length}` +
			(pointerOk.length === buttons.length
				? ""
				: "（不成立就会「看得见、点不动」，坑 #1）"),
	);

	const zOk = buttons.filter(
		(button) => getComputedStyle(button).zIndex === "5",
	);
	lines.push(
		`  ${zOk.length === buttons.length ? "PASS" : "FAIL"} 按钮 z-index = 5 —— ${zOk.length}/${buttons.length}` +
			(zOk.length === buttons.length
				? ""
				: "（大于 5 会盖住本该在上面的页面弹层，坑 #3）"),
	);

	const containers = Array.from(
		document.querySelectorAll<HTMLElement>(`.${BADGES_CLASS}`),
	).slice(0, 3);
	if (!containers.length) {
		lines.push("  （本页没有成分徽章，跳过徽章相关的两条）");
		return lines;
	}

	const nowrapOk = containers.filter(
		(container) => getComputedStyle(container).whiteSpace.includes("nowrap"),
	);
	lines.push(
		`  ${nowrapOk.length === containers.length ? "PASS" : "FAIL"} 徽章容器不折行（white-space: nowrap） —— ${nowrapOk.length}/${containers.length}` +
			(nowrapOk.length === containers.length
				? ""
				: "（折行会压住下面的正文，坑 #14）"),
	);

	const fitOk = containers.filter((container) => {
		const row = container.closest<HTMLElement>(".head-line");
		if (!row) return true;
		const rowBox = row.getBoundingClientRect();
		const box = container.getBoundingClientRect();
		return box.height <= rowBox.height + 1;
	});
	lines.push(
		`  ${fitOk.length === containers.length ? "PASS" : "FAIL"} 徽章待在头部行的高度内 —— ${fitOk.length}/${containers.length}`,
	);

	return lines;
}

function breakerLines(): string[] {
	const snapshot = breakerSnapshot();
	if (!snapshot.open) {
		return [
			` 正常（连续失败 ${snapshot.consecutiveFailures} 次；连续 ${snapshot.threshold} 次才熔断）`,
		];
	}
	return [
		` 已暂停：连续失败 ${snapshot.consecutiveFailures} 次，约 ${Math.ceil(snapshot.remainingMs / 1000)} 秒后自动恢复`,
		` 期间被挡回去的请求：${snapshot.pausedRequests} 个`,
	];
}

export function buildDiagnoseReport(): string {
	const lines = [
		`URL: ${location.href}`,
		`标题: ${document.title}`,
		// 用户报障时第一件要知道的事：他装的是哪一版
		`脚本版本: ${SCRIPT_VERSION}`,
		`脚本已运行: 是`,
		"",
		"扫描器选择器命中数：",
		...SELECTORS.map((selector) => `  ${selector} = ${countOf(selector)}`),
		`  [本脚本已处理标记] = ${countOf("[data-tb-eztb-toolbox-done]")}`,
		`  [旧脚本遗留按钮] = ${countOf(".tb-eztb-follow-btn")}`,
		`  [已注入按钮] = ${countOf(`.${BUTTON_CLASS}`)}`,
		"",
		"关键约束自检（这几条不成立，界面上就会出现「点不动 / 压住正文」）：",
		...selfCheckLines(),
		"",
		"页面上的用户主页链接（按 class 统计）：",
		...userLinkClasses().map((item) => `  ${item.count} × ${item.className}`),
			"",
			`在飞请求: ${inFlightCount()}`,
			"请求熔断状态：",
			...breakerLines(),
			"",
		"存储写入失败记录（空 = 一切正常）：",
		...storageIssueLines(),
		"",
		"贴吧返回过但本脚本还没收录的错误码（报给开发者就能补进对照表）：",
		...unknownErrnoLines(),
		"",
		"最近的日志（最多 20 条）：",
		...recentLogs()
			.slice(-20)
			.map((line) => `  ${line}`),
		"",
		`UA: ${navigator.userAgent}`,
	];
	return lines.join("\n");
}

/** 未收录的错误码：只有实测样本才能补表，所以必须让用户能把它带出来（§5 #37 的教训） */
function unknownErrnoLines(): string[] {
	const unknown = recentUnknownErrno();
	if (!unknown.length) return ["  （无）"];
	return unknown.map((line) => `  ${line}`);
}

/** 存储写失败以前是静默的，现在把它摆到诊断报告里 */
function storageIssueLines(): string[] {
	const issues = getStorageIssues();
	if (!issues.length) return ["  （无）"];
	return issues.map(
		(issue) =>
			`  ${new Date(issue.at).toISOString()} ${issue.storageKey}: ${issue.message}`,
	);
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
		`<button data-act="abort">中断在飞请求</button>` +
		`<button data-act="reset-breaker">重置熔断</button>` +
		`</div>`;

	dialog.body
		.querySelector('[data-act="reset-breaker"]')
		?.addEventListener("click", (event) => {
			const button = event.currentTarget as HTMLButtonElement;
			const before = breakerSnapshot();
			resetBreaker();
			button.textContent = before.open
				? "已重置，可以继续查询"
				: "本来就没熔断";
		});

	dialog.body
		.querySelector('[data-act="abort"]')
		?.addEventListener("click", (event) => {
			const button = event.currentTarget as HTMLButtonElement;
			const count = abortAllInFlight();
			button.textContent =
				count > 0 ? `已中断 ${count} 个` : "当前没有在飞请求";
		});

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
