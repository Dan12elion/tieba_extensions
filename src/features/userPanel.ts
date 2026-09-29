/**
 * 用户信息面板：把 eztb 的只读查询能力搬进贴吧页面。
 *
 * 所有请求都经过 SDK 直连 tiebac.baidu.com，并走串行限速队列。
 */

import { getFans, getFollow } from "tieba.js";
import {
	type PostKind,
	type PostRow,
	loadReplyPage,
	loadTopicPage,
} from "../core/userPost.ts";
import { type Identity, callSdkLoose, resolveIdentity } from "../core/identity.ts";
import {
	fetchUserForumLevel,
	readForumLevelCache,
} from "../core/forumLevel.ts";
import {
	fetchReplyFloor,
	readReplyFloorCache,
} from "../core/replyFloor.ts";
import {
	type ForumCounts,
	type SearchAllSummaryInput,
	buildForumFilterOptionsHtml,
	buildForumListHtml,
	buildForumPieSvg,
	buildPieNotes,
	buildPostFilterHint,
	buildSearchAllSummary,
	countPostsByForum,
	mergePostRows,
	mergeForumCounts,
	postMatchesQuery,
	postRowSubParts,
} from "../core/postStats.ts";
import { type ForumActivity, loadForumActivity } from "../core/forumActivity.ts";
import {
	UNKNOWN_FORUM,
	findSignInForums,
	signInSummary,
} from "../core/activityRule.ts";
import {
	PANEL_TABS,
	type PanelTabId,
	normalizePanelTabId,
} from "../core/panelTabs.ts";
import {
	HIDDEN_FORUMS_NOTE,
	NO_LEVEL_NOTE,
	NO_USERNAME_NOTE,
	type ForumRow,
	loadUserForums,
} from "../core/userForums.ts";
import {
	badgeHue,
	highlightKeywords,
	parseRules,
} from "../core/composition.ts";
import { getSettings } from "../core/settings.ts";
import { log } from "../core/log.ts";
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
	/** 数据源说这份记录被隐藏了（发帖页签用：hidePost != 0） */
	hidden?: boolean;
}

interface PagedListOptions<T> {
	body: HTMLElement;
	loadPage: (page: number) => Promise<PageResult<T>>;
	renderRow: (item: T) => string;
	emptyText: string;
	/** 数据被隐藏时的说明文字（不传就用 emptyText） */
	hiddenText?: string;
	summaryText?: (loaded: number, totalPages: number) => string;
	/** 取数失败时回调（面板用它把"这一路没取到"写进页面，而不是只在隐藏的子页签里报错） */
	onError?: (error: unknown) => void;
	/**
	 * 每加载完一页调用一次：新插入的行才需要绑定各自的按钮（「查楼层」这类），
	 * 也是更新占比饼图的时机。
	 */
	onPage?: (result: PageResult<T>) => void;
}

/**
 * 分页列表的把手。

 * 「发帖」页签的**合并查询**要读两路 feed 已经加载出来的行，还要能替用户继续翻页，
 * 所以列表挂载时把这两件事交出来；分开查询的界面行为完全不变。
 */
export interface PagedListHandle<T> {
	/** 再取一页（内部有 loading 守卫，重复调用不会并发） */
	loadNext: () => Promise<void>;
	/** 已经加载出来的行（副本，调用方改不到内部状态） */
	rows: () => T[];
	/** 已经翻到第几页（「搜全部」的进度要用） */
	pages: () => number;
	/** 这一路是否已经取完（没有更多页了） */
	exhausted: () => boolean;
	/** 这一路是**到了页数上限**才停的（还可能更早的内容没取到） */
	capped: () => boolean;
	/** 这一路的数据源说记录被隐藏了（发帖页签的 hidePost） */
	hidden: () => boolean;
}

