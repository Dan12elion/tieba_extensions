/** 页面扫描：初次全量扫描 + 动态内容监听 + 按钮自愈 + 软导航重置。 */

import {
	type MountFn,
	processNewHeadline,
	processOldFrsAuthor,
	processOldLzlAuthor,
	processOldPostAuthor,
} from "./adapters.ts";
import { log } from "../core/log.ts";

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

/**
 * 本脚本插进页面的东西。
 *
 * 软导航重置时要先摘掉它们：只清标记不摘按钮的话，页面复用一个旧节点
 * （贴吧的列表会这么做）就会留下**上一个用户**的按钮，点开看到的是别人。
 */
const INJECTED_SELECTOR = `.${BUTTON_CLASS}, .tb-eztb-badges`;

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
				log.warn(`处理${target.label}失败：`, error);
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
		log.warn("补回按钮失败：", error);
	}
}

/* ------------------------------------------------------------------------- *
 * 合批
 *
 * 贴吧滚动时会成批插入节点，而 1.8.4 及之前是每来一个 addedNode 就立刻做一次
 * 四个选择器的全量 querySelectorAll——一屏 20 个回帖就是 80 次查询。
 * 现在按一帧合批：同一帧里的节点去重、被祖先覆盖的丢掉，一帧最多扫一次。
 * ------------------------------------------------------------------------- */

let pendingScan = false;
const pendingNodes = new Set<Element>();
const pendingHeal = new Set<Element>();
let currentMount: MountFn | null = null;

/** 一帧内最多处理多少个根节点；超过的留到下一帧，避免长任务卡住滚动。 */
const BATCH_MAX_ROOTS = 60;

function scheduleFrame(task: () => void): void {
	if (typeof requestAnimationFrame === "function") {
		requestAnimationFrame(() => task());
		return;
	}
	setTimeout(task, 16);
}

/** 把 node 放进待扫集合；被已排队节点包含的丢掉，包含别人的则顶掉别人。 */
function enqueue(node: Element): void {
	if (pendingNodes.has(node)) return;
	// 安全阀：一帧里插进来上千个节点时不再两两比较（那是 O(n²)），
	// 直接入队，剩下的交给后续帧处理
	if (pendingNodes.size > BATCH_MAX_ROOTS) {
		pendingNodes.add(node);
		return;
	}
	for (const queued of pendingNodes) {
		if (queued.contains(node)) return;
		if (node.contains(queued)) pendingNodes.delete(queued);
	}
	pendingNodes.add(node);
}

/**
 * 处理「新增节点本身就是目标元素」的情况。
 *
 * `querySelectorAll` **不含节点自己**，所以页面若直接插一个 `.p_author_name` /
 * `.head-line`（而不是插一整块包含它的容器），只调 scan(node) 会漏掉它——
 * 这正是「某类页面不出按钮」的一个可能成因。
 */
function scanSelf(node: Element, mount: MountFn): void {
	if (node.hasAttribute?.(DONE_ATTR)) return;
	for (const target of TARGETS) {
		if (!node.matches?.(target.selector)) continue;
		node.setAttribute(DONE_ATTR, "1");
		try {
			target.handler(node, mount);
		} catch (error) {
			log.warn(`处理${target.label}失败：`, error);
		}
		return;
	}
}

function flushPending(): void {
	pendingScan = false;
	const mount = currentMount;
	const nodes = Array.from(pendingNodes).slice(0, BATCH_MAX_ROOTS);
	const rest = Array.from(pendingNodes).slice(BATCH_MAX_ROOTS);
	pendingNodes.clear();
	const heads = Array.from(pendingHeal);
	pendingHeal.clear();
	if (!mount) return;

	for (const node of rest) pendingNodes.add(node);

	for (const node of nodes) {
		// 节点可能已经被页面摘掉了（贴吧会整段重渲染）
		if (!node.isConnected) continue;
		scanSelf(node, mount);
		scan(node, mount);
	}
	for (const node of heads) {
		if (node.isConnected) healHeadline(node, mount);
	}

	if (pendingNodes.size) scheduleFlush();
}

function scheduleFlush(): void {
	if (pendingScan) return;
	pendingScan = true;
	scheduleFrame(flushPending);
}

/* ------------------------------------------------------------------------- *
 * 软导航
 * ------------------------------------------------------------------------- */

/**
 * 软导航（`pushState` / `replaceState` / `popstate`）之后重置页面标记。
 *
 * 不重置会有两个后果：页面复用的旧节点上留着**上一个用户**的按钮；
 * 而被替换掉的那批节点上的标记永远留着（贴吧的翻页是就地换 DOM）。
 * 做法是先摘掉自己插进去的按钮与徽章、清掉「已处理」标记，再全量扫一遍——
 * 这样每个节点上恰好一个按钮，且指向当前这个用户。
 */
export function resetPageMarks(mount: MountFn): void {
	for (const el of Array.from(document.querySelectorAll(INJECTED_SELECTOR))) {
		el.remove();
	}
	for (const el of Array.from(
		document.querySelectorAll(`[${DONE_ATTR}]`),
	)) {
		el.removeAttribute(DONE_ATTR);
	}
	pendingNodes.clear();
	pendingHeal.clear();
	scan(document, mount);
}

let lastHref = "";

function onSoftNavigation(mount: MountFn): void {
	const href = location.href;
	if (href === lastHref) return;
	lastHref = href;
	try {
		resetPageMarks(mount);
	} catch (error) {
		log.warn("软导航后重置页面标记失败：", error);
	}
}

/** 监听软导航；`history` 的两个方法做一层包装（只在实际换页时重置）。 */
function watchSoftNavigation(mount: MountFn): void {
	lastHref = location.href;
	window.addEventListener("popstate", () => onSoftNavigation(mount));
	window.addEventListener("hashchange", () => onSoftNavigation(mount));

	for (const name of ["pushState", "replaceState"] as const) {
		const original = history[name];
		if (typeof original !== "function") continue;
		const wrapped = function (
			this: History,
			...args: Parameters<History[typeof name]>
		) {
			const result = original.apply(this, args);
			// 同 URL 的 pushState 很常见（页面自己用来更新状态），那种不算换页
			if (location.href !== lastHref) onSoftNavigation(mount);
			return result;
		};
		try {
			history[name] = wrapped as History[typeof name];
		} catch (error) {
			log.warn(`包装 history.${name} 失败（软导航后不会自动重置标记）：`, error);
		}
	}
}

export function startScanner(mount: MountFn): void {
	currentMount = mount;
	scan(document, mount);

	// 旧脚本若仍在运行，两组按钮会重复。这里只提示一次，不删除别人的 DOM。
	if (!legacyWarned && document.querySelector(`.${LEGACY_BUTTON_CLASS}`)) {
		legacyWarned = true;
		log.warn(
			"检测到旧版脚本（tieba-eztb-follow.user.js）的按钮仍在页面上。" +
				"它会在每个用户名旁再插一个「查关注」按钮，且点击已失效；" +
				"请在油猴里卸载它，避免重复与干扰。",
		);
	}

	watchSoftNavigation(mount);

	if (!window.MutationObserver) return;
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes)) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					enqueue(node as Element);
				}
			}
			const target = mutation.target;
			if (target && target.nodeType === Node.ELEMENT_NODE) {
				pendingHeal.add(target as Element);
			}
		}
		if (pendingNodes.size || pendingHeal.size) scheduleFlush();
	});
	observer.observe(document.body ?? document.documentElement, {
		childList: true,
		subtree: true,
	});
}
