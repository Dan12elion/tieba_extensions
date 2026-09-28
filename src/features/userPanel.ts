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
	buildForumListHtml,
	buildForumPieSvg,
	buildPieNotes,
	countPostsByForum,
	mergeForumCounts,
	postRowSubParts,
} from "../core/postStats.ts";
import { type ForumActivity, loadForumActivity } from "../core/forumActivity.ts";
import { findSignInForums, signInSummary } from "../core/activityRule.ts";
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

/** 分页列表：一次只取一页，点"加载更多"再取下一页。 */
function mountPagedList<T>(options: PagedListOptions<T>): void {
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

			// 数据被隐藏时说清楚原因：不要显示成"该用户没有公开的主题帖"
			if (result.hidden) {
				noticeEl.innerHTML = `<div class="tb-eztb-warn">${escapeHtml(
					options.hiddenText ?? options.emptyText,
				)}</div>`;
			}
			options.onPage?.(result);

			const exhausted =
				result.items.length === 0 ||
				page >= maxPages ||
				(page >= totalPages && Number.isFinite(totalPages));

			if (!loaded && exhausted) {
				// 隐藏的情况下上面已经给了原因，这里不再重复一句"没有公开的帖子"
				if (!result.hidden) {
					listEl.innerHTML = `<div class="tb-eztb-empty">${escapeHtml(options.emptyText)}</div>`;
				}
			}

			moreBtn.disabled = exhausted;
			moreBtn.textContent = exhausted ? "没有更多了" : "加载更多";
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
	// 副标题由纯函数拼（吧名标签 / 楼中楼的回复对象 / 回复正文），见 core/postStats.ts
	const subParts = postRowSubParts(post);
	return (
		`<a class="tb-eztb-row" href="${escapeHtml(threadUrl(post.threadId))}" target="_blank" rel="noopener noreferrer">` +
		`<span class="tb-eztb-row-main">` +
		`<span class="tb-eztb-row-title">` +
		`<span class="tb-eztb-tag tb-eztb-tag-${post.kind}">${POST_KIND_LABEL[post.kind]}</span>` +
		`${escapeHtml(post.title || post.preview || "(无标题)")}` +
		`</span>` +
		(subParts.length
			? `<span class="tb-eztb-row-sub">${subParts.join(" ")}</span>`
			: `<span class="tb-eztb-row-sub">未知贴吧</span>`) +
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
): void {
	const spec = POST_SUBTABS.find((item) => item.id === subTab)!;
	mountPagedList<PostRow>({
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

	body.innerHTML =
		// 占比饼图：按"发帖都发在哪些吧"统计，随已加载的行更新
		`<div class="tb-eztb-piestat"></div>` +
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

	let counts: ForumCounts = {};
	/** 展开"全部吧"列表的状态：面板重渲染会重建 DOM，状态得存在这里 */
	let listOpen = false;
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
			mountPostsSubList(
				pane,
				identity,
				id,
				(rows) => {
					// 首批数据到齐，撤掉「还在加载」；重试成功后失败提示也要一起消失
					pending.delete(id);
					failures.delete(id);
					loadedAny.add(id);
					counts = mergeForumCounts(counts, countPostsByForum(rows));
					updatePie();
				},
				(message) => {
					pending.delete(id);
					failures.set(id, message);
					updatePie();
				},
			);
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
