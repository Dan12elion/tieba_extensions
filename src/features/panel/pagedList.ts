/**
 * 面板通用：分页列表的挂载（一次只取一页，点「加载更多」再取下一页）。
 *
 * 被多个页签复用（关注的人 / 粉丝 / 发帖的两个子页签），所以单独一个文件。
 * 输入：容器元素、取一页的回调、逐行渲染函数、空列表 / 数据被隐藏时的文案与摘要文案。
 * 输出：一个把手（继续翻页、读已加载的行、页码、是否取完 / 到上限 / 被隐藏、失败在第几页）。
 * 页数上限取自设置里的「单个列表最多加载页数」，挂载时读一次。
 */

import { describeRequestError } from "../../core/errno.ts";
import { getSettings } from "../../core/settings.ts";
import { escapeHtml } from "../../core/util.ts";

export interface PageResult<T> {
	items: T[];
	totalPages?: number;
	/** 数据源说这份记录被隐藏了（发帖页签用：hidePost != 0） */
	hidden?: boolean;
}

export interface PagedListOptions<T> {
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
	/** 上一次失败发生在第几页（1 = 第一页；从没失败过返回 null）——饼图的提示要写到页上 */
	failedPage: () => number | null;
}

/** 分页列表：一次只取一页，点"加载更多"再取下一页。 */
export function mountPagedList<T>(
	options: PagedListOptions<T>,
): PagedListHandle<T> {
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
	/** 上一次失败的是第几页（成功一次就清掉）：饼图的失败提示要写到页上 */
	let failedPageNum: number | null = null;
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
			failedPageNum = null;
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
			const message = describeRequestError(error);
			// 失败的是哪一页：page 只在成功时 +1，所以这里试的是 page + 1
			failedPageNum = page + 1;
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
		failedPage: () => failedPageNum,
	};
}
