/**
 * 「共同关注」页签：把"我"和"他"的关注列表求交集。
 *
 * 输入：面板编排层传进来的容器、identity（对方的 id），以及**我自己的标识**
 * （设置里的 `selfIdentity`，可以是贴吧号 / 用户名 / 主页链接）。
 *
 * 两条设计约束：
 *   1. **只读**：两边都只调 getFollow（关注的人），不做任何写操作（HARD 约束 D5）；
 *   2. **样本要诚实**：默认只读双方各 3 页（每页 20 人），页数上限受设置里
 *      「单个列表最多加载页数」约束。结论里必须写明读了多少页——"共同关注 2 人"
 *      很容易被读成"一共只有 2 个"（`buildMutualSummary()` 统一产出这句话）。
 */

import { getFollow, getUserByUid } from "tieba.js";
import { type Identity, callSdkLoose, resolveIdentity } from "../../core/identity.ts";
import { describeRequestError } from "../../core/errno.ts";
import {
	type FollowUser,
	buildMutualSummary,
	intersectFollows,
} from "../../core/mutualFollows.ts";
import { getSettings } from "../../core/settings.ts";
import { escapeHtml } from "../../core/util.ts";
import type { UserRef } from "../../page/adapters.ts";
import { renderUserRow } from "./rows.ts";

/** 打开页签时先各读几页；点「再比一页」两个方向一起往后翻 */
const INITIAL_PAGES = 3;
const PAGE_SIZE = 20;

/** 把设置里的"我自己"解析成 UserRef（贴吧号 / 用户名 / 主页链接都认）。 */
export function parseSelfRef(raw: string): UserRef | null {
	const value = String(raw ?? "").trim();
	if (!value) return null;
	// 主页链接：.../home/main?id=tb.1.xxxx 或 ...?id=12345
	const fromUrl = value.match(/[?&]id=([^&\s]+)/);
	const body = fromUrl ? decodeURIComponent(fromUrl[1]) : value;
	if (/^\d+$/.test(body)) return { userId: Number(body) };
	if (body.startsWith("tb.") || body.includes(".")) return { portrait: body };
	return { un: body };
}

/**
 * 认出"我自己"，返回 follow 接口要用的**内部 id** 与一个显示用的名字。
 *
 * 这里有一个必须踩过才知道的区别（1.9.0 实测）：面板副标题里的「贴吧号」
 * 是 `tiebaUid`，而 `getFollow` / `getProfile` 的 `uid` 参数要的是**内部 id**，
 * 两者不是一回事。用户从自己面板上抄下来的多半是「贴吧号」，
 * 直接当 uid 传进去会解析成**另一个账号**（实测：交集恒为 0，而且看起来"很像对的"）。
 *
 * 所以纯数字输入先走 `getUserByUid()`（`/c/u/user/getUserByTiebaUid`，按贴吧号查人），
 * 换出内部 id；查不到再退回"当成内部 id 直接用"（有人可能是从别处复制的内部 id）。
 */
async function resolveSelfIdentity(ref: UserRef): Promise<{ id: number; label: string }> {
	if (typeof ref.userId === "number" && Number.isFinite(ref.userId)) {
		try {
			const byUid: any = await callSdkLoose(() => getUserByUid(ref.userId!));
			const internalId = Number(byUid?.id ?? 0);
			if (internalId) {
				return {
					id: internalId,
					label: byUid?.nameShow || byUid?.name || String(ref.userId),
				};
			}
		} catch {
			// 贴吧号查不到就当它是内部 id，继续往下走（下面 resolveIdentity 会给结论）
		}
	}
	const identity: Identity = await resolveIdentity(ref);
	return {
		id: identity.id,
		label: identity.nickname || identity.un || "我",
	};
}

async function loadFollowPage(uid: number, page: number): Promise<FollowUser[]> {
	const res: any = await callSdkLoose(() => getFollow(uid, page));
	return Array.isArray(res?.follow_list) ? res.follow_list : [];
}

