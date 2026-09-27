/**
 * 「发帖 / 回复」占比统计与饼图。
 *
 * 纯逻辑：只吃已经加载出来的行，不碰 DOM、不发请求，
 * 所以离线就能测（scripts/keyword-test.mjs 会把它一起打包进来断言）。
 *
 * 饼图用 SVG 的 stroke-dasharray 画环（而不是 path 弧线）：
 * 只有一个分类占到 100% 时，弧线路径的起终点会重合、算出 NaN，
 * dasharray 写法没有这个边界问题，也不需要三角函数。
 */

import type { PostKind } from "./userPost.ts";

export interface PostCounts {
	topic: number;
	reply: number;
	sub: number;
}

export const POST_KIND_ORDER: PostKind[] = ["topic", "reply", "sub"];

export const POST_KIND_TEXT: Record<PostKind, string> = {
	topic: "主题帖",
	reply: "回复",
	sub: "楼中楼",
};

/** 与「发帖」页签里的标签同色系，方便对照 */
export const POST_KIND_COLOR: Record<PostKind, string> = {
	topic: "#1677ff",
	reply: "#8a8f99",
	sub: "#e8a33d",
};

export function emptyCounts(): PostCounts {
	return { topic: 0, reply: 0, sub: 0 };
}

export function countPosts(rows: Array<{ kind: PostKind }>): PostCounts {
	const counts = emptyCounts();
	for (const row of rows) {
		if (row.kind === "topic") counts.topic += 1;
		else if (row.kind === "reply") counts.reply += 1;
		else if (row.kind === "sub") counts.sub += 1;
	}
	return counts;
}

export function mergeCounts(a: PostCounts, b: PostCounts): PostCounts {
	return {
		topic: a.topic + b.topic,
		reply: a.reply + b.reply,
		sub: a.sub + b.sub,
	};
}

export function totalCount(counts: PostCounts): number {
	return counts.topic + counts.reply + counts.sub;
}

export interface PieSlice {
	key: PostKind;
	label: string;
	count: number;
	color: string;
	/** 占比（0~1），total 为 0 时是 0 */
	fraction: number;
	/** 占比的百分比文本，保留一位小数 */
	percentText: string;
}

export function buildPieSlices(counts: PostCounts): PieSlice[] {
	const total = totalCount(counts);
	return POST_KIND_ORDER.map((key) => {
		const count = counts[key];
		const fraction = total > 0 ? count / total : 0;
		return {
			key,
			label: POST_KIND_TEXT[key],
			count,
			color: POST_KIND_COLOR[key],
			fraction,
			percentText: `${(fraction * 100).toFixed(1)}%`,
		};
	});
}

const RADIUS = 46;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 画一个环形饼图 + 图例。
 *
 * 返回的是一段 HTML 字符串（调用方直接塞进面板），所有数值都来自参数，
 * 没有用户输入的文字，所以这里不需要转义。
 */
export function buildPieSvg(counts: PostCounts): string {
	const slices = buildPieSlices(counts);
	const total = totalCount(counts);

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
				`data-kind="${slice.key}"><title>${slice.label} ${slice.count} 条（${slice.percentText}）</title></circle>`
			);
		})
		.join("");

	const legend = slices
		.map(
			(slice) =>
				`<span class="tb-eztb-pie-item" data-kind="${slice.key}">` +
				`<i class="tb-eztb-pie-dot" style="background:${slice.color}"></i>` +
				`<span class="tb-eztb-pie-label">${slice.label}</span>` +
				`<b class="tb-eztb-pie-count">${slice.count}</b>` +
				`<span class="tb-eztb-pie-percent">${slice.percentText}</span>` +
				`</span>`,
		)
		.join("");

	return (
		`<figure class="tb-eztb-pie">` +
		// -90° 让第一段从 12 点方向开始，看着更像常见的饼图
		`<svg class="tb-eztb-pie-svg" viewBox="0 0 120 120" role="img" aria-label="发帖与回复占比">` +
		`<g transform="rotate(-90 60 60)">${arcs}</g>` +
		`</svg>` +
		`<figcaption class="tb-eztb-pie-legend">${legend}` +
		`<div class="tb-eztb-pie-total">已加载 ${total} 条</div>` +
		`</figcaption>` +
		`</figure>`
	);
}