/** 分页列表：一次只取一页，点"加载更多"再取下一页。 */
function mountPagedList<T>(options: PagedListOptions<T>): PagedListHandle<T> {
	const settings = getSettings();
	const maxPages = Math.max(1, settings.maxPagesPerList);

	options.body.innerHTML =
		`<div class="tb-eztb-notice"></div>` +
		`<div class="tb-eztb-list"></div>` +
		`<button class="tb-eztb-more" disabled>加载中…</button>` +
		`<div class="tb-eztb-hint"></div>`;

	const listEl = options.body.querySelector<HTMLElement>(".tb-eztb-list")!;
	const moreBtn = options.body.querySelector<HTMLButtonElement>(".tb-eztb-more")!;
	const hintEl = options.body.querySelector<HTMLElement>(".tb-eztb-hint")!;
	const noticeEl = options.body.querySelector<HTMLElement>(".tb-eztb-notice")!;

	let page = 0;
	let loaded = 0;
	let totalPages = Number.POSITIVE_INFINITY;
	let loading = false;
	let exhaustedFlag = false;
	let cappedFlag = false;
	let hiddenFlag = false;
	/** 已经加载出来的行：合并视图与"筛完还剩几条"都要用它 */
	const items: T[] = [];

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
			items.push(...result.items);
			if (result.totalPages && result.totalPages > 0) {
				totalPages = result.totalPages;
			}

			if (result.items.length) {
				listEl.insertAdjacentHTML(
					"beforeend",
					result.items.map(options.renderRow).join(""),
				);
			}

			// 数据被隐藏时说清楚原因：不要显示成"该用户没有公开的主题帖"
			if (result.hidden) {
				hiddenFlag = true;
				noticeEl.innerHTML = `<div class="tb-eztb-warn">${escapeHtml(
					options.hiddenText ?? options.emptyText,
				)}</div>`;
			}
			options.onPage?.(result);

			// 「没有更多数据」和「到了页数上限」必须分开记：
			// 前者是"真的翻完了"，后者只是"我们不再翻了"（「搜全部」的结论要区分这两件事）
			const noMoreData =
				result.items.length === 0 ||
				(page >= totalPages && Number.isFinite(totalPages));
			const hitCap = page >= maxPages;
			exhaustedFlag = noMoreData || hitCap;
			cappedFlag = hitCap && !noMoreData;

			if (!loaded && exhaustedFlag) {
				// 隐藏的情况下上面已经给了原因，这里不再重复一句"没有公开的帖子"
				if (!result.hidden) {
					listEl.innerHTML = `<div class="tb-eztb-empty">${escapeHtml(options.emptyText)}</div>`;
				}
			}

			moreBtn.disabled = exhaustedFlag;
			moreBtn.textContent = exhaustedFlag ? "没有更多了" : "加载更多";
		} catch (error) {
			const message = errorMessage(error);
			options.onError?.(error);
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

	return {
		loadNext,
		rows: () => items.slice(),
		pages: () => page,
		exhausted: () => exhaustedFlag,
		capped: () => cappedFlag,
		hidden: () => hiddenFlag,
	};
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
 * 把「检测签到号」的结果写进已经渲染好的列表里。
 *
 * 逐行补写而不是整块重渲染：重渲染会把「查等级」刚点出来的结果一起冲掉。
 * 判定的措辞（把"样本只有最近一页"说清楚）在 core/activityRule.ts。
 */
function applyForumActivity(
	body: HTMLElement,
	items: ForumRow[],
	activity: ForumActivity,
	levelThreshold: number,
): void {
	const activityEl = body.querySelector<HTMLElement>(".tb-eztb-activity");
	const parts: string[] = [];

	if (activity.hidden) {
		parts.push(
			`<div class="tb-eztb-warn">该用户隐藏了发帖记录，读不到发帖样本，因此没法判断「等级与活跃度是否相符」。</div>`,
		);
	} else {
		const candidates = findSignInForums(items, activity.byForum, levelThreshold);
		const candidateNames = new Set(candidates.map((item) => item.forumName));
		parts.push(
			`<div class="tb-eztb-hint">${escapeHtml(
				signInSummary(candidates, levelThreshold, {
					topics: activity.topics,
					replies: activity.replies,
				}),
			)}</div>`,
		);

		for (const row of Array.from(
			body.querySelectorAll<HTMLElement>(".tb-eztb-row[data-forum]"),
		)) {
			const name = row.dataset.forum ?? "";
			const count = activity.byForum[name] ?? 0;
			const main = row.querySelector<HTMLElement>(".tb-eztb-row-main");
			if (main) {
				let sub = main.querySelector<HTMLElement>(".tb-eztb-row-sub");
				if (!sub) {
					sub = document.createElement("span");
					sub.className = "tb-eztb-row-sub";
					main.appendChild(sub);
				}
				// 反复点「重新检测」时不能越叠越多：原始内容只在第一次记下来
				if (sub.dataset.baseHtml === undefined) {
					sub.dataset.baseHtml = sub.innerHTML;
				}
				sub.innerHTML =
					sub.dataset.baseHtml +
					` <span class="tb-eztb-row-extra">近期发言 ${count} 条</span>`;
			}

			if (!candidateNames.has(name)) continue;
			const meta = row.querySelector<HTMLElement>(".tb-eztb-row-meta");
			if (!meta || meta.querySelector(".tb-eztb-signin")) continue;
			const level = items.find((item) => item.name === name)?.level;
			const mark = document.createElement("span");
			mark.className = "tb-eztb-signin";
			mark.textContent = "疑似只签到";
			mark.title =
				`吧内等级 Lv.${level}（≥ ${levelThreshold}），但最近一页发帖里在这个吧 0 条发言。` +
				`可能是只签到不发言，也可能是最近没来。`;
			meta.prepend(mark);
		}
	}

	if (activity.failed.length) {
		parts.push(
			`<div class="tb-eztb-warn">部分数据没取到：${escapeHtml(activity.failed.join("；"))}</div>`,
		);
	}
	if (activityEl) activityEl.innerHTML = parts.join("");
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

			// 之前在「关注的吧」页签点过"查等级"的，直接用缓存补上
			for (const item of items) {
				if (item.level) continue;
				const cached = readForumLevelCache(identity.id, item.name);
				if (cached) {
					item.level = cached;
					item.levelFromPost = true;
				}
			}

			const withLevel = items.filter((item) => item.level).length;
			const missingLevel = items.length - withLevel;
			// 把"为什么有些吧没等级"直接写在界面上（两个原因分别说明，见 userForums.ts）
			const notes = [
				hidden ? HIDDEN_FORUMS_NOTE : "",
				// 缺等级就说明一次：隐藏关注贴吧的用户同样会看到（F1 精简后不再重复这件事）
				missingLevel ? NO_LEVEL_NOTE : "",
				hidden && !identity.profile?.un ? NO_USERNAME_NOTE : "",
			].filter(Boolean);
			body.innerHTML =
				notes
					.map((note) => `<div class="tb-eztb-warn">${escapeHtml(note)}</div>`)
					.join("") +
				`<div class="tb-eztb-hint">共 ${items.length} 个${withLevel ? ` · 其中 ${withLevel} 个有等级信息` : " · 都没有等级信息"}</div>` +
				// 「等级与活跃度是否相符」要额外两次请求（发帖 feed 的最近一页），所以点了才查
				`<div class="tb-eztb-actions" style="justify-content:flex-start;margin:8px 0;">` +
				`<button type="button" class="tb-eztb-minibtn" data-act="activity">检测签到号</button>` +
				`<span class="tb-eztb-hint">等级高、最近又不在该吧发言的吧</span>` +
				`</div>` +
				`<div class="tb-eztb-activity"></div>` +
				`<div class="tb-eztb-list">` +
				items
					.map((item) =>
						[
							`<a class="tb-eztb-row" data-forum="${escapeHtml(item.name)}" href="${escapeHtml(forumUrl(item.name))}" target="_blank" rel="noopener noreferrer">`,
							`<span class="tb-eztb-row-main">`,
							`<span class="tb-eztb-row-title">${escapeHtml(item.display)}</span>`,
							item.slogan || item.levelName
								? `<span class="tb-eztb-row-sub">${escapeHtml(item.slogan || item.levelName)}</span>`
								: "",
							`</span>`,
							item.level
								? `<span class="tb-eztb-row-meta"${item.levelFromPost ? ' title="这个等级是从他在这吧的帖子里读到的"' : ""}>Lv.${item.level}</span>`
								: `<span class="tb-eztb-row-meta"><button type="button" class="tb-eztb-levelbtn" data-forum="${escapeHtml(item.name)}" title="面板与资料接口都拿不到这个吧的等级，点一下去他在该吧的帖子里找">查等级</button></span>`,
							`</a>`,
						].join(""),
					)
					.join("") +
				`</div>`;

			/**
			 * 「检测签到号」：用发帖 feed 的最近一页统计他在每个吧的发言数。
			 *
			 * 只标注、不重排：逐行把结论补进已经渲染好的行里，
			 * 这样「查等级」刚点出来的结果不会被重渲染冲掉。
			 */
			const activityButton = body.querySelector<HTMLButtonElement>(
				'[data-act="activity"]',
			);
			const activityEl = body.querySelector<HTMLElement>(".tb-eztb-activity");
			activityButton?.addEventListener("click", () => {
				if (activityButton.disabled) return;
				activityButton.disabled = true;
				const originalLabel = activityButton.textContent ?? "检测签到号";
				activityButton.textContent = "检测中…";
				if (activityEl) {
					activityEl.innerHTML = `<div class="tb-eztb-hint">正在读取他最近一页的发帖…</div>`;
				}
				void (async () => {
					try {
						const activity = await loadForumActivity(identity.id);
						applyForumActivity(
							body,
							items,
							activity,
							getSettings().signInLevelThreshold,
						);
						activityButton.textContent = "重新检测";
					} catch (error) {
						if (activityEl) {
							activityEl.innerHTML = `<div class="tb-eztb-error">${escapeHtml(errorMessage(error))}</div>`;
						}
						activityButton.textContent = originalLabel;
					} finally {
						activityButton.disabled = false;
					}
				})();
			});

			// 「查等级」按钮：点了才发请求（每个吧最多 3 次），结果写缓存。
			// 按按钮逐个绑定，不用事件委托——刷新页签时按钮会重建，委托反而会留下旧闭包。
			for (const button of Array.from(
				body.querySelectorAll<HTMLButtonElement>(".tb-eztb-levelbtn"),
			)) {
				const forumName = button.dataset.forum ?? "";
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					if (button.disabled || !forumName) return;
					button.disabled = true;
					button.textContent = "查询中…";
					void (async () => {
						try {
							const result = await fetchUserForumLevel(
								identity.id,
								forumName,
							);
							if (result.level) {
								const meta = document.createElement("span");
								meta.className = "tb-eztb-row-meta";
								meta.textContent = `Lv.${result.level}`;
								meta.title = `这个等级是从他${result.via === "reply" ? "回复过的帖子" : "在本吧的帖子"}里读到的`;
								button.replaceWith(meta);
								return;
							}
							button.textContent = "查不到";
							button.title = result.reason ?? "没查到";
							button.disabled = false;
						} catch (error) {
							button.textContent = "查询失败";
							button.title = errorMessage(error);
							button.disabled = false;
						}
					})();
				});
			}
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

