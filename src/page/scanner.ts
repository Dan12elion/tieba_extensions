/** 页面扫描：初次全量扫描 + 动态内容监听 + 按钮自愈。 */

import {
	type MountFn,
	processNewHeadline,
	processOldFrsAuthor,
	processOldLzlAuthor,
	processOldPostAuthor,
} from "./adapters.ts";

/**
 * 「已处理」标记。
 *
 * 必须与旧版脚本（tieba-eztb-follow.user.js）区分开：两者曾共用
 * `data-tb-eztb-done`，谁先跑谁就把元素标记完，后跑的那个扫描时全部
 * 跳过、一个按钮都不注入——「旧版贴吧页面没有按钮」就是这么来的
 * （新版页面只是恰好反过来，本脚本先跑赢了）。
 */
const DONE_ATTR = "data-tb-eztb-toolbox-done";

/** 旧脚本遗留的按钮类名，用于提示用户卸载它。 */
const LEGACY_BUTTON_CLASS = "tb-eztb-follow-btn";
let legacyWarned = false;

export const BUTTON_CLASS = "tb-eztb-btn";

type Handler = (el: Element, mount: MountFn) => void;

interface Target {
	selector: string;
	handler: Handler;
	label: string;
}

const TARGETS: Target[] = [
	{
		selector: ".p_author_name",
		handler: processOldPostAuthor,
		label: "旧版楼层",
	},
	{
		selector: "a.frs-author-name",
		handler: processOldFrsAuthor,
		label: "旧版列表",
	},
	{
		selector: ".lzl_cnt > .at, .lzl_content_main > .at",
		handler: processOldLzlAuthor,
		label: "旧版楼中楼",
	},
	{ selector: ".head-line", handler: processNewHeadline, label: "新版用户行" },
];

function scan(root: ParentNode, mount: MountFn): void {
	if (!root?.querySelectorAll) return;
	for (const target of TARGETS) {
		for (const el of Array.from(root.querySelectorAll(target.selector))) {
			if (el.getAttribute(DONE_ATTR)) continue;
			el.setAttribute(DONE_ATTR, "1");
			try {
				target.handler(el, mount);
			} catch (error) {
				console.warn(`[eztb] 处理${target.label}失败`, error);
			}
		}
	}
}

/** 新版页面会重渲染 head-line，按钮被移除后需要补回。 */
function healHeadline(node: Element, mount: MountFn): void {
	const headline = node.classList?.contains("head-line")
		? node
		: (node.closest?.(".head-line") as Element | null);
	if (!headline) return;
	if (!headline.getAttribute(DONE_ATTR)) return;
	if (headline.querySelector(`.${BUTTON_CLASS}`)) return;
	try {
		processNewHeadline(headline, mount);
	} catch (error) {
		console.warn("[eztb] 补回按钮失败", error);
	}
}

export function startScanner(mount: MountFn): void {
	scan(document, mount);

	// 旧脚本若仍在运行，两组按钮会重复。这里只提示一次，不删除别人的 DOM。
	if (!legacyWarned && document.querySelector(`.${LEGACY_BUTTON_CLASS}`)) {
		legacyWarned = true;
		console.warn(
			"[eztb] 检测到旧版脚本（tieba-eztb-follow.user.js）的按钮仍在页面上。" +
				"它会在每个用户名旁再插一个「查关注」按钮，且点击已失效；" +
				"请在油猴里卸载它，避免重复与干扰。",
		);
	}

	if (!window.MutationObserver) return;
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes)) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					scan(node as Element, mount);
				}
			}
			const target = mutation.target;
			if (target && target.nodeType === Node.ELEMENT_NODE) {
				healHeadline(target as Element, mount);
			}
		}
	});
	observer.observe(document.body ?? document.documentElement, {
		childList: true,
		subtree: true,
	});
}
