/**
 * 「发帖都发在哪些吧」占比统计与饼图。
 *
 * 纯逻辑：只吃已经加载出来的行，不碰 DOM、不发请求，
 * 所以离线就能测（scripts/keyword-test.mjs 会把它一起打包进来断言）。
 *
 * 饼图用 SVG 的 stroke-dasharray 画环（而不是 path 弧线）：
 * 只有一个分类占到 100% 时，弧线路径的起终点会重合、算出 NaN，
 * dasharray 写法没有这个边界问题，也不需要三角函数。
 *
 * 分类是**吧名**（原来按"主题帖/回复/楼中楼"分，2026-09-27 用户要求改成按吧）。
 * 吧可能很多，所以只画前 N 个，剩下的拢成「其它 M 个吧」，否则图例会长得没边。
 */

import { countPostsByForum } from "./activityRule.ts";
import type { PostKind, PostRow } from "./userPost.ts";

/** 吧名 → 条数 */
export type ForumCounts = Record<string, number>;

export { countPostsByForum };

export function mergeForumCounts(
	a: ForumCounts,
	b: ForumCounts,
): ForumCounts {
	const out: ForumCounts = { ...a };
	for (const [forum, count] of Object.entries(b)) {
		out[forum] = (out[forum] ?? 0) + count;
	}
	return out;
}

export function totalForumCount(counts: ForumCounts): number {
	return Object.values(counts).reduce((sum, value) => sum + value, 0);
}
import { escapeHtml } from "./util.ts";

/**
 * 一行发帖记录的「副标题」片段：吧名标签 / 楼中楼的回复对象 / 正文。
 *
 * 抽成纯函数是为了能离线断言「楼中楼有没有标出回复了谁」——这段以前只存在于
 * userPanel 的渲染字符串里，改坏了没有测试会红。返回的是 HTML 片段
 * （调用方 join 后塞进面板），所以内部统一走 escapeHtml，不信任任何字段。
 */
export function postRowSubParts(post: {
	kind: PostKind;
	forumName?: string;
	replyTo?: string;
	preview?: string;
}): string[] {
	const parts: string[] = [];
	if (post.forumName) {
		parts.push(
			`<span class="tb-eztb-row-forum">${escapeHtml(post.forumName)}</span>`,
		);
	}
	// 楼中楼是在回复某个人：只显示正文的话不知道他在回谁，把对象也带上
	if (post.kind === "sub" && post.replyTo) {
		parts.push(
			`<span class="tb-eztb-row-replyto">↩ ${escapeHtml(post.replyTo)}</span>`,
		);
	}
	// 主题帖的副标题只放吧名：用户要的是"回复内容"，而主题帖的正文摘要与标题
	// 往往是同一段话，再显示一遍没有信息量
	if (post.kind !== "topic" && post.preview) {
		parts.push(escapeHtml(post.preview));
	}
	return parts;
}

/** 扇段配色：按排名取色，同一个排名永远同一个颜色（不随吧名变化，方便一眼比较） */
export const PIE_COLORS = [
	"#1677ff",
	"#e8a33d",
	"#3fb950",
	"#a371f7",
	"#e5534b",
	"#1f9ea8",
];
/** 「其它 N 个吧」用的中性色 */
export const PIE_OTHER_COLOR = "#b6bcc6";

export interface ForumSlice {
	/** 吧名；聚合出来的那一段是 `null` */
	forum: string | null;
	label: string;
	count: number;
	color: string;
	/** 占比（0~1），total 为 0 时是 0 */
	fraction: number;
	/** 占比的百分比文本，保留一位小数 */
	percentText: string;
}

export interface ForumStat {
	forum: string;
	count: number;
	fraction: number;
	percentText: string;
}

