/**
 * 用户信息面板：把 eztb 的只读查询能力搬进贴吧页面。
 *
 * 所有请求都经过 SDK 直连 tiebac.baidu.com，并走串行限速队列。
 */

import { getFans, getFollow } from "tieba.js";
import {
	type PostKind,
	type PostRow,
	loadReplyRows,
	loadTopicRows,
} from "../core/userPost.ts";
import { type Identity, callSdkLoose, resolveIdentity } from "../core/identity.ts";
import {
	HIDDEN_FORUMS_NOTE,
	type ForumRow,
	loadUserForums,
} from "../core/userForums.ts";
import {
	badgeHue,
	highlightKeywords,
	parseRules,
} from "../core/composition.ts";
import { getSettings } from "../core/settings.ts";
import { type CompositionCheckResult, checkUser } from "./compositionScan.ts";
import {
	escapeHtml,
	errorMessage,
	formatTimestamp,
	forumUrl,
	portraitUrl,
	stripPortraitQuery,
	threadUrl,
	toNumber,
} from "../core/util.ts";
import type { UserRef } from "../page/adapters.ts";
import { openDialog } from "../ui/modal.ts";
import { openSettingsDialog } from "./settingsDialog.ts";

const FOLLOW_PAGE_SIZE = 20;

interface PageResult<T> {
	items: T[];
	totalPages?: number;
}

interface PagedListOptions<T> {
	body: HTMLElement;
	loadPage: (page: number) => Promise<PageResult<T>>;
	renderRow: (item: T) => string;
	emptyText: string;
	summaryText?: (loaded: number, totalPages: number) => string;
}

/** 分页列表：一次只取一页，点"加载更多"再取下一页。 */
function mountPagedList<T>(options: PagedListOptions<T>): void {
	const settings = getSettings();
	const maxPages = Math.max(1, settings.maxPagesPerList);

	options.body.innerHTML =
		`<div class="tb-eztb-list"></div>` +
		`<button class="tb-eztb-more" disabled>加载中…</button>` +
		`<div class="tb-eztb-hint"></div>`;

	const listEl = options.body.querySelector<HTMLElement>(".tb-eztb-list")!;
	const moreBtn = options.body.querySelector<HTMLButtonElement>(".tb-eztb-more")!;
	const hintEl = options.body.querySelector<HTMLElement>(".tb-eztb-hint")!;

	let page = 0;
	let loaded = 0;
	let totalPages = Number.POSITIVE_INFINITY;
	let loading = false;

	const refreshFooter = () => {
		const summary = options.summaryText?.(loaded, totalPages);
		const parts: string[] = [];
		if (summary) parts.push(summary);
		if (loading) parts.push("正在加载…");
		else if (moreBtn.disabled) parts.push("已全部加载");
		hintEl.textContent = parts.join(" · ");
	};

	const loadNext = async () => {
		if (loading) return;
		loading = true;
		moreBtn.disabled = true;
		moreBtn.textContent = "加载中…";
		refreshFooter();
		try {
			const result = await options.loadPage(page + 1);
			page += 1;
			loaded += result.items.length;
			if (result.totalPages && result.totalPages > 0) {
				totalPages = result.totalPages;
			}

			if (result.items.length) {
				listEl.insertAdjacentHTML(
					"beforeend",
					result.items.map(options.renderRow).join(""),
				);
			}

			const exhausted =
				result.items.length === 0 ||
				page >= maxPages ||
				(page >= totalPages && Number.isFinite(totalPages));

			if (!loaded && exhausted) {
				listEl.innerHTML = `<div class="tb-eztb-empty">${escapeHtml(options.emptyText)}</div>`;
			}

			moreBtn.disabled = exhausted;
			moreBtn.textContent = exhausted ? "没有更多了" : "加载更多";
		} catch (error) {
			const message = errorMessage(error);
			listEl.insertAdjacentHTML(
				"beforeend",
				`<div class="tb-eztb-error">${escapeHtml(message)}</div>`,
			);
			moreBtn.disabled = false;
			moreBtn.textContent = "重试";
		} finally {
			loading = false;
			refreshFooter();
		}
	};

	moreBtn.addEventListener("click", () => {
		void loadNext();
	});
	void loadNext();
}