/** 发帖记录被隐藏时的说明（feed 的 hidePost != 0，见 core/userPost.ts）。 */
const HIDDEN_POSTS_NOTE =
	"发帖信息设为私密。";

/**
 * 楼层那一格：已知就显示「N楼」，不知道就给一个「查楼层」按钮（点了才查）。
 *
 * 楼层号不在发帖 feed 里（见 core/replyFloor.ts），一个楼层一次请求，
 * 所以默认不查、点了才查，查过写缓存。
 */
function renderFloorSlot(post: PostRow): string {
	if (!post.postId) return "";
	const cached = readReplyFloorCache(post.threadId, post.postId);
	if (cached) {
		return `<span class="tb-eztb-floor" title="${escapeHtml(
			cached.excerpt ? `${cached.floor} 楼的内容：${cached.excerpt}` : `${cached.floor} 楼`,
		)}">${cached.floor}楼</span>`;
	}
	return (
		`<button type="button" class="tb-eztb-floorbtn"` +
		` data-thread="${escapeHtml(post.threadId)}" data-post="${escapeHtml(post.postId)}"` +
		` title="发帖列表里没有楼层号，点一下去这个帖子里查他在第几楼">查楼层</button>`
	);
}

function renderPostRow(post: PostRow): string {
	const isReply = post.kind !== "topic";
	// 行上带吧名（空吧名归到「未知贴吧」，与饼图/签到统计同一套口径），
	// 「只看某个吧」的筛选直接读它，不再重新解析副标题里的吧名标签。
	const forum = String(post.forumName ?? "").trim() || UNKNOWN_FORUM;
	// 搜索用的可搜文本（标题 + 正文摘要，小写）：分开视图的行是增量插进 DOM 的，
	// 逐行判定只能靠行上带一份，不能在筛选时回头解析 HTML。
	const searchText = `${post.title ?? ""} ${post.preview ?? ""}`
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	// 副标题由纯函数拼（吧名标签 / 楼中楼的回复对象 / 回复正文），见 core/postStats.ts
	const subParts = postRowSubParts(post);
	return (
		// data-time 是原始时间戳（合并视图按它倒序，测试也按它断言顺序）
		`<a class="tb-eztb-row" data-forum="${escapeHtml(forum)}" data-search="${escapeHtml(searchText)}" data-time="${post.createTime}" href="${escapeHtml(threadUrl(post.threadId))}" target="_blank" rel="noopener noreferrer">` +
		`<span class="tb-eztb-row-main">` +
		`<span class="tb-eztb-row-title">` +
		`<span class="tb-eztb-tag tb-eztb-tag-${post.kind}">${POST_KIND_LABEL[post.kind]}</span>` +
		`${escapeHtml(post.title || post.preview || "(无标题)")}` +
		`</span>` +
		(subParts.length
			? `<span class="tb-eztb-row-sub">${subParts.join(" ")}</span>`
			: `<span class="tb-eztb-row-sub">${escapeHtml(UNKNOWN_FORUM)}</span>`) +
		`</span>` +
		`<span class="tb-eztb-row-meta tb-eztb-row-meta-stack">` +
		(isReply ? renderFloorSlot(post) : "") +
		`<span class="tb-eztb-row-time">${escapeHtml(formatTimestamp(post.createTime))}</span>` +
		`</span>` +
		`</a>`
	);
}

