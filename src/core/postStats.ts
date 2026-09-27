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
import type { PostKind } from "./userPost.ts";

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
			`<circle cx="60" cy="60" r="${RADIUS}" fill="none" stroke="#eef0f3" stroke-width="${STROKE}"></circle>` +
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
