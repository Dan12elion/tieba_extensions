/** 通用弹窗外壳：头部 + 可选标签页 + 内容区 + 底部。 */

import { escapeHtml } from "../core/util.ts";

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
		`<div class="tb-eztb-dialog">` +
		`<div class="tb-eztb-head">` +
		avatar +
		`<div class="tb-eztb-head-main">` +
		`<div class="tb-eztb-title">${escapeHtml(options.title)}</div>` +
		`<div class="tb-eztb-sub">${options.subtitleHtml ?? ""}</div>` +
		`</div>` +
		`<button class="tb-eztb-close" title="关闭">×</button>` +
		`</div>` +
		tabs +
		`<div class="tb-eztb-body"></div>` +
		`<div class="tb-eztb-foot">${options.footerHtml ?? ""}</div>` +
		`</div>`;

	document.body.appendChild(root);

	const body = root.querySelector<HTMLElement>(".tb-eztb-body")!;
	const footer = root.querySelector<HTMLElement>(".tb-eztb-foot")!;
	const titleEl = root.querySelector<HTMLElement>(".tb-eztb-title")!;
	const subEl = root.querySelector<HTMLElement>(".tb-eztb-sub")!;

	let disposed = false;
	const close = () => {
		if (disposed) return;
		disposed = true;
		root.remove();
		document.removeEventListener("keydown", onKeydown, true);
		options.onClose?.();
	};

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			close();
		}
	};
	document.addEventListener("keydown", onKeydown, true);

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
	document.querySelector(".tb-eztb-mask")?.remove();
}
