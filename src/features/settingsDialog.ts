/** BDUSS 与运行参数设置。 */

import {
	type ToolboxSettings,
	exportSettingsJson,
	getSettings,
	importSettingsJson,
	updateSettings,
} from "../core/settings.ts";
import { invalidateClient } from "../core/sdk.ts";
import { clearProfileCache } from "../core/cached.ts";
import { requestQueue } from "../core/queue.ts";
import { EXAMPLE_RULES, RULE_FORMAT_HINT } from "../core/composition.ts";
import { clearForumLevelCache } from "../core/forumLevel.ts";
import { clearReplyFloorCache } from "../core/replyFloor.ts";
import { clearForumActivityCache } from "../core/forumActivity.ts";
import { escapeHtml } from "../core/util.ts";
import { openDialog } from "../ui/modal.ts";
import { clearCompositionCache, rescanPage } from "./compositionScan.ts";

export interface SettingsDialogOptions {
	/** 打开时是否强调"必须先填 BDUSS" */
	requireBduss?: boolean;
	onSaved?: () => void;
}

export function openSettingsDialog(options: SettingsDialogOptions = {}): void {
	const current = getSettings();

	const dialog = openDialog({
		title: "eztb 工具箱设置",
		subtitleHtml: "数据直连贴吧接口，不经过任何第三方服务",
	});

	/**
	 * 一行一段地拼，不用一整条 `+` 链：那种写法在打包后会被压成一整行
	 * （最长一行曾经到 3000+ 字符），既不好读，也会踩到"未压缩"的检查。
	 */
	const parts: string[] = [];
	if (options.requireBduss) {
		parts.push(
			`<div class="tb-eztb-warn">还没有填写 BDUSS，所有查询都会失败。请先按下面的说明获取并粘贴。</div>`,
		);
	}
	parts.push(
		`<div class="tb-eztb-warn"><b>安全提示：</b>BDUSS 等同于你账号的登录凭据，任何拿到它的人都能以你的身份操作。它只保存在本机浏览器里，不要发给别人。</div>`,
	);
	parts.push(`<div class="tb-eztb-form">`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-bduss">BDUSS</label>`);
	parts.push(
		`<textarea id="tb-eztb-bduss" class="tb-eztb-textarea" placeholder="粘贴以 BDUSS= 开头的内容，或只粘贴值本身">${escapeHtml(current.bduss)}</textarea>`,
	);
	parts.push(
		`<div class="tb-eztb-hint">获取方式：在已登录的贴吧页面按 F12 → Application → Cookies → tieba.baidu.com → 复制 BDUSS 的值。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-help">辅助获取网址</label>`);
	parts.push(
		`<input id="tb-eztb-help" class="tb-eztb-input" value="${escapeHtml(current.bdussHelpUrl)}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">会用浏览器打开该网址，方便你复制 BDUSS。注意：这类第三方网站可能记录你粘贴的凭据，请自行判断是否可信；用 F12 手动复制永远是更安全的方式。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-interval">请求最小间隔（毫秒）</label>`);
	parts.push(
		`<input id="tb-eztb-interval" class="tb-eztb-input" type="number" min="0" step="50" value="${current.minIntervalMs}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">所有贴吧接口请求都会被这个间隔串行排队，避免请求过密触发风控。建议不低于 300。<br>例外只有一个：帖子里「按吧反查吧名」那种几十字节的小请求——它最多 3 个并发、间隔取"这个值的三分之一"与 150ms 里的较大者（贴吧自己的 SDK 也是这么预热的）。不这样，进「发帖」页签后回复那一路要等好几秒，饼图会长时间只有主题帖的数据。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-maxpages">单个列表最多加载页数</label>`);
	parts.push(
		`<input id="tb-eztb-maxpages" class="tb-eztb-input" type="number" min="1" step="1" value="${current.maxPagesPerList}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">每页 20 条。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-rules">成分关键词规则</label>`);
	parts.push(
		`<textarea id="tb-eztb-rules" class="tb-eztb-textarea tb-eztb-textarea-tall" spellcheck="false" placeholder="${escapeHtml(RULE_FORMAT_HINT)}">${escapeHtml(current.compositionRules)}</textarea>`,
	);
	parts.push(
		`<div class="tb-eztb-hint">${escapeHtml(RULE_FORMAT_HINT)}<br>命中的用户会在用户名旁显示标记；点标记可以看命中了什么。</div>`,
	);
	parts.push(`<div class="tb-eztb-actions" style="justify-content:flex-start;margin-top:0;">`);
	parts.push(`<button data-act="rules-example">填入示例</button>`);
	parts.push(`<button data-act="rules-clear">清空规则</button>`);
	parts.push(`</div>`);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-composition-auto">页面自动检测</label>`);
	parts.push(`<select id="tb-eztb-composition-auto" class="tb-eztb-input">`);
	parts.push(`<option value="1"${current.compositionAuto ? " selected" : ""}>开启</option>`);
	parts.push(`<option value="0"${current.compositionAuto ? "" : " selected"}>关闭</option>`);
	parts.push(`</select>`);
	parts.push(
		`<div class="tb-eztb-hint">开启后会在后台逐个检查页面上的用户（串行限速、同一用户只查一次）。规则表为空时不会发起任何请求。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-maxcheck">每页最多检测人数</label>`);
	parts.push(
		`<input id="tb-eztb-maxcheck" class="tb-eztb-input" type="number" min="1" max="200" step="1" value="${current.compositionMaxPerPage}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">每个用户最多 3 个请求（关注的吧 + 主题帖 + 回复）。默认 20 人 ≈ 60 个请求，仍然按上面的间隔一个一个发。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-cachedays">成分缓存天数</label>`);
	parts.push(
		`<input id="tb-eztb-cachedays" class="tb-eztb-input" type="number" min="1" max="365" step="1" value="${current.compositionCacheDays}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">同一个用户在这段时间内不再重复查询；改规则会让缓存自动失效。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-signin-level">「疑似只签到」的等级门槛</label>`);
	parts.push(
		`<input id="tb-eztb-signin-level" class="tb-eztb-input" type="number" min="1" max="18" step="1" value="${current.signInLevelThreshold}">`,
	);
	parts.push(
		`<div class="tb-eztb-hint">「关注的吧」里的「检测签到号」用它判定：吧内等级 ≥ 这个值，且最近一页发帖里在该吧 0 条发言，就标成疑似只签到。</div>`,
	);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-field">`);
	parts.push(`<label for="tb-eztb-io">设置导入 / 导出</label>`);
	parts.push(
		`<textarea id="tb-eztb-io" class="tb-eztb-textarea" spellcheck="false" placeholder="点「导出到文本框」把当前设置写进这里；把别处的设置粘进来，再点「从文本框导入」"></textarea>`,
	);
	parts.push(
		`<div class="tb-eztb-hint">导出的内容<b>不包含 BDUSS</b>；导入时也<b>不会读取 BDUSS</b>，你自己的凭据不会被别人的文件覆盖。导入后立即生效，等于替你按了一次保存。</div>`,
	);
	parts.push(
		`<div class="tb-eztb-actions" style="justify-content:flex-start;margin-top:0;">` +
			`<button data-act="export">导出到文本框</button>` +
			`<button data-act="io-copy">复制</button>` +
			`<button data-act="import">从文本框导入</button>` +
			`</div>`,
	);
	parts.push(`<div class="tb-eztb-hint" id="tb-eztb-io-status"></div>`);
	parts.push(`</div>`);

	parts.push(`<div class="tb-eztb-actions">`);
	parts.push(`<button data-act="help">打开辅助获取网址</button>`);
	parts.push(`<button data-act="clear">清空资料缓存</button>`);
	parts.push(`<button data-act="clear-composition">清空成分缓存</button>`);
	parts.push(`<button data-act="clear-forum-level">清空吧内等级缓存</button>`);
	parts.push(`<button data-act="clear-reply-floor">清空楼层缓存</button>`);
	parts.push(`<button data-act="clear-activity">清空签到检测缓存</button>`);
	parts.push(`<button data-act="save" class="primary">保存</button>`);
	parts.push(`</div>`);
	parts.push(`</div>`);

	dialog.body.innerHTML = parts.join("");

	const readForm = () => {
		const value = (id: string) =>
			(dialog.body.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();
		const rawValue = (id: string) =>
			dialog.body.querySelector<HTMLTextAreaElement>(`#${id}`)?.value ?? "";
		let bduss = value("tb-eztb-bduss");
		// 允许整段粘贴 "BDUSS=xxxx" 或 cookie 串
		const matched = bduss.match(/BDUSS=([^;\s]+)/i);
		if (matched) bduss = matched[1];
		return {
			bduss,
			bdussHelpUrl: value("tb-eztb-help"),
			minIntervalMs: Number(value("tb-eztb-interval")),
			maxPagesPerList: Number(value("tb-eztb-maxpages")),
			compositionRules: rawValue("tb-eztb-rules").trim(),
			compositionAuto: value("tb-eztb-composition-auto") !== "0",
			compositionMaxPerPage: Number(value("tb-eztb-maxcheck")),
			compositionCacheDays: Number(value("tb-eztb-cachedays")),
			signInLevelThreshold: Number(value("tb-eztb-signin-level")),
		};
	};

	const textarea = () =>
		dialog.body.querySelector<HTMLTextAreaElement>("#tb-eztb-rules");

	const ioBox = () =>
		dialog.body.querySelector<HTMLTextAreaElement>("#tb-eztb-io");
	const ioStatus = (text: string) => {
		const el = dialog.body.querySelector<HTMLElement>("#tb-eztb-io-status");
		if (el) el.textContent = text;
	};

	/** 导入之后要把表单刷成存储里的样子，否则"看到的值"和"生效的值"会对不上 */
	const fillForm = (settings: ToolboxSettings) => {
		const set = (id: string, value: string) => {
			const el = dialog.body.querySelector<
				HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
			>(`#${id}`);
			if (el) el.value = value;
		};
		set("tb-eztb-bduss", settings.bduss);
		set("tb-eztb-help", settings.bdussHelpUrl);
		set("tb-eztb-interval", String(settings.minIntervalMs));
		set("tb-eztb-maxpages", String(settings.maxPagesPerList));
		set("tb-eztb-rules", settings.compositionRules);
		set("tb-eztb-composition-auto", settings.compositionAuto ? "1" : "0");
		set("tb-eztb-maxcheck", String(settings.compositionMaxPerPage));
		set("tb-eztb-cachedays", String(settings.compositionCacheDays));
		set("tb-eztb-signin-level", String(settings.signInLevelThreshold));
	};

	dialog.body
		.querySelector('[data-act="export"]')
		?.addEventListener("click", () => {
			const box = ioBox();
			if (!box) return;
			box.value = exportSettingsJson();
			box.focus();
			box.select();
			ioStatus("已填入上面的文本框（不含 BDUSS），可以直接全选复制。");
		});

	dialog.body
		.querySelector('[data-act="io-copy"]')
		?.addEventListener("click", () => {
			const box = ioBox();
			if (!box) return;
			if (!box.value.trim()) {
				ioStatus("文本框是空的，先点「导出到文本框」。");
				return;
			}
			box.focus();
			box.select();
			void (async () => {
				try {
					await navigator.clipboard.writeText(box.value);
					ioStatus("已复制到剪贴板。");
				} catch {
					// 剪贴板 API 需要权限；不行就退回"选中，你自己按 Ctrl+C"
					ioStatus("浏览器不允许直接写剪贴板，内容已选中，按 Ctrl+C 复制。");
				}
			})();
		});

	dialog.body
		.querySelector('[data-act="import"]')
		?.addEventListener("click", () => {
			const box = ioBox();
			if (!box) return;
			const result = importSettingsJson(box.value);
			if (!result.ok) {
				ioStatus(`导入失败：${result.reason}`);
				return;
			}
			fillForm(result.settings);
			requestQueue.setMinInterval(result.settings.minIntervalMs);
			invalidateClient();
			rescanPage();
			ioStatus("已导入并保存（BDUSS 未改动）。");
		});

	dialog.body
		.querySelector('[data-act="rules-example"]')
		?.addEventListener("click", () => {
			const el = textarea();
			if (el) el.value = EXAMPLE_RULES;
		});

	dialog.body
		.querySelector('[data-act="rules-clear"]')
		?.addEventListener("click", () => {
			const el = textarea();
			if (el) el.value = "";
		});

	dialog.body
		.querySelector('[data-act="help"]')
		?.addEventListener("click", () => {
			const url = readForm().bdussHelpUrl;
			if (url) window.open(url, "_blank", "noopener,noreferrer");
		});

	dialog.body
		.querySelector('[data-act="clear"]')
		?.addEventListener("click", () => {
			clearProfileCache();
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="clear"]',
			);
			if (button) button.textContent = "已清空";
		});

	dialog.body
		.querySelector('[data-act="clear-composition"]')
		?.addEventListener("click", () => {
			clearCompositionCache();
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="clear-composition"]',
			);
			if (button) button.textContent = "已清空";
		});

	dialog.body
		.querySelector('[data-act="clear-forum-level"]')
		?.addEventListener("click", () => {
			clearForumLevelCache();
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="clear-forum-level"]',
			);
			if (button) button.textContent = "已清空";
		});

	dialog.body
		.querySelector('[data-act="clear-reply-floor"]')
		?.addEventListener("click", () => {
			clearReplyFloorCache();
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="clear-reply-floor"]',
			);
			if (button) button.textContent = "已清空";
		});

	dialog.body
		.querySelector('[data-act="clear-activity"]')
		?.addEventListener("click", () => {
			clearForumActivityCache();
			const button = dialog.body.querySelector<HTMLButtonElement>(
				'[data-act="clear-activity"]',
			);
			if (button) button.textContent = "已清空";
		});

	dialog.body
		.querySelector('[data-act="save"]')
		?.addEventListener("click", () => {
			invalidateClient();
			const next = updateSettings(readForm());
			requestQueue.setMinInterval(next.minIntervalMs);
			dialog.close();
			// 规则或开关变了：把当前页面已经登记过的用户重新过一遍（规则为空时不会发请求）
			rescanPage();
			options.onSaved?.();
		});
}