function renderUserRow(user: {
	id?: string;
	name?: string;
	name_show?: string;
	portrait?: string;
}): string {
	const display = user.name_show || user.name || "贴吧用户";
	const portrait = stripPortraitQuery(user.portrait);
	const href = portrait
		? `https://tieba.baidu.com/home/main?id=${encodeURIComponent(portrait)}`
		: "";
	return (
		`<a class="tb-eztb-row" ${href ? `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"` : ""}>` +
		(portrait
			? `<img class="tb-eztb-row-avatar" src="${escapeHtml(portraitUrl(portrait))}" alt="">`
			: `<span class="tb-eztb-row-avatar"></span>`) +
		`<span class="tb-eztb-row-main">` +
		`<span class="tb-eztb-row-title">${escapeHtml(display)}</span>` +
		(user.name ? `<span class="tb-eztb-row-sub">${escapeHtml(user.name)}</span>` : "") +
		`</span>` +
		`</a>`
	);
}

function renderProfile(body: HTMLElement, identity: Identity): void {
	const profile = identity.profile ?? {};
	const genderText =
		profile.gender === 1 ? "男" : profile.gender === 2 ? "女" : "未知";
	const rows: Array<[string, string]> = [
		["贴吧号", profile.uid ? String(profile.uid) : "—"],
		["用户名", profile.un || "—"],
		["昵称", profile.nickname || "—"],
		["等级", profile.level ? String(profile.level) : "—"],
		["吧龄", profile.tbAge || "—"],
		["发帖数", profile.postNum !== undefined ? String(profile.postNum) : "—"],
		["粉丝数", profile.fansNum !== undefined ? String(profile.fansNum) : "—"],
		["关注数", profile.concernNum !== undefined ? String(profile.concernNum) : "—"],
		["关注吧数", profile.likeNum !== undefined ? String(profile.likeNum) : "—"],
		["性别", genderText],
		["IP 属地", profile.ip || "—"],
		["会员", profile.vipLevel ? `VIP ${profile.vipLevel}` : "—"],
		["吧务", profile.isBawu ? profile.bawuType || "是" : "—"],
		["简介", profile.intro || "—"],
	];

	body.innerHTML =
		`<dl class="tb-eztb-kv">${rows
			.map(
				([key, value]) =>
					`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`,
			)
			.join("")}</dl>` +
		`<div class="tb-eztb-actions" style="justify-content:flex-start;margin-top:14px;">` +
		(identity.portrait
			? `<button data-act="home">打开贴吧主页</button>`
			: "") +
		`</div>`;

	body.querySelector('[data-act="home"]')?.addEventListener("click", () => {
		if (!identity.portrait) return;
		window.open(
			`https://tieba.baidu.com/home/main?id=${encodeURIComponent(identity.portrait)}`,
			"_blank",
			"noopener,noreferrer",
		);
	});
}

/**
 * 「关注的人」。
 *
 * 注意：`getFollow` 对应 /c/u/follow/followList，返回的是**用户**而不是贴吧。
 * 上游网页的 /follow 页面标题是「关注列表 / 共关注 N 人」。
 * 关注贴吧是另一个接口（getLikeForum），见 renderFollowForumsTab。
 */
function renderFollowUsersTab(body: HTMLElement, identity: Identity): void {
	mountPagedList({
		body,
		emptyText: "该用户没有公开的关注的人",
		summaryText: (loaded, totalPages) =>
			Number.isFinite(totalPages)
				? `已加载 ${loaded} 人 / 共约 ${totalPages * FOLLOW_PAGE_SIZE} 人`
				: `已加载 ${loaded} 人`,
		loadPage: async (page) => {
			const res: any = await callSdkLoose(() => getFollow(identity.id, page));
			const items = Array.isArray(res?.follow_list) ? res.follow_list : [];
			const total = toNumber(res?.total_follow_num);
			return {
				items,
				totalPages:
					total > 0 ? Math.ceil(total / FOLLOW_PAGE_SIZE) : undefined,
			};
		},
		renderRow: renderUserRow,
	});
}