/**
 * 给新插入的行绑定「查楼层」。

 * 逐个绑定而不是事件委托：刷新页签时行会重建，委托留下的旧闭包会指向已经不存在的行
 * （「关注的吧」里的「查等级」当初就是这么定的）。dataset 打标避免重复绑定。
 */
function bindFloorButtons(root: HTMLElement): void {
	for (const button of Array.from(
		root.querySelectorAll<HTMLButtonElement>(".tb-eztb-floorbtn"),
	)) {
		if (button.dataset.bound === "1") continue;
		button.dataset.bound = "1";
		button.addEventListener("click", (event) => {
			// 行本身是个链接：点按钮不能跳走
			event.preventDefault();
			event.stopPropagation();
			if (button.disabled) return;
			const threadId = button.dataset.thread ?? "";
			const postId = button.dataset.post ?? "";
			if (!threadId || !postId) return;
			button.disabled = true;
			button.textContent = "查询中…";
			void (async () => {
				const result = await fetchReplyFloor(threadId, postId);
				if (result.floor) {
					const span = document.createElement("span");
					span.className = "tb-eztb-floor";
					span.textContent = `${result.floor}楼`;
					span.title = result.excerpt
						? `${result.floor} 楼的内容：${result.excerpt}`
						: `${result.floor} 楼`;
					button.replaceWith(span);
					return;
				}
				button.textContent = "查不到";
				button.title = result.reason ?? "没查到";
				button.disabled = false;
			})();
		});
	}
}

type PostSubTab = "topic" | "reply";

/** 「发帖」页签的两种看法：分开（两个列表各自翻页）/ 合并（合成一个列表） */
type PostMode = "split" | "merged";

