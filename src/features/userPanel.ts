/**
 * 用户信息面板：弹窗外壳 + 页签编排。
 *
 * 这个文件只留"与具体页签无关"的部分：弹窗、每个页签各自的容器与显隐、解析身份、
 * 手动刷新、页签点击绑定。各页签怎么渲染搬到了 features/panel/ 下的同名文件，
 * 由它们各自导出渲染函数；需要身份、容器或刷新回调时**通过参数传进去**，
 * 不用模块级可变状态——面板可能同时开着多个，全局状态会串台。
 *
 * 页签名单的唯一来源仍是 core/panelTabs.ts。
 * 所有请求都经过 SDK 直连 tiebac.baidu.com，并走串行限速队列。
 */

import { type Identity, resolveIdentity } from "../core/identity.ts";
import {
	PANEL_TABS,
	type PanelTabId,
	normalizePanelTabId,
} from "../core/panelTabs.ts";
import { getSettings } from "../core/settings.ts";
import { log } from "../core/log.ts";
import { escapeHtml, portraitUrl } from "../core/util.ts";
import { describeRequestError } from "../core/errno.ts";
import { readLastTab, writeLastTab } from "../core/lastTab.ts";
import type { UserRef } from "../page/adapters.ts";
import { openDialog } from "../ui/modal.ts";
import { renderCompositionTab } from "./panel/composition.ts";
import { renderFansTab } from "./panel/fans.ts";
import { renderFollowForumsTab } from "./panel/forums.ts";
import { renderFollowUsersTab } from "./panel/follows.ts";
import { renderMutualTab } from "./panel/mutual.ts";
import { renderPostsTab } from "./panel/posts.ts";
import { renderProfile } from "./panel/profile.ts";
import { openSettingsDialog } from "./settingsDialog.ts";

/** 页签名单来自 core/panelTabs.ts：设置里的「默认打开页签」用的是同一份，别在这里另起一份 */
type TabId = PanelTabId;

const TABS = PANEL_TABS;

export interface UserPanelOptions {
	/** 打开时停在哪个页签；不传就用设置里的「默认打开页签」 */
	tab?: TabId;
}