/** **全部**吧的条数与占比（按条数从多到少，并列按吧名），给"查看全部"列表用。 */
export function buildForumStats(counts: ForumCounts): ForumStat[] {
	const total = totalForumCount(counts);
	if (!total) return [];
	return Object.entries(counts)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([forum, count]) => ({
			forum,
			count,
			fraction: count / total,
			percentText: `${((count / total) * 100).toFixed(1)}%`,
		}));
}

/**
 * 「只看某个吧」下拉框的选项：`全部吧` + 每个吧的条数（按条数从多到少）。
 *
 * 选项值与行上的 `data-forum` 是同一个字符串（见 features/userPanel.ts 的 renderPostRow）。
 * 吧名来自页面数据，属性与文本都要转义；`selected` 是当前选中的吧名——
 * 重新构建选项（每次新数据到齐都会重建）之后必须把选中项还原，否则会跳回"全部吧"。
 */
export function buildForumFilterOptionsHtml(
	counts: ForumCounts,
	selected: string,
): string {
	const options = buildForumStats(counts).map((stat) => {
		const value = escapeHtml(stat.forum);
		const isSelected = stat.forum === selected ? " selected" : "";
		return `<option value="${value}"${isSelected}>${value}（${stat.count}）</option>`;
	});
	return (
		`<option value=""${selected ? "" : " selected"}>全部吧</option>` +
		options.join("")
	);
}

/**
 * 这一行是否命中搜索词。

 * 只看**标题 + 正文摘要**（用户要的是"发帖或回复里有没有这句话"），大小写不敏感，
 * 首尾空白忽略；搜索词为空时一律算命中（等于没筛）。
 */
export function postMatchesQuery(
	post: Pick<PostRow, "title" | "preview">,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return `${post.title ?? ""} ${post.preview ?? ""}`
		.toLowerCase()
		.includes(needle);
}

/**
 * 「合并查询」用的行序：主题帖 + 回复按时间倒序。

 * 两条 feed 的页码本来互不相干（见 §4.3），所以这里只是把**已经加载出来的**行
 * 归并成一个列表，跨 feed 的时间顺序是近似的——面板里也是这么写的。
 * `Array.prototype.sort` 是稳定排序，同一秒的行会保持"主题帖在前"的原始顺序。
 */
export function mergePostRows(
	topicRows: PostRow[],
	replyRows: PostRow[],
): PostRow[] {
	return [...topicRows, ...replyRows].sort((a, b) => b.createTime - a.createTime);
}

export interface PostFilterHintInput {
	/** 「只看某个吧」选中的吧名，空串 = 不筛 */
	forum: string;
	/** 搜索词，空串 = 不搜 */
	query: string;
	/** 筛 + 搜之后还剩多少条 */
	matched: { topic: number; reply: number };
	/** 已加载的总条数（两路相加），只有"一条都没命中"时才用得上 */
	loadedTotal: number;
}

/**
 * 筛选/搜索的说明文字：写清筛的是谁、命中多少条；一条都没有就明说。

 * 既没筛也没搜时返回空串，界面上不留一行废话。
 */
export function buildPostFilterHint(input: PostFilterHintInput): string {
	const forum = input.forum.trim();
	const query = input.query.trim();
	if (!forum && !query) return "";
	const label =
		forum && query
			? `筛选「${forum}」+ 搜索「${query}」`
			: forum
				? `筛选「${forum}」`
				: `搜索「${query}」`;
	const { topic, reply } = input.matched;
	if (topic + reply === 0) {
		return query
			? `${label}：已加载的 ${input.loadedTotal} 条里没有命中`
			: `${label}：该用户在这个吧没有发帖或回复`;
	}
	return `${label}：主题帖 ${topic} 个 · 回复 ${reply} 条`;
}