function renderFansTab(body: HTMLElement, identity: Identity): void {
	mountPagedList({
		body,
		emptyText: "该用户没有公开的粉丝",
		summaryText: (loaded, totalPages) =>
			Number.isFinite(totalPages)
				? `已加载 ${loaded} 位 / 共 ${totalPages} 页`
				: `已加载 ${loaded} 位`,
		loadPage: async (page) => {
			const res: any = await callSdkLoose(() => getFans(identity.id, page));
			const items = Array.isArray(res?.user_list) ? res.user_list : [];
			const totalPages = toNumber(res?.page?.total_page);
			return { items, totalPages: totalPages || undefined };
		},
		renderRow: renderUserRow,
	});
}

/**
 * 「关注的吧」。
 *
 * 取数（含隐藏关注贴吧的回退）在 core/userForums.ts 里，后台成分检测共用同一份。
 */
function renderFollowForumsTab(body: HTMLElement, identity: Identity): void {
	body.innerHTML = `<div class="tb-eztb-loading"><div class="tb-eztb-spinner"></div>正在加载…</div>`;

	void (async () => {
		try {
			const { forums: items, hidden } = await loadUserForums(
				identity.id,
				identity.profile?.likeForum ?? [],
			);
			if (!items.length) {
				body.innerHTML = `<div class="tb-eztb-empty">该用户没有公开的关注贴吧</div>`;
				return;
			}

			const withLevel = items.filter((item) => item.level).length;
			body.innerHTML =
				(hidden
					? `<div class="tb-eztb-warn">${escapeHtml(HIDDEN_FORUMS_NOTE)}</div>`
					: "") +
				`<div class="tb-eztb-hint">共 ${items.length} 个${withLevel ? ` · 其中 ${withLevel} 个有等级信息` : ""}</div>` +
				`<div class="tb-eztb-list">` +
				items
					.map((item) =>
						[
							`<a class="tb-eztb-row" href="${escapeHtml(forumUrl(item.name))}" target="_blank" rel="noopener noreferrer">`,
							`<span class="tb-eztb-row-main">`,
							`<span class="tb-eztb-row-title">${escapeHtml(item.display)}</span>`,
							item.slogan || item.levelName
								? `<span class="tb-eztb-row-sub">${escapeHtml(item.slogan || item.levelName)}</span>`
								: "",
							`</span>`,
							item.level
								? `<span class="tb-eztb-row-meta">Lv.${item.level}</span>`
								: "",
							`</a>`,
						].join(""),
					)
					.join("") +
				`</div>`;
		} catch (error) {
			body.innerHTML = `<div class="tb-eztb-error">${escapeHtml(errorMessage(error))}</div>`;
		}
	})();
}

/** 每条记录的类型标签：主题帖 / 回复 / 楼中楼。 */
const POST_KIND_LABEL: Record<PostKind, string> = {
	topic: "主题",
	reply: "回复",
	sub: "楼中楼",
};

function renderPostRow(post: PostRow): string {
	return (
		`<a class="tb-eztb-row" href="${escapeHtml(threadUrl(post.threadId))}" target="_blank" rel="noopener noreferrer">` +
		`<span class="tb-eztb-row-main">` +
		`<span class="tb-eztb-row-title">` +
		`<span class="tb-eztb-tag tb-eztb-tag-${post.kind}">${POST_KIND_LABEL[post.kind]}</span>` +
		`${escapeHtml(post.title || post.preview || "(无标题)")}` +
		`</span>` +
		`<span class="tb-eztb-row-sub">${escapeHtml(post.forumName || "未知贴吧")}</span>` +
		`</span>` +
		`<span class="tb-eztb-row-meta">${escapeHtml(formatTimestamp(post.createTime))}</span>` +
		`</a>`
	);
}

type PostSubTab = "topic" | "reply";

const POST_SUBTABS: Array<{
	id: PostSubTab;
	label: string;
	emptyText: string;
	summaryText: (loaded: number) => string;
}> = [
	{
		id: "topic",
		label: "主题帖",
		emptyText: "该用户没有公开的主题帖",
		summaryText: (loaded) => `已加载 ${loaded} 个主题帖`,
	},
	{
		id: "reply",
		label: "回复",
		emptyText: "该用户没有公开的回复",
		summaryText: (loaded) => `已加载 ${loaded} 条回复`,
	},
];

