/**
 * 入口：注入样式、挂按钮、注册菜单。
 *
 * 与旧版脚本的区别：点击按钮不再内嵌 eztb.org，而是直接用内置的
 * tieba.js 查询贴吧接口，因此不产生任何对第三方服务的请求。
 */

import { clearProfileCache } from "./core/cached.ts";
import { requestQueue } from "./core/queue.ts";
import { getSettings } from "./core/settings.ts";
import {
	clearCompositionCache,
	registerUserForComposition,
	rescanPage,
} from "./features/compositionScan.ts";
import { openSettingsDialog } from "./features/settingsDialog.ts";
import { openDiagnoseDialog } from "./features/diagnose.ts";
import { openUserPanel } from "./features/userPanel.ts";
import type { MountFn, UserRef } from "./page/adapters.ts";
import { BADGE_CLASS, getBadgeRef } from "./page/badges.ts";
import { BUTTON_CLASS, startScanner } from "./page/scanner.ts";
import { STYLE_TEXT } from "./ui/styles.ts";

function createButton(ref: UserRef): HTMLButtonElement {
	// 用 button 而不是 a[href="javascript:void(0)"]：
	// 一是避免贴吧页面上的链接委托逻辑拦截，
	// 二是油猴沙箱会阻止 javascript: 导航（点了没反应）。
	const button = document.createElement("button");
	button.type = "button";
	button.className = BUTTON_CLASS;
	button.textContent = "查询";
	button.title = "查看该用户的资料 / 关注吧 / 粉丝 / 收藏吧 / 发帖";
	buttonRefs.set(button, ref);
	button.addEventListener("mousedown", (event) => {
		// 阻止页面的拖拽/框选逻辑抢占鼠标事件
		event.stopPropagation();
	});
	return button;
}

/** 按钮 → 用户信息 的映射；用事件委托，避免页面脚本吞掉按钮自身的监听。 */
const buttonRefs = new WeakMap<Element, UserRef>();

/**
 * 在 document 的捕获阶段接管点击。
 *
 * 贴吧页面（尤其新版）会在冒泡阶段做链接/工具栏的事件处理，可能
 * stopPropagation 或阻止默认行为，挂在按钮自身上的监听就收不到事件了。
 * 捕获阶段跑在所有冒泡监听之前，能稳定拿到这次点击。
 */
function installClickDelegate(): void {
	document.addEventListener(
		"click",
		(event) => {
			const target = event.target as Element | null;

			// 成分徽章：点开面板并直接停在「成分」页签
			const badge = target?.closest?.(`.${BADGE_CLASS}`);
			if (badge) {
				const badgeRef = getBadgeRef(badge);
				if (badgeRef) {
					event.preventDefault();
					event.stopPropagation();
					openUserPanel(badgeRef, { tab: "composition" });
					return;
				}
			}

			const button = target?.closest?.(`.${BUTTON_CLASS}`);
			if (!button) return;
			const ref = buttonRefs.get(button);
			if (!ref) return;
			event.preventDefault();
			event.stopPropagation();
			console.log("[eztb] 按钮被点击，正在打开面板", ref);
			openUserPanel(ref);
		},
		true,
	);
}

const mount: MountFn = (ref, nameEl, wrapper) => {
	if (!ref.userId && !ref.un && !ref.portrait) return;
	const button = createButton(ref);
	if (wrapper) {
		wrapper.appendChild(button);
	} else if (nameEl?.parentNode) {
		nameEl.parentNode.insertBefore(button, nameEl.nextSibling);
	}
	// 后台成分检测：命中缓存就立刻贴徽章，否则排队（规则为空 / 关掉自动检测时什么都不做）
	if (getSettings().compositionAuto) {
		registerUserForComposition(ref, button);
	}
};

function registerMenuCommands(): void {
	if (typeof GM_registerMenuCommand !== "function") return;
	try {
		GM_registerMenuCommand("eztb：设置 BDUSS / 运行参数", () => {
			openSettingsDialog();
		});
		GM_registerMenuCommand("eztb：清空用户资料缓存", () => {
			clearProfileCache();
			alert("已清空 eztb 用户资料缓存");
		});
		GM_registerMenuCommand("eztb：清空成分缓存", () => {
			clearCompositionCache();
			alert("已清空 eztb 成分检测缓存");
		});
		GM_registerMenuCommand("eztb：重新检测本页用户", () => {
			rescanPage();
			alert(
				`已重新排队检测本页用户（每页最多 ${getSettings().compositionMaxPerPage} 人，按设置里的间隔逐个进行）`,
			);
		});
		GM_registerMenuCommand("eztb：诊断当前页面", () => {
			openDiagnoseDialog();
		});
	} catch (error) {
		console.warn("[eztb] 注册菜单命令失败", error);
	}
}

function boot(): void {
	const style = document.createElement("style");
	style.textContent = STYLE_TEXT;
	(document.head ?? document.documentElement).appendChild(style);

	requestQueue.setMinInterval(getSettings().minIntervalMs);
	registerMenuCommands();
	installClickDelegate();
	startScanner(mount);

	console.log("[eztb] 已加载：数据直连贴吧接口，不经过第三方服务");
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
	boot();
}