export interface SearchAllSummaryInput {
	query: string;
	/** 已经翻到第几页（两路各算） */
	pages: { topic: number; reply: number };
	/** 已经拿到多少条（两路各算） */
	loaded: { topic: number; reply: number };
	/** 命中多少条（两路各算） */
	matched: { topic: number; reply: number };
	/** 两路是否都翻到底了；false = 到页数上限就停了，可能还有更早的没搜到 */
	complete: boolean;
	/** 页数上限（设置里的「单个列表最多加载页数」） */
	pageLimit: number;
}

/**
 * 「搜全部」跑完之后的结论。

 * 关键是把**样本说清楚**：翻了几页、一共看了多少条、命中多少条，
 * 以及"到上限停了"还是"真的翻完了"——不然"没搜到"会被误读成"他没发过"。
 */
export function buildSearchAllSummary(input: SearchAllSummaryInput): string {
	const query = input.query.trim();
	const loadedTotal = input.loaded.topic + input.loaded.reply;
	const matchedTotal = input.matched.topic + input.matched.reply;
	const scope = input.complete
		? `已翻完主题帖 ${input.pages.topic} 页、回复 ${input.pages.reply} 页`
		: `翻到上限（每路最多 ${input.pageLimit} 页）时仍有更早的没加载，已翻主题帖 ${input.pages.topic} 页、回复 ${input.pages.reply} 页`;
	const hit =
		matchedTotal === 0
			? `没有命中`
			: `命中 ${matchedTotal} 条（主题帖 ${input.matched.topic} · 回复 ${input.matched.reply}）`;
	return `搜索「${query}」：${scope}，共 ${loadedTotal} 条，${hit}。`;
}

/**
 * 「查看全部 N 个吧」按钮 + 展开后的完整列表。

 * 饼图只画前几个吧、剩下的拢成「其它 N 个吧」，有些用户的"其它"占比很大，
 * 光看饼图看不出到底是哪些吧——这个列表把每一个吧的条数、占比和横条都摊开。
 * `open` 由调用方记住（面板每次重新渲染都会重新生成这段 HTML，状态不能存在 DOM 里）。
 */
export function buildForumListHtml(
	counts: ForumCounts,
	open: boolean,
): string {
	const stats = buildForumStats(counts);
	if (stats.length < 2) return "";
	const total = totalForumCount(counts);
	const button =
		`<button type="button" class="tb-eztb-pielistbtn" data-act="pie-all">` +
		`${open ? "收起" : `查看全部 ${stats.length} 个吧的占比`}</button>`;
	if (!open) return `<div class="tb-eztb-pielistwrap">${button}</div>`;

	const rows = stats
		.map(
			(stat) =>
				`<div class="tb-eztb-pieitem" data-forum="${escapeHtml(stat.forum)}">` +
				`<span class="tb-eztb-pieitem-name" title="${escapeHtml(stat.forum)}">${escapeHtml(stat.forum)}</span>` +
				`<span class="tb-eztb-pieitem-bar"><i style="width:${(stat.fraction * 100).toFixed(1)}%"></i></span>` +
				`<b class="tb-eztb-pieitem-count">${stat.count}</b>` +
				`<span class="tb-eztb-pieitem-percent">${stat.percentText}</span>` +
				`</div>`,
		)
		.join("");
	return (
		`<div class="tb-eztb-pielistwrap">${button}` +
		`<div class="tb-eztb-pielist">` +
		`<div class="tb-eztb-pielist-head">共 ${stats.length} 个吧 · ${total} 条发言</div>` +
		rows +
		`</div></div>`
	);
}

