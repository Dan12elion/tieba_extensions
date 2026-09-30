/**
 * 「发帖」页签：主题帖 / 回复两路 feed 的分页列表、占比饼图、按吧筛选与内容搜索、合并视图。
 *
 * 输入：面板编排层传进来的容器元素与 identity（取数要用 identity.id）。
 * 子页签、显示方式（分开 / 合并）、搜索词都记在容器的 dataset 上，
 * 所以点「刷新当前页签」之后仍然保持用户原来选的那套。
 * 取数在 core/userPost.ts，占比统计与提示文案的拼装在 core/postStats.ts。
 */

import type { Identity } from "../../core/identity.ts";
import { fetchReplyFloor, readReplyFloorCache } from "../../core/replyFloor.ts";
import {
	type PostKind,
	type PostRow,
	loadReplyPage,
	loadTopicPage,
} from "../../core/userPost.ts";
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
	mergeForumCounts,
	mergePostRows,
	postMatchesQuery,
	postRowSubParts,
} from "../../core/postStats.ts";
import { UNKNOWN_FORUM } from "../../core/activityRule.ts";
import { getSettings } from "../../core/settings.ts";
import { escapeHtml, formatTimestamp, threadUrl } from "../../core/util.ts";
import { describeRequestError } from "../../core/errno.ts";
import { mountPagedList, type PagedListHandle } from "./pagedList.ts";

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
		onError: (error) => onError(describeRequestError(error)),
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
export function renderPostsTab(body: HTMLElement, identity: Identity): void {
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
			POST_SUBTABS.map((item) => {
				const handle = handles.get(item.id);
				return {
					label: item.label,
					loading: pending.has(item.id),
					error: failures.get(item.id),
					hasRows: loadedAny.has(item.id),
					// 失败提示要写到页上：只写"后续页没取到"没法判断是第 2 页还是第 9 页
					failedPage: handle?.failedPage() ?? undefined,
					loadedPages: handle?.pages() ?? 0,
				};
			}),
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