/** 一个子页签 = 一路 feed + 一套自己的分页状态。 */
function mountPostsSubList(
	pane: HTMLElement,
	identity: Identity,
	subTab: PostSubTab,
): void {
	const spec = POST_SUBTABS.find((item) => item.id === subTab)!;
	mountPagedList<PostRow>({
		body: pane,
		emptyText: spec.emptyText,
		summaryText: spec.summaryText,
		// 主题帖与回复是两个独立 feed，各自翻页，不再合并成一个列表：
		// 合并后两条 feed 的页码对不上，跨页的时间倒序只能近似。
		loadPage: async (page) => ({
			items:
				subTab === "topic"
					? await loadTopicRows(identity.id, page)
					: await loadReplyRows(identity.id, page),
		}),
		renderRow: renderPostRow,
	});
}

/**
 * 「发帖」。
 *
 * 主题帖与回复来自两个独立 feed（见 core/userPost.ts），分页也各自独立，
 * 所以这里拆成两个子页签：各自从第 1 页开始、各点各的「加载更多」，
 * 同一个子页签切走再切回来内容保留（`body.dataset.subtab` 记住上次选的那个，
 * 点「刷新当前页签」后会回到同一个子页签）。
 */
function renderPostsTab(body: HTMLElement, identity: Identity): void {
	const active: PostSubTab = body.dataset.subtab === "reply" ? "reply" : "topic";

	body.innerHTML =
		`<div class="tb-eztb-subtabs" role="tablist">` +
		POST_SUBTABS.map(
			(item) =>
				`<button type="button" role="tab" class="tb-eztb-subtab${item.id === active ? " active" : ""}" data-subtab="${item.id}">${item.label}</button>`,
		).join("") +
		`</div>` +
		POST_SUBTABS.map(
			(item) =>
				`<div class="tb-eztb-subpane${item.id === active ? " active" : ""}" data-subpane="${item.id}"></div>`,
		).join("");

	// 首次切到某个子页签时才取数：没点过的那个不会白白发请求
	const mounted = new Set<PostSubTab>();

	const activate = (id: PostSubTab) => {
		body.dataset.subtab = id;
		for (const button of body.querySelectorAll<HTMLElement>(".tb-eztb-subtab")) {
			button.classList.toggle("active", button.dataset.subtab === id);
		}
		for (const pane of body.querySelectorAll<HTMLElement>(".tb-eztb-subpane")) {
			pane.classList.toggle("active", pane.dataset.subpane === id);
		}
		if (mounted.has(id)) return;
		mounted.add(id);
		const pane = body.querySelector<HTMLElement>(
			`.tb-eztb-subpane[data-subpane="${id}"]`,
		);
		if (pane) mountPostsSubList(pane, identity, id);
	};

	for (const button of body.querySelectorAll<HTMLElement>(".tb-eztb-subtab")) {
		button.addEventListener("click", () => {
			const id = button.dataset.subtab;
			if (id === "topic" || id === "reply") activate(id);
		});
	}

	activate(active);
}

/**
 * 「成分」页签：把关键词命中的结论摆出来，命中的关键词在原文里高亮。
 *
 * 检测本身走 features/compositionScan.ts 的 checkUser——与页面上自动标注是同一条路径，
 * 所以「页面上标了什么」和「面板里说了什么」不会打架。
 */
function renderCompositionTab(
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
				`<div class="tb-eztb-error">${escapeHtml(errorMessage(error))}</div>` +
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

type TabId = "profile" | "composition" | "follow" | "forums" | "fans" | "posts";

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: "profile", label: "资料" },
	{ id: "composition", label: "成分" },
	{ id: "follow", label: "关注的人" },
	{ id: "forums", label: "关注的吧" },
	{ id: "fans", label: "粉丝" },
	{ id: "posts", label: "发帖" },
];

export interface UserPanelOptions {
	/** 打开时停在哪个页签（默认「资料」） */
	tab?: TabId;
}

export function openUserPanel(
	ref: UserRef,
	options: UserPanelOptions = {},
): void {
	const initialTab: TabId = options.tab ?? "profile";
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
				console.warn("[eztb] 刷新失败", error);
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

			// 绑定页签点击：读 currentIdentity，刷新后自动用最新数据
			for (const tab of TABS) {
				dialog.root
					.querySelector(`.tb-eztb-tab[data-tab="${tab.id}"]`)
					?.addEventListener("click", () => {
						if (currentIdentity) switchTab(tab.id, currentIdentity);
					});
			}

			switchTab(initialTab, identity);
		} catch (error) {
			const message = errorMessage(error);
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