/** 「发帖」页签里每一路 feed 的取数状态（主题帖 / 回复各一路）。 */
export interface PieFeedState {
	/** 子页签名字，例如「主题帖」「回复」 */
	label: string;
	/** 首批数据还在路上 */
	loading?: boolean;
	/** 这一路取数失败的原因（有值就说明饼图里缺了这一路的条数） */
	error?: string;
	/**
	 * 失败之前这一路**已经取到过**行。

	 * 用来把两种失败分开说：第一页就没取到（饼图里整路都缺）vs 翻后面某一页失败
	 * （饼图里已经有它前面那几页的条数，只是少了后面的）。两者都写"饼图里缺这一路"
	 * 是错的——后者会让用户以为整路都没算进去。
	 */
	hasRows?: boolean;
	/**
	 * 取数失败发生在第几页（1 = 第一页就没取到）。
	 *
	 * 有了它才能把提示写到**页**上：用户报过「饼图里的回复条数少一截」，
	 * 只说"后续页没取到"没法判断是第 2 页还是第 9 页出了问题（也就没法决定要不要重试）。
	 */
	failedPage?: number;
	/** 失败之前已经成功取到几页 */
	loadedPages?: number;
}

/**
 * 饼图旁边的状态说明：**数据没到齐就别说数据齐了**。

 * 用户 2026-09-27 第二次反馈「初次点进时饼图*有时*只统计了主题帖、有时又会自动统计全部」。
 * 机制是：回复那一页要靠 `getForumName` **按吧反查吧名**（回复 feed 只给 forumId），
 * 而所有请求都走 400ms 间隔的串行限速队列——冷启动时回复要比主题帖晚好几秒才到。
 * 在它回来之前饼图只有主题帖的段，**看起来却和完整的一模一样**，于是"看早了"就变成
 * 一个看起来像数据错了的现象。

 * 所以：只要还有一路没到齐、或者哪一路取数失败，就必须写在图上（返回 HTML 片段）。
 * 两路都到齐且都成功时返回空串——提示会自动消失，不会一直挂着。
 */
export function buildPieNotes(states: PieFeedState[]): string {
	const loading = states.filter((state) => state.loading);
	const failed = states.filter((state) => !state.loading && state.error);
	const parts: string[] = [];
	if (loading.length) {
		const labels = loading.map((state) => `「${state.label}」`).join("、");
		parts.push(
			`<div class="tb-eztb-pie-pending">${labels}的数据还在加载，下面的占比<b>还不完整</b>——到齐后会自动补上。</div>`,
		);
	}
	for (const state of failed) {
		const reason = escapeHtml(state.error ?? "");
		if (!state.hasRows) {
			// 第一页就没取到：整路的条数都不在饼图里
			const page = state.failedPage ?? 1;
			parts.push(
				`<div class="tb-eztb-warn">「${state.label}」的第 ${page} 页就没取到（饼图里缺这一路的条数）：${reason}</div>`,
			);
			continue;
		}
		// 前面几页算进去了，只是后续某一页失败——写清是哪一页，别让人以为整路都缺
		const detail =
			state.failedPage === undefined
				? "后续页没取到"
				: state.loadedPages
					? `第 ${state.failedPage} 页没取到（前 ${state.loadedPages} 页已经计入饼图）`
					: `第 ${state.failedPage} 页没取到`;
		parts.push(
			`<div class="tb-eztb-warn">「${state.label}」的${detail}（饼图只统计到已经加载出来的那部分）：${reason}</div>`,
		);
	}
	return parts.join("");
}

/**
 * 把「吧名 → 条数」变成扇段。

 * 只画前 `maxSlices` 个吧，剩下的合成一段「其它 N 个吧」——否则发帖多的用户
 * 图例会拖到几十行。并列条数的吧按吧名排序，保证结果稳定（同样数据同样顺序）。
 */
export function buildForumSlices(
	counts: ForumCounts,
	maxSlices = 5,
): ForumSlice[] {
	const total = totalForumCount(counts);
	if (!total) return [];

	const ranked = Object.entries(counts)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

	const head = ranked.slice(0, maxSlices);
	const rest = ranked.slice(maxSlices);
	const slices: ForumSlice[] = head.map(([forum, count], index) => ({
		forum,
		label: forum,
		count,
		color: PIE_COLORS[index % PIE_COLORS.length],
		fraction: count / total,
		percentText: `${((count / total) * 100).toFixed(1)}%`,
	}));

	if (rest.length) {
		const count = rest.reduce((sum, [, value]) => sum + value, 0);
		slices.push({
			forum: null,
			label: `其它 ${rest.length} 个吧`,
			count,
			color: PIE_OTHER_COLOR,
			fraction: count / total,
			percentText: `${((count / total) * 100).toFixed(1)}%`,
		});
	}
	return slices;
}