const POST_MODES: Array<{ id: PostMode; label: string; title: string }> = [
	{
		id: "split",
		label: "分开",
		title: "主题帖与回复各占一个列表，各自翻页",
	},
	{
		id: "merged",
		label: "合并",
		title: "主题帖与回复合成一个列表（按时间倒序，跨 feed 的顺序是近似的）",
	},
];

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
	/** 每加载出一页就把这些行交给「发帖」页签，用来更新占比饼图 */
	onRows: (rows: PostRow[]) => void,
	/** 这一路取数失败时通知「发帖」页签（否则错误只在被隐藏的子页签里，用户看不见） */
	onError: (message: string) => void,
): PagedListHandle<PostRow> {
	const spec = POST_SUBTABS.find((item) => item.id === subTab)!;
	return mountPagedList<PostRow>({
		body: pane,
		emptyText: spec.emptyText,
		hiddenText: HIDDEN_POSTS_NOTE,
		summaryText: spec.summaryText,
		// 主题帖与回复是两个独立 feed，各自翻页，不再合并成一个列表：
		// 合并后两条 feed 的页码对不上，跨页的时间倒序只能近似。
		loadPage: async (page) => {
			const feed =
				subTab === "topic"
					? await loadTopicPage(identity.id, page)
					: await loadReplyPage(identity.id, page);
			// hidden=true 时贴吧返回的是空列表：界面要说"对方隐藏了"，而不是"没有帖子"
			return { items: feed.rows, hidden: feed.hidden };
		},
		renderRow: renderPostRow,
		onError: (error) => onError(errorMessage(error)),
		onPage: (result) => {
			bindFloorButtons(pane);
			onRows(result.items);
		},
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
	/** 分开 / 合并记在 dataset 上：点「刷新当前页签」之后保持用户选的那种 */
	let mode: PostMode = body.dataset.postmode === "merged" ? "merged" : "split";

	body.innerHTML =
		// 占比饼图：按"发帖都发在哪些吧"统计，随已加载的行更新
		`<div class="tb-eztb-piestat"></div>` +
		// 工具条：显示方式（分开 / 合并）+ 按吧筛选 + 内容搜索。
		// 筛选与搜索只作用于下面的列表；饼图始终是全量（筛成一段没有信息量）。
		`<div class="tb-eztb-postbar">` +
		`<div class="tb-eztb-postbar-row">` +
		`<span class="tb-eztb-postbar-label">显示</span>` +
		`<span class="tb-eztb-modetabs" role="tablist">` +
		POST_MODES.map(
			(item) =>
				`<button type="button" role="tab" class="tb-eztb-modetab${item.id === mode ? " active" : ""}" data-postmode="${item.id}" title="${item.title}">${item.label}</button>`,
		).join("") +
		`</span>` +
		`<span class="tb-eztb-postbar-label">只看</span>` +
		`<select class="tb-eztb-input tb-eztb-forumfilter" data-act="forum-filter">` +
		`<option value="">全部吧</option>` +
		`</select>` +
		`<input type="search" class="tb-eztb-input tb-eztb-postsearch" data-act="post-search" placeholder="在发帖 / 回复里搜内容" value="${escapeHtml(body.dataset.query ?? "")}">` +
		`<button type="button" class="tb-eztb-minibtn" data-act="search-all" title="把两路还没加载的页都取回来再给结论；页数上限是设置里的「单个列表最多加载页数」">搜全部</button>` +
		`<button type="button" class="tb-eztb-minibtn" data-role="search-stop" disabled title="停止继续翻页，保留已经取到的">停止</button>` +
		`</div>` +
		`<div class="tb-eztb-hint" data-role="filter-hint"></div>` +
		`</div>` +
		`<div class="tb-eztb-postview" data-mode="${mode}">` +
		`<div class="tb-eztb-splitview">` +
		`<div class="tb-eztb-subtabs" role="tablist">` +
		POST_SUBTABS.map(
			(item) =>
				`<button type="button" role="tab" class="tb-eztb-subtab${item.id === active ? " active" : ""}" data-subtab="${item.id}">${item.label}</button>`,
		).join("") +
		`</div>` +
		POST_SUBTABS.map(
			(item) =>
				`<div class="tb-eztb-subpane${item.id === active ? " active" : ""}" data-subpane="${item.id}"></div>`,
		).join("") +
		`</div>` +
		// 合并视图：两路 feed 已加载的行按时间倒序合成一个列表，翻页时两路各取下一页
		`<div class="tb-eztb-mergedview">` +
		`<div class="tb-eztb-notice" data-role="merged-notice"></div>` +
		`<div class="tb-eztb-list" data-role="merged-list"></div>` +
		`<button class="tb-eztb-more" data-role="merged-more" disabled>加载中…</button>` +
		`<div class="tb-eztb-hint" data-role="merged-hint"></div>` +
		`</div>` +
		`</div>`;

	let counts: ForumCounts = {};
	/** 展开"全部吧"列表的状态：面板重渲染会重建 DOM，状态得存在这里 */
	let listOpen = false;
	/** 「只看某个吧」选中的吧名（空串 = 全部吧）。只筛下面两个子页签的列表，饼图保持全量 */
	let forumFilter = "";
	/**
	 * 还没回来的那几路 feed。

	 * 回复那一页要按吧反查吧名（串行限速，一个吧一次请求），冷启动时比主题帖晚好几秒；
	 * 在它回来之前饼图只有主题帖的段。用户 2026-09-27 报的"有时只统计了发帖的数据"
	 * 就是这个中间态被当成了结果，所以**没到齐必须在图上写明**（见 buildPieNotes）。
	 */
	const pending = new Set<PostSubTab>(POST_SUBTABS.map((item) => item.id));
	/** 这一路已经取到过行了（用来把"整路没取到"和"后面某一页没取到"分开说） */
	const loadedAny = new Set<PostSubTab>();
	/** 哪一路 feed 取数失败（失败要写进饼图旁边，不能只留在被隐藏的子页签里） */
	const failures = new Map<PostSubTab, string>();
	const pieEl = body.querySelector<HTMLElement>(".tb-eztb-piestat");
	const filterSelect = body.querySelector<HTMLSelectElement>(
		'[data-act="forum-filter"]',
	);
	const searchInput = body.querySelector<HTMLInputElement>(
		'[data-act="post-search"]',
	);
	const filterHintEl = body.querySelector<HTMLElement>(
		'[data-role="filter-hint"]',
	);
	const viewEl = body.querySelector<HTMLElement>(".tb-eztb-postview");
	const mergedListEl = body.querySelector<HTMLElement>(
		'[data-role="merged-list"]',
	);
	const mergedMoreBtn = body.querySelector<HTMLButtonElement>(
		'[data-role="merged-more"]',
	);
	const mergedHintEl = body.querySelector<HTMLElement>(
		'[data-role="merged-hint"]',
	);
	const mergedNoticeEl = body.querySelector<HTMLElement>(
		'[data-role="merged-notice"]',
	);
	const searchAllBtn = body.querySelector<HTMLButtonElement>(
		'[data-act="search-all"]',
	);
	const searchStopBtn = body.querySelector<HTMLButtonElement>(
		'[data-role="search-stop"]',
	);
	/** 已挂载的两路列表把手：合并视图要读它们的行、还能替用户继续翻页 */
	const handles = new Map<PostSubTab, PagedListHandle<PostRow>>();

	/** 搜索词（另存一份在 dataset 上，点「刷新当前页签」之后还在） */
	let searchQuery = body.dataset.query ?? "";
	/** 「搜全部」是否正在翻页；stopLoadingAll 让循环在当页取完后停下 */
	let loadingAll = false;
	let stopLoadingAll = false;
	/** 上一轮「搜全部」的结论；改搜索词 / 筛选条件、或者又手动加载了新页就作废 */
	let searchAllResult: SearchAllSummaryInput | null = null;

	const pagesLoaded = (id: PostSubTab): number => handles.get(id)?.pages() ?? 0;

	const loadedRows = (id: PostSubTab): PostRow[] =>
		handles.get(id)?.rows() ?? [];

	const matchesForum = (forumName: string): boolean =>
		!forumFilter || (forumName.trim() || UNKNOWN_FORUM) === forumFilter;

	const matchesFilters = (post: PostRow): boolean =>
		matchesForum(post.forumName) && postMatchesQuery(post, searchQuery);

	/** 分开视图的行是**增量**插进 DOM 的，只能逐行按 data-forum / data-search 判定 */
	const rowMatchesFilters = (row: HTMLElement): boolean => {
		if (forumFilter && (row.dataset.forum ?? UNKNOWN_FORUM) !== forumFilter) {
			return false;
		}
		const needle = searchQuery.trim().toLowerCase();
		return !needle || (row.dataset.search ?? "").includes(needle);
	};

	const updateHint = () => {
		if (!filterHintEl) return;
		if (loadingAll) {
			filterHintEl.textContent =
				`正在翻页：主题帖 ${pagesLoaded("topic")} 页 / 回复 ${pagesLoaded("reply")} 页` +
				`（已加载 ${loadedRows("topic").length + loadedRows("reply").length} 条）…` +
				`点「停止」可以只保留已经取到的。`;
			return;
		}
		if (searchAllResult) {
			filterHintEl.textContent = buildSearchAllSummary(searchAllResult);
			return;
		}
		const matched = {
			topic: loadedRows("topic").filter(matchesFilters).length,
			reply: loadedRows("reply").filter(matchesFilters).length,
		};
		filterHintEl.textContent = buildPostFilterHint({
			forum: forumFilter,
			query: searchQuery,
			matched,
			loadedTotal: loadedRows("topic").length + loadedRows("reply").length,
		});
	};

	/** 「搜全部」跑完：把结论记下来（翻了几页、看了多少条、命中多少、是否真的翻完） */
	const summarizeSearchAll = () => {
		searchAllResult = {
			query: searchQuery,
			pages: { topic: pagesLoaded("topic"), reply: pagesLoaded("reply") },
			loaded: {
				topic: loadedRows("topic").length,
				reply: loadedRows("reply").length,
			},
			matched: {
				topic: loadedRows("topic").filter(matchesFilters).length,
				reply: loadedRows("reply").filter(matchesFilters).length,
			},
			// 只有"真的没有更多数据"才算翻完；到页数上限停的要说清可能还有更早的
			complete: POST_SUBTABS.every((item) => {
				const handle = handles.get(item.id);
				return !handle || (handle.exhausted() && !handle.capped());
			}),
			pageLimit: getSettings().maxPagesPerList,
		};
	};

	/**
	 * 把两路还没加载的页都取回来，然后给结论。

	 * 请求顺序完全走原来的限速队列，间隔与手动点「加载更多」一样；
	 * 页数上限就是设置里的「单个列表最多加载页数」（每路各算）。
	 * 「停止」只是让循环在**当页取完**后不再发新请求，已经取到的都保留。
	 */
	const loadAllPages = async () => {
		if (loadingAll) return;
		loadingAll = true;
		stopLoadingAll = false;
		searchAllResult = null;
		if (searchStopBtn) searchStopBtn.disabled = false;
		if (searchAllBtn) searchAllBtn.disabled = true;
		updateHint();
		try {
			await Promise.all(
				POST_SUBTABS.map(async (item) => {
					const handle = handles.get(item.id);
					if (!handle) return;
					while (!stopLoadingAll && !handle.exhausted()) {
						const before = handle.rows().length;
						await handle.loadNext();
						updateHint();
						// 防呆：既没进展也没翻完（理论上不会发生）就别在这里空转
						if (handle.rows().length === before && !handle.exhausted()) break;
					}
				}),
			);
		} finally {
			loadingAll = false;
			if (searchStopBtn) searchStopBtn.disabled = true;
			if (searchAllBtn) searchAllBtn.disabled = false;
			summarizeSearchAll();
			applyFilters();
		}
	};

	/**
	 * 合并视图：把两路**已经加载出来的**行按时间倒序合成一个列表。

	 * 两条 feed 的页码互不相干（§4.3），所以跨 feed 的时间顺序只能是近似的——
	 * 按钮的 title 与文档里都写明了这一点；点「加载更多」时两路各取下一页。
	 */
	const renderMerged = () => {
		if (!mergedListEl) return;
		const topicLoaded = loadedRows("topic");
		const replyLoaded = loadedRows("reply");
		const loadedTotal = topicLoaded.length + replyLoaded.length;
		const rows = mergePostRows(topicLoaded, replyLoaded).filter(matchesFilters);
		mergedListEl.innerHTML = rows.length
			? rows.map(renderPostRow).join("")
			: `<div class="tb-eztb-empty">${escapeHtml(
					loadedTotal
						? "没有符合筛选条件的发帖或回复"
						: "还没有加载到发帖或回复",
				)}</div>`;
		if (mergedNoticeEl) {
			const hiddenAll = POST_SUBTABS.every((item) =>
				handles.get(item.id)?.hidden(),
			);
			mergedNoticeEl.innerHTML =
				hiddenAll && !loadedTotal
					? `<div class="tb-eztb-warn">${escapeHtml(HIDDEN_POSTS_NOTE)}</div>`
					: "";
		}
		bindFloorButtons(mergedListEl);

		const loading = POST_SUBTABS.some((item) => pending.has(item.id));
		const done = POST_SUBTABS.every((item) => handles.get(item.id)?.exhausted());
		const failed = POST_SUBTABS.map((item) => failures.get(item.id)).filter(
			(message): message is string => !!message,
		);
		if (mergedHintEl) {
			mergedHintEl.textContent = [
				`已加载 ${topicLoaded.length} 个主题帖 + ${replyLoaded.length} 条回复`,
				rows.length !== loadedTotal ? `当前显示 ${rows.length} 条` : "",
				loading ? "还有数据在加载…" : "",
				done && failed.length ? `部分数据没取到：${failed.join("；")}` : "",
			]
				.filter(Boolean)
				.join(" · ");
		}
		if (mergedMoreBtn) {
			mergedMoreBtn.disabled = loading || done;
			mergedMoreBtn.textContent = loading
				? "加载中…"
				: done
					? "没有更多了"
					: "加载更多";
		}
	};

	/**
	 * 筛选 / 搜索变化后统一走这里：分开视图只切行的显隐（DOM 里保留全部行，所以翻页新来的行
	 * 也会被同一套规则筛），合并视图重建列表，最后更新那行提示。
	 * 用 class 而不是 `hidden` 属性——行是 flex 布局，`hidden` 的 display 会被样式表覆盖。
	 */
	const applyFilters = () => {
		for (const item of POST_SUBTABS) {
			for (const row of body.querySelectorAll<HTMLElement>(
				`.tb-eztb-subpane[data-subpane="${item.id}"] .tb-eztb-row`,
			)) {
				row.classList.toggle("tb-eztb-filtered-out", !rowMatchesFilters(row));
			}
		}
		renderMerged();
		updateHint();
	};

	/**
	 * 重建下拉框选项：吧名来自**已加载的行**，所以「加载更多」之后会多出新的吧。
	 * 选项字符串没变就不动 DOM——否则每次新数据到齐都会把正在展开的下拉框收起来。
	 */
	const refreshForumFilter = () => {
		if (!filterSelect) return;
		const html = buildForumFilterOptionsHtml(counts, forumFilter);
		if (filterSelect.dataset.options === html) return;
		filterSelect.dataset.options = html;
		filterSelect.innerHTML = html;
		// 选中的吧在新数据里没有了（比如点过「刷新当前页签」），退回「全部吧」
		if (
			!Array.from(filterSelect.options).some(
				(option) => option.value === forumFilter,
			)
		) {
			forumFilter = "";
		}
		filterSelect.value = forumFilter;
	};

	filterSelect?.addEventListener("change", () => {
		forumFilter = filterSelect.value;
		searchAllResult = null;
		applyFilters();
	});

	searchInput?.addEventListener("input", () => {
		searchQuery = searchInput.value;
		body.dataset.query = searchQuery;
		// 条件变了，上一轮「搜全部」的结论作废，回到普通提示
		searchAllResult = null;
		applyFilters();
	});

	// 回车 = 把没加载的页也翻完再给结论（打字时只筛已加载的行，不会发请求）
	searchInput?.addEventListener("keydown", (event) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		void loadAllPages();
	});

	searchAllBtn?.addEventListener("click", () => {
		void loadAllPages();
	});
	searchStopBtn?.addEventListener("click", () => {
		stopLoadingAll = true;
	});

	mergedMoreBtn?.addEventListener("click", () => {
		void (async () => {
			// 两路各取下一页（各自有 loading 守卫；某一路取完了就自己空转）
			await Promise.all(
				POST_SUBTABS.map(
					(item) => handles.get(item.id)?.loadNext() ?? Promise.resolve(),
				),
			);
			renderMerged();
			updateHint();
		})();
	});

	// 显示方式：分开（两个列表各自翻页）/ 合并（合成一个列表）
	for (const button of body.querySelectorAll<HTMLElement>("[data-postmode]")) {
		button.addEventListener("click", () => {
			const next: PostMode =
				button.dataset.postmode === "merged" ? "merged" : "split";
			if (next === mode) return;
			mode = next;
			body.dataset.postmode = mode;
			if (viewEl) viewEl.dataset.mode = mode;
			for (const item of body.querySelectorAll<HTMLElement>("[data-postmode]")) {
				item.classList.toggle("active", item.dataset.postmode === mode);
			}
			applyFilters();
		});
	}

	const updatePie = () => {
		if (!pieEl) return;
		const notes = buildPieNotes(
			POST_SUBTABS.map((item) => ({
				label: item.label,
				loading: pending.has(item.id),
				error: failures.get(item.id),
				hasRows: loadedAny.has(item.id),
			})),
		);
		pieEl.innerHTML =
			buildForumPieSvg(counts) + notes + buildForumListHtml(counts, listOpen);
		pieEl
			.querySelector('[data-act="pie-all"]')
			?.addEventListener("click", () => {
				listOpen = !listOpen;
				updatePie();
			});
		refreshForumFilter();
		applyFilters();
	};
	updatePie();

	const mounted = new Set<PostSubTab>();

	/** 取一页并挂上去（同一个子页签只挂一次）。 */
	const mount = (id: PostSubTab) => {
		if (mounted.has(id)) return;
		mounted.add(id);
		const pane = body.querySelector<HTMLElement>(
			`.tb-eztb-subpane[data-subpane="${id}"]`,
		);
		if (pane) {
			const handle = mountPostsSubList(
				pane,
				identity,
				id,
				(rows) => {
					// 首批数据到齐，撤掉「还在加载」；重试成功后失败提示也要一起消失
					pending.delete(id);
					failures.delete(id);
					loadedAny.add(id);
					// 手动「加载更多」又添了新页：上一轮「搜全部」的结论不再代表全部，作废
					if (!loadingAll) searchAllResult = null;
					counts = mergeForumCounts(counts, countPostsByForum(rows));
					updatePie();
				},
				(message) => {
					pending.delete(id);
					failures.set(id, message);
					updatePie();
				},
			);
			handles.set(id, handle);
		}
	};

	const activate = (id: PostSubTab) => {
		body.dataset.subtab = id;
		for (const button of body.querySelectorAll<HTMLElement>(".tb-eztb-subtab")) {
			button.classList.toggle("active", button.dataset.subtab === id);
		}
		for (const pane of body.querySelectorAll<HTMLElement>(".tb-eztb-subpane")) {
			pane.classList.toggle("active", pane.dataset.subpane === id);
		}
		mount(id);
	};

	/**
	 * 进「发帖」页签就把**两路 feed 的第一页都取回来**。

	 * 这两个子页签原本是点哪个取哪个（省请求），但饼图现在是按吧统计的：
	 * 只算主题帖会漏掉一半数据（用户 2026-09-27 反馈"初次点进只统计了发帖的数据"）。
	 * 代价是进页签时多一次请求，换来饼图一开始就是完整的。
	 */
	for (const item of POST_SUBTABS) mount(item.id);
	activate(active);

	for (const button of body.querySelectorAll<HTMLElement>(".tb-eztb-subtab")) {
		button.addEventListener("click", () => {
			const id = button.dataset.subtab;
			if (id === "topic" || id === "reply") activate(id);
		});
	}
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
	const initialTab: TabId =
		options.tab ?? normalizePanelTabId(getSettings().defaultTab);
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