export function openUserPanel(
	ref: UserRef,
	options: UserPanelOptions = {},
): void {
	/*
	 * 起始页签：显式指定 > 「记住上次页签」（开着且有记录时）> 设置里的默认页签。
	 * 「记住上次」只影响"打开面板先看哪个"，标记点开仍然直接进「成分」。
	 */
	const settings = getSettings();
	const initialTab: TabId =
		options.tab ??
		(settings.rememberLastTab
			? (readLastTab() ?? normalizePanelTabId(settings.defaultTab))
			: normalizePanelTabId(settings.defaultTab));
	const dialog = openDialog({
		title: ref.nickname || ref.un || "贴吧用户",
		subtitleHtml: "正在解析用户信息…",
		avatarUrl: ref.portrait ? portraitUrl(ref.portrait) : undefined,
		tabs: TABS.map((tab) => ({ id: tab.id, label: tab.label })),
		activeTab: initialTab,
		footerHtml:
			`<span>数据由脚本直连贴吧接口获取</span>` +
			`<span class="tb-eztb-spacer"></span>` +
			`<button type="button" class="tb-eztb-linkbtn" data-act="refresh">刷新当前页签</button>` +
			`<button type="button" class="tb-eztb-linkbtn" data-act="settings">设置</button>`,
	});

	dialog.footer
		.querySelector('[data-act="settings"]')
		?.addEventListener("click", () => openSettingsDialog());

	/**
	 * 每个页签各自持有容器。
	 *
	 * 曾经的做法是所有页签共用一个容器、并且记一个"已初始化"集合，
	 * 导致两个 bug：
	 *   1. 切回访问过的页签时被提前 return，容器里还留着上一个页签的内容；
	 *   2. 上一个页签的异步回调返回时，会覆盖掉当前页签刚渲染的内容。
	 * 现在改成独立容器 + 只切显隐，两个问题都不存在了。
	 */
	const panes = new Map<TabId, HTMLElement>();
	const initialized = new Set<TabId>();
	let activeTabId: TabId = initialTab;
	let currentIdentity: Identity | null = null;
	/**
	 * 用户**点过**的页签。

	 * 解析用户信息是异步的（第一次要打接口），而这段时间里页签按钮已经能点。
	 * 以前点击绑定写在解析完成之后，于是"解析中点的页签"被直接丢掉：解析完仍然停在
	 * 默认页签，用户看到的就是"切换页签没反应、内容一直是加载中"。
	 * 现在点击随时都记下来，解析一完成就按最后点的那个渲染。
	 */
	let requestedTab: TabId = initialTab;

	// 页签点击**立刻**绑定（不等解析）：解析中只记下想看的页签，解析完再渲染
	for (const tab of TABS) {
		dialog.root
			.querySelector(`.tb-eztb-tab[data-tab="${tab.id}"]`)
			?.addEventListener("click", () => {
				requestedTab = tab.id;
				if (currentIdentity) switchTab(tab.id, currentIdentity);
			});
	}

	const paneFor = (id: TabId): HTMLElement => {
		const existing = panes.get(id);
		if (existing) return existing;
		const pane = document.createElement("div");
		pane.className = "tb-eztb-pane";
		pane.dataset.pane = id;
		dialog.body.appendChild(pane);
		panes.set(id, pane);
		return pane;
	};

	const switchTab = (id: TabId, identity: Identity) => {
		// 「记住上次页签」记的是用户实际看过的页签（刷新当前页签也会走到这里）
		if (getSettings().rememberLastTab) writeLastTab(id);
		activeTabId = id;
		for (const [key, pane] of panes) {
			pane.classList.toggle("active", key === id);
		}
		const pane = paneFor(id);
		pane.classList.add("active");
		dialog.body.scrollTop = 0;

		if (initialized.has(id)) return;
		initialized.add(id);
		switch (id) {
			case "profile":
				renderProfile(pane, identity);
				break;
			case "composition":
				renderCompositionTab(pane, ref);
				break;
			case "follow":
				renderFollowUsersTab(pane, identity);
				break;
			case "mutual":
				renderMutualTab(pane, identity);
				break;
			case "forums":
				renderFollowForumsTab(pane, identity);
				break;
			case "fans":
				renderFansTab(pane, identity);
				break;
			case "posts":
				renderPostsTab(pane, identity);
				break;
		}
	};

	/** 把解析结果写进头部，并记住当前 identity（刷新后会更新）。 */
	const applyIdentity = (identity: Identity) => {
		currentIdentity = identity;
		dialog.setTitle(identity.nickname || identity.un || "贴吧用户");
		dialog.setSubtitle(
			[
				identity.un ? `用户名 ${escapeHtml(identity.un)}` : "",
				identity.uid ? `贴吧号 ${escapeHtml(identity.uid)}` : "",
			]
				.filter(Boolean)
				.join(" · ") || "已解析",
		);
		if (identity.portrait) {
			dialog.setAvatar(portraitUrl(identity.portrait));
		}
	};

	/** 手动刷新：重新解析用户并重建当前页签。 */
	const refreshButton = dialog.footer.querySelector<HTMLButtonElement>(
		'[data-act="refresh"]',
	);
	refreshButton?.addEventListener("click", () => {
		if (!currentIdentity || refreshButton.disabled) return;
		refreshButton.disabled = true;
		const originalLabel = refreshButton.textContent ?? "刷新当前页签";
		refreshButton.textContent = "刷新中…";

		void (async () => {
			try {
				const identity = await resolveIdentity(ref, true);
				applyIdentity(identity);
				const pane = panes.get(activeTabId);
				if (pane) pane.innerHTML = "";
				initialized.delete(activeTabId);
				switchTab(activeTabId, identity);
				refreshButton.textContent = "已刷新";
			} catch (error) {
				refreshButton.textContent = "刷新失败";
				log.warn("刷新当前页签失败：", error);
			} finally {
				setTimeout(() => {
					refreshButton.disabled = false;
					refreshButton.textContent = originalLabel;
				}, 1000);
			}
		})();
	});

	dialog.body.innerHTML = `<div class="tb-eztb-loading"><div class="tb-eztb-spinner"></div>正在解析用户信息…</div>`;

	void (async () => {
		try {
			const identity = await resolveIdentity(ref);
			applyIdentity(identity);

			// 清掉解析阶段的占位内容，之后各页签内容都放进自己的容器
			dialog.body.innerHTML = "";

			// 解析期间用户可能已经点过别的页签，按最后点的那个渲染
			switchTab(requestedTab, identity);
		} catch (error) {
			const message = describeRequestError(error);
			const needBduss = /BDUSS/i.test(message);
			dialog.body.innerHTML =
				`<div class="tb-eztb-error">${escapeHtml(message)}</div>` +
				(needBduss
					? `<div class="tb-eztb-actions" style="justify-content:flex-start;">` +
						`<button data-act="config" class="primary">去设置 BDUSS</button>` +
						`</div>`
					: "");
			dialog.body
				.querySelector('[data-act="config"]')
				?.addEventListener("click", () =>
					openSettingsDialog({ requireBduss: true }),
				);
		}
	})();
}