const RADIUS = 46;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 画一个「发帖都发在哪些吧」的环形饼图 + 图例。
 *
 * 返回的是一段 HTML 字符串（调用方直接塞进面板），所有数值都来自参数，
 * 没有用户输入的文字，所以这里不需要转义。
 */
export function buildForumPieSvg(
	counts: ForumCounts,
	maxSlices = 5,
): string {
	const slices = buildForumSlices(counts, maxSlices);
	const total = totalForumCount(counts);

	if (!total) {
		return (
			`<figure class="tb-eztb-pie">` +
			`<svg class="tb-eztb-pie-svg" viewBox="0 0 120 120" role="img" aria-label="暂无发帖数据">` +
			// 颜色走 CSS 变量（.tb-eztb-pie-track）：这里原本写死 #eef0f3，
			// 深色模式下就成了一圈刺眼的浅灰。写死的 SVG 颜色没有别处能兜住。
			`<circle class="tb-eztb-pie-track" cx="60" cy="60" r="${RADIUS}" fill="none" stroke-width="${STROKE}"></circle>` +
			`</svg>` +
			`<figcaption class="tb-eztb-pie-legend"><div class="tb-eztb-pie-empty">还没有加载到发帖记录</div></figcaption>` +
			`</figure>`
		);
	}

	let acc = 0;
	const arcs = slices
		.filter((slice) => slice.count > 0)
		.map((slice) => {
			const length = slice.fraction * CIRCUMFERENCE;
			const gap = CIRCUMFERENCE - length;
			// dashoffset 用负值往前推，让这一段的起点等于上一段的终点
			const offset = -acc;
			acc += length;
			return (
				`<circle class="tb-eztb-pie-slice" cx="60" cy="60" r="${RADIUS}" fill="none" ` +
				`stroke="${slice.color}" stroke-width="${STROKE}" ` +
				`stroke-dasharray="${length.toFixed(3)} ${gap.toFixed(3)}" ` +
				`stroke-dashoffset="${offset.toFixed(3)}" ` +
				`data-forum="${escapeHtml(slice.forum ?? "")}"><title>${escapeHtml(slice.label)} ${slice.count} 条（${slice.percentText}）</title></circle>`
			);
		})
		.join("");

	const legend = slices
		.map(
			(slice) =>
				`<span class="tb-eztb-pie-item" data-forum="${escapeHtml(slice.forum ?? "")}">` +
				`<i class="tb-eztb-pie-dot" style="background:${slice.color}"></i>` +
				`<span class="tb-eztb-pie-label" title="${escapeHtml(slice.label)}">${escapeHtml(slice.label)}</span>` +
				`<b class="tb-eztb-pie-count">${slice.count}</b>` +
				`<span class="tb-eztb-pie-percent">${slice.percentText}</span>` +
				`</span>`,
		)
		.join("");

	return (
		`<figure class="tb-eztb-pie">` +
		// -90° 让第一段从 12 点方向开始，看着更像常见的饼图
		`<svg class="tb-eztb-pie-svg" viewBox="0 0 120 120" role="img" aria-label="发帖都发在哪些吧">` +
		`<g transform="rotate(-90 60 60)">${arcs}</g>` +
		`</svg>` +
		`<figcaption class="tb-eztb-pie-legend">${legend}` +
		`<div class="tb-eztb-pie-total">已加载 ${total} 条 · ${Object.keys(counts).length} 个吧</div>` +
		`</figcaption>` +
		`</figure>`
	);
}