export function renderMutualTab(body: HTMLElement, identity: Identity): void {
	const settings = getSettings();
	const selfRef = parseSelfRef(settings.selfIdentity);

	if (!selfRef) {
		body.innerHTML =
			`<div class="tb-eztb-notice">` +
			`<div class="tb-eztb-warn">要看「共同关注」，得先告诉脚本你自己是谁：` +
			`在设置里填上你自己的<b>贴吧号</b>（或用户名 / 主页链接）。</div>` +
			`<div class="tb-eztb-hint">脚本会用这个身份读一次你自己的「关注的人」，` +
			`再和对方的关注列表求交集。全部只读，不会关注或取关任何人。</div>` +
			`</div>`;
		return;
	}

	const maxPages = Math.max(
		INITIAL_PAGES,
		Math.min(Number(settings.maxPagesPerList) || INITIAL_PAGES, 50),
	);

	body.innerHTML =
		`<div class="tb-eztb-notice"></div>` +
		`<div class="tb-eztb-hint" data-role="mutual-summary">正在读双方的关注列表…</div>` +
		`<div class="tb-eztb-list"></div>` +
		`<button class="tb-eztb-more" data-role="mutual-more">再比一页</button>` +
		`<div class="tb-eztb-hint" data-role="mutual-foot"></div>`;

	const noticeEl = body.querySelector<HTMLElement>(".tb-eztb-notice")!;
	const summaryEl = body.querySelector<HTMLElement>('[data-role="mutual-summary"]')!;
	const listEl = body.querySelector<HTMLElement>(".tb-eztb-list")!;
	const moreBtn = body.querySelector<HTMLButtonElement>('[data-role="mutual-more"]')!;
	const footEl = body.querySelector<HTMLElement>('[data-role="mutual-foot"]')!;

	let minePages = 0;
	let theirsPages = 0;
	let mine: FollowUser[] = [];
	let theirs: FollowUser[] = [];
	let capped = false;
	let loading = false;

	const loadOneMorePage = async (): Promise<boolean> => {
		const wantMine = minePages < maxPages;
		const wantTheirs = theirsPages < maxPages;
		if (!wantMine && !wantTheirs) {
			capped = true;
			return false;
		}
		if (wantMine) {
			const rows = await loadFollowPage(selfUid!, minePages + 1);
			minePages += 1;
			mine = mine.concat(rows);
			// 空页说明这一边到底了
			if (!rows.length) minePages = maxPages;
		}
		if (wantTheirs) {
			const rows = await loadFollowPage(identity.id, theirsPages + 1);
			theirsPages += 1;
			theirs = theirs.concat(rows);
			if (!rows.length) theirsPages = maxPages;
		}
		return true;
	};

	const render = () => {
		const { common, byName } = intersectFollows(mine, theirs);
		summaryEl.textContent = buildMutualSummary({
			common: common.length,
			byName,
			mineRead: mine.length,
			minePages,
			theirsRead: theirs.length,
			theirsPages,
			capped,
			mineLabel: selfLabel,
		});
		listEl.innerHTML = common.length
			? common.map(renderUserRow).join("")
			: `<div class="tb-eztb-empty">在已经读到的这些页里没有共同关注</div>`;
		moreBtn.disabled = loading || (minePages >= maxPages && theirsPages >= maxPages);
		moreBtn.textContent = loading
			? "读取中…"
			: moreBtn.disabled
				? "到页数上限了"
				: "再比一页";
	};

	let selfUid: number | null = null;
	let selfLabel = "我";

	const run = async () => {
		if (loading) return;
		loading = true;
		render();
		try {
			await loadOneMorePage();
			noticeEl.innerHTML = "";
		} catch (error) {
			noticeEl.innerHTML = `<div class="tb-eztb-error">${escapeHtml(
				describeRequestError(error, "共同关注"),
			)}</div>`;
		} finally {
			loading = false;
			render();
		}
	};

	moreBtn.addEventListener("click", () => {
		void run();
	});

	// 先把"我"认出来（一次请求，走限速队列），再开始比对
	void (async () => {
		try {
			const self = await resolveSelfIdentity(selfRef);
			selfUid = self.id;
			selfLabel = self.label;
			footEl.textContent = `以「${selfLabel}」的身份比对（每页 20 人，最多 ${maxPages} 页）`;
			await run();
		} catch (error) {
			noticeEl.innerHTML =
				`<div class="tb-eztb-error">认不出设置里的「我自己」：${escapeHtml(
					describeRequestError(error, "共同关注·我"),
				)}</div>`;
			summaryEl.textContent = "";
			moreBtn.disabled = true;
		}
	})();
}
