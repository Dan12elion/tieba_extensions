/**
 * 页面上的「成分」徽章：只在命中关键词时才插，最多显示 3 个，多余的收成 +N。
 *
 * 徽章紧随 eztb 按钮之后，用与按钮相同的思路处理点击：
 * 元素本身注册到 WeakMap，由 main.ts 在 document 捕获阶段统一接管
 * （页面自己的冒泡监听可能吞掉点击，这一点在按钮上已经踩过一次）。
 *
 * 宽度预算是这里最要紧的事：新版贴吧的头部行高度写死 40px
 * （`.image-text .user-info{height:40px}`），而这一行里能腾出来的空间就是
 * `.head-spacer`（`flex:1`）此刻的宽度。标记一折行就会顶到下面的标题与正文上，
 * 所以是按预算逐个试放：放不下就少放一个，再放不下就退成一个圆点，
 * 绝不折行、也不把行顶宽（实测量到过压住正文 13px）。
 */

import { type CompositionHit, badgeHue } from "../core/composition.ts";
import type { UserRef } from "./adapters.ts";

export const BADGES_CLASS = "tb-eztb-badges";
export const BADGE_CLASS = "tb-eztb-badge";

/** 一行里最多显示几个徽章，多的收成 +N */
const MAX_VISIBLE = 3;

/**
 * 头部行里还能给我们用的宽度。
 *
 * 新版：`.head-spacer` 是 `flex:1`，它此刻的宽度就是整行剩下的空隙，
 * 也正是被我们的标记吃掉的那部分。
 * 旧版（没有 .head-line）：作者名那行是普通块级流，多占一点不会压到别人，不设限。
 */
function availableSlack(button: HTMLElement): number {
	const row = button.closest(".head-line");
	if (!row) return Number.POSITIVE_INFINITY;
	const spacer = row.querySelector(".head-spacer");
	if (!spacer) return Number.POSITIVE_INFINITY;
	// 减掉自己的 margin-left
	return spacer.getBoundingClientRect().width - 6;
}

const badgeRefs = new WeakMap<Element, UserRef>();

/** main.ts 的点击委托用它把徽章还原成用户 */
export function getBadgeRef(element: Element): UserRef | undefined {
	return badgeRefs.get(element);
}

function makeBadge(hit: CompositionHit, ref: UserRef): HTMLElement {
	const badge = document.createElement("span");
	badge.className = `${BADGE_CLASS}${hit.sure ? "" : " tb-eztb-badge-unsure"}`;
	badge.textContent = hit.rule.name;
	badge.style.setProperty("--tb-eztb-badge-hue", String(badgeHue(hit.rule.name)));
	badge.title = hitsTooltip(hit);
	badgeRefs.set(badge, ref);
	return badge;
}

/** 一整条命中信息的 tooltip 文案（徽章与圆点共用）。 */
function hitsTooltip(hit: CompositionHit): string {
	return [
		`成分：${hit.rule.name}`,
		`标记原因：${hit.summary}`,
		hit.sure ? "" : "（证据较弱，可能是误判）",
		"点击查看详情",
	]
		.filter(Boolean)
		.join("\n");
}

/** 把旧的徽章摘掉（重复检测、规则改动后重画时用）。 */
export function clearBadges(button: HTMLElement): void {
	const next = button.nextElementSibling;
	if (next?.classList?.contains(BADGES_CLASS)) next.remove();
}

/** 按检测结果重画这个按钮旁边的徽章；没有命中就什么都不插。 */
export function renderBadges(
	button: HTMLElement,
	hits: CompositionHit[],
	ref: UserRef,
): void {
	clearBadges(button);
	if (!hits.length || !button.isConnected) return;

	const container = document.createElement("span");
	container.className = BADGES_CLASS;
	container.dataset.count = String(hits.length);
	button.insertAdjacentElement("afterend", container);

	const budget = availableSlack(button);
	const fits = () => container.getBoundingClientRect().width <= budget;
	const tryAppend = (element: HTMLElement): boolean => {
		container.appendChild(element);
		if (fits()) return true;
		container.removeChild(element);
		return false;
	};

	// 1) 先尽可能多地放具体规则的标记
	const shown: CompositionHit[] = [];
	for (const hit of hits.slice(0, MAX_VISIBLE)) {
		if (!tryAppend(makeBadge(hit, ref))) break;
		shown.push(hit);
	}

	// 2) 还有没显示出来的就补一个 +N；放不下就退掉一个标记再来
	while (shown.length < hits.length) {
		const more = document.createElement("span");
		more.className = `${BADGE_CLASS} tb-eztb-badge-more`;
		more.textContent = `+${hits.length - shown.length}`;
		more.title = hits
			.slice(shown.length)
			.map((hit) => `${hit.rule.name}：${hit.summary}`)
			.join("\n");
		badgeRefs.set(more, ref);
		if (tryAppend(more)) break;
		const last = shown.length ? container.lastElementChild : null;
		if (!last) break;
		container.removeChild(last);
		shown.pop();
	}

	// 3) 一个都放不下的极窄行：退成一个圆点，信息全在 tooltip 里
	if (!container.childElementCount) {
		const dot = document.createElement("span");
		dot.className = `${BADGE_CLASS} tb-eztb-badge-dot`;
		dot.textContent = "●";
		dot.style.setProperty(
			"--tb-eztb-badge-hue",
			String(badgeHue(hits[0].rule.name)),
		);
		dot.title = hits.map(hitsTooltip).join("\n\n");
		badgeRefs.set(dot, ref);
		container.appendChild(dot);
	}
}
