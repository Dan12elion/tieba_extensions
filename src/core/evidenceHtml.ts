/**
 * 「成分」证据行 → HTML（纯函数，可在离线测试里钉死）。
 *
 * 为什么单独一个模块：这里要处理三件容易写错的事——
 *   1. **类型标签**：主题帖 / 回复 / 楼中楼（回复与楼中楼的意义完全不同）；
 *   2. **时间**：证据按时间倒序排（`core/composition.ts` 的 `sortEvidencesByRecency`），
 *      界面上得把时间写出来，否则"为什么这条排前面"看不出来；
 *   3. **跳转**：主题帖跳到帖子，回复 / 楼中楼用 `?pid=` **精确跳到那一楼**，
 *      并在那一行给「查楼层」（楼层不在发帖 feed 里，一条一次请求，见 core/replyFloor.ts）。
 *
 * 只 import 纯逻辑（composition.ts / util.ts）：不拖 SDK 进来，
 * 这样 keyword-test 能直接把它打包做断言。
 */

import type { CompositionEvidence } from "./composition.ts";
import { highlightKeywords } from "./composition.ts";
import { escapeHtml, formatTimestamp, threadUrl } from "./util.ts";

const KIND_LABEL: Record<CompositionEvidencePostKind, string> = {
	topic: "主题",
	reply: "回复",
	sub: "楼中楼",
};

type CompositionEvidencePostKind = "topic" | "reply" | "sub";

export interface EvidenceHtmlOptions {
	/**
	 * 已经查到的楼层（没有就渲染「查楼层」按钮）。
	 *
	 * 传函数而不是直接读缓存：这个模块要保持"纯"，缓存那侧（core/replyFloor.ts）
	 * 会把 SDK / 队列拖进来。
	 */
	floorFor?: (post: { threadId: string; postId: string }) => number | null;
}

/**
 * 回复 / 楼中楼的精确跳转：贴吧用 `?pid=` 定位到那一楼（它自己的"分享该楼"就是这个形式）。
 *
 * 一个诚实的说明：**这条"跳到那一楼"没有在服务端验证过**——直接 fetch 帖子页会被百度 403
 * 挡住（与 §5 #25 里"快照要另存"是同一堵墙），只能由人在浏览器里点一次确认。
 * 即便定位不生效，链接也一定落在**正确的那个帖子**里，所以这个兜底是可接受的。
 */
export function evidenceLink(
	evidence: CompositionEvidence,
): { href: string; label: string } | null {
	const post = evidence.post;
	if (!post?.threadId) return null;
	const base = threadUrl(post.threadId);
	if (post.kind === "topic" || !post.postId) {
		return { href: base, label: "打开主题帖" };
	}
	return {
		href: `${base}?pid=${encodeURIComponent(post.postId)}`,
		label: "打开这一楼",
	};
}

export function buildEvidenceHtml(
	evidence: CompositionEvidence,
	options: EvidenceHtmlOptions = {},
): string {
	const post = evidence.post;
	const parts: string[] = [];

	const kindTag = post
		? `<span class="tb-eztb-tag tb-eztb-tag-${post.kind}">${KIND_LABEL[post.kind]}</span>`
		: "";
	const time = post?.createTime
		? `<span class="tb-eztb-evidence-time">${escapeHtml(formatTimestamp(post.createTime))}</span>`
		: "";
	// 楼中楼：写清他回的是谁（接口给了才写，没给不编）
	const replyTo =
		post?.kind === "sub" && post.replyTo
			? `<span class="tb-eztb-evidence-replyto">回复 ${escapeHtml(post.replyTo)}</span>`
			: "";
	const forum =
		post?.forumName && post.kind !== "topic"
			? `<span class="tb-eztb-evidence-forum">${escapeHtml(post.forumName)}</span>`
			: "";

	parts.push(`<div class="tb-eztb-evidence">`);
	parts.push(
		`<div class="tb-eztb-evidence-head">` +
			kindTag +
			`<span class="tb-eztb-evidence-reason">${escapeHtml(evidence.reason)}</span>` +
			`<span class="tb-eztb-evidence-keyword">${escapeHtml(evidence.keyword)}</span>` +
			time +
			forum +
			replyTo +
			`</div>`,
	);
	if (evidence.excerpt) {
		// 命中的关键词在原文里高亮（与面板其他地方的写法一致，HTML 会被转义）
		parts.push(
			`<div class="tb-eztb-evidence-text">${highlightKeywords(evidence.excerpt, [evidence.keyword])}</div>`,
		);
	}

	// 跳转 + 楼层：只有发帖类证据有
	const link = evidenceLink(evidence);
	if (link) {
		const floorSlot = renderFloorSlot(post, options);
		parts.push(
			`<div class="tb-eztb-evidence-actions">` +
				`<a class="tb-eztb-evidence-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${link.label}</a>` +
				floorSlot +
				`</div>`,
		);
	}
	parts.push(`</div>`);
	return parts.join("");
}

/** 楼层那一格：查过就写「N楼」，没查过给「查楼层」按钮（点了才查）。 */
function renderFloorSlot(
	post: CompositionEvidence["post"],
	options: EvidenceHtmlOptions,
): string {
	if (!post || post.kind === "topic" || !post.postId || !post.threadId) return "";
	const known = options.floorFor?.({
		threadId: post.threadId,
		postId: post.postId,
	});
	if (known && known > 0) {
		return `<span class="tb-eztb-floor">${known}楼</span>`;
	}
	return (
		`<button type="button" class="tb-eztb-floorbtn"` +
		` data-thread="${escapeHtml(post.threadId)}" data-post="${escapeHtml(post.postId)}"` +
		` title="发帖记录里没有楼层号，点一下去这个帖子里查他在第几楼">查楼层</button>`
	);
}
