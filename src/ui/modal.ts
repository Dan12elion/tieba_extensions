/** 通用弹窗外壳：头部 + 可选标签页 + 内容区 + 底部。 */

import { escapeHtml } from "../core/util.ts";
import { log } from "../core/log.ts";

export interface DialogTab {
	id: string;
	label: string;
}

export interface DialogOptions {
	title: string;
	subtitleHtml?: string;
	avatarUrl?: string;
	tabs?: DialogTab[];
	activeTab?: string;
	onTab?: (id: string) => void;
	footerHtml?: string;
	onClose?: () => void;
}

export interface DialogHandle {
	root: HTMLElement;
	body: HTMLElement;
	footer: HTMLElement;
	close(): void;
	setTitle(title: string): void;
	setSubtitle(html: string): void;
	setAvatar(url: string): void;
	activateTab(id: string): void;
}

/** 焦点陷阱要认识的可聚焦元素 */
const FOCUSABLE_SELECTOR =
	'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * 当前打开着的弹窗的关闭函数。
 *
 * `closeOpenDialog()` **必须调用它**，而不是只把 DOM 摘掉：
 * `close()` 才负责摘掉捕获阶段的 keydown 监听器、触发 `onClose`、把焦点还回去。
 * 只 `remove()` 的旧写法有两个后果——每开一次弹窗就泄漏一个 keydown 监听器，
 * 且 `onClose` 永远不触发（从面板底部点「设置」正好走这条路）。
 */
let activeClose: (() => void) | null = null;

export function openDialog(options: DialogOptions): DialogHandle {
	closeOpenDialog();

	const root = document.createElement("div");
	root.className = "tb-eztb-mask";

	const avatar = options.avatarUrl
		? `<img class="tb-eztb-avatar" src="${escapeHtml(options.avatarUrl)}" alt="">`
		: "";
	const tabs = options.tabs?.length
		? `<div class="tb-eztb-tabs">${options.tabs
				.map(
					(tab) =>
						`<button class="tb-eztb-tab" data-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`,
				)
				.join("")}</div>`
		: "";

	root.innerHTML =
		`<div class="tb-eztb-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">` +
		`<div class="tb-eztb-head">` +
		avatar +
		`<div class="tb-eztb-head-main">` +
		`<div class="tb-eztb-title">${escapeHtml(options.title)}</div>` +
		`<div class="tb-eztb-sub">${options.subtitleHtml ?? ""}</div>` +
		`</div>` +
		`<button class="tb-eztb-close" title="关闭" aria-label="关闭">×</button>` +
		`</div>` +
		tabs +
		`<div class="tb-eztb-body"></div>` +
		`<div class="tb-eztb-foot">${options.footerHtml ?? ""}</div>` +
		`</div>`;

	document.body.appendChild(root);

	const dialogEl = root.querySelector<HTMLElement>(".tb-eztb-dialog")!;
	const body = root.querySelector<HTMLElement>(".tb-eztb-body")!;
	const footer = root.querySelector<HTMLElement>(".tb-eztb-foot")!;
	const titleEl = root.querySelector<HTMLElement>(".tb-eztb-title")!;
	const subEl = root.querySelector<HTMLElement>(".tb-eztb-sub")!;

	/** 打开弹窗之前焦点在哪：关闭时要还回去，键盘用户才不会掉到页面顶部 */
	const previouslyFocused =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;

	let disposed = false;
	const close = () => {
		if (disposed) return;
		disposed = true;
		if (activeClose === close) activeClose = null;
		root.remove();
		document.removeEventListener("keydown", onKeydown, true);
		if (previouslyFocused?.isConnected) previouslyFocused.focus();
		// onClose 抛出来的话，会打断调用方（比如 openDialog 里"先关旧的再开新的"这一步），
		// 留下一半的状态。这里兜住：关窗这件事必须总是成功。
		try {
			options.onClose?.();
		} catch (error) {
			log.warn("弹窗关闭回调抛错：", error);
		}
	};

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== "Tab") return;

		// 焦点陷阱：Tab 不许跑到弹窗外面去（页面自己的 Tab 顺序可能很长）
		const items = Array.from(
			dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
		).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		const current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		/*
		 * 打开时我们把焦点放在弹窗容器本身（tabIndex = -1），这时
		 * `dialogEl.contains(current)` 是 true，但当前焦点并不落在任何一个可聚焦项上。
		 * 必须把它当成"在列表之外"：否则反向 Tab 会退到遮罩后面的页面元素上，
		 * 焦点陷阱当场漏掉（正向 Tab 因为 DOM 顺序刚好是第一个按钮，看不出来）。
		 */
		const inside = current !== null && items.includes(current);
		if (event.shiftKey) {
			if (!inside || current === first) {
				event.preventDefault();
				last.focus();
			}
			return;
		}
		if (!inside || current === last) {
			event.preventDefault();
			first.focus();
		}
	};
	document.addEventListener("keydown", onKeydown, true);
	activeClose = close;

	// 让弹窗本身可接收焦点：打开后 Tab 从弹窗内开始，且不会把页面滚走
	dialogEl.tabIndex = -1;
	dialogEl.focus({ preventScroll: true });

	root
		.querySelector(".tb-eztb-close")
		?.addEventListener("click", () => close());
	root.addEventListener("click", (event) => {
		if (event.target === root) close();
	});

	const tabButtons = Array.from(
		root.querySelectorAll<HTMLElement>(".tb-eztb-tab"),
	);
	const activateTab = (id: string) => {
		for (const button of tabButtons) {
			button.classList.toggle("active", button.dataset.tab === id);
		}
	};
	for (const button of tabButtons) {
		button.addEventListener("click", () => {
			const id = button.dataset.tab;
			if (!id) return;
			activateTab(id);
			options.onTab?.(id);
		});
	}
	if (options.activeTab) activateTab(options.activeTab);

	return {
		root,
		body,
		footer,
		close,
		setTitle: (text) => {
			titleEl.textContent = text;
			dialogEl.setAttribute("aria-label", text);
		},
		setSubtitle: (html) => {
			subEl.innerHTML = html;
		},
		setAvatar: (url) => {
			const img = root.querySelector<HTMLImageElement>(".tb-eztb-avatar");
			if (img && url) img.src = url;
		},
		activateTab,
	};
}

export function closeOpenDialog(): void {
	activeClose?.();
	// 兜底：如果有什么遮罩没登记在案（比如中途抛异常），也别让它一直挡着页面
	document.querySelector(".tb-eztb-mask")?.remove();
}
