/**
 * 「关注的吧」页签：关注的贴吧列表 + 两个按需触发的动作（查等级 / 检测签到号）。
 *
 * 输入：面板编排层传进来的容器元素与 identity——identity.id 用来取数，
 * identity.profile.likeForum 是关注贴吧被隐藏时的回退来源。
 * 取数在 core/userForums.ts、判定规则在 core/activityRule.ts；
 * 两个动作都是点了才发请求（查等级会写缓存，检测签到号只标注、不重排）。
 */

import {
	type ForumActivity,
	loadForumActivity,
} from "../../core/forumActivity.ts";
import { findSignInForums, signInSummary } from "../../core/activityRule.ts";
import { describeRequestError } from "../../core/errno.ts";
import {
	fetchUserForumLevel,
	readForumLevelCache,
} from "../../core/forumLevel.ts";
import type { Identity } from "../../core/identity.ts";
import { getSettings } from "../../core/settings.ts";
import {
	HIDDEN_FORUMS_NOTE,
	NO_LEVEL_NOTE,
	NO_USERNAME_NOTE,
	type ForumRow,
	loadUserForums,
} from "../../core/userForums.ts";
import { escapeHtml, forumUrl } from "../../core/util.ts";

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
export function renderFollowForumsTab(
	body: HTMLElement,
	identity: Identity,
): void {
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
							activityEl.innerHTML = `<div class="tb-eztb-error">${escapeHtml(describeRequestError(error))}</div>`;
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
							button.title = describeRequestError(error);
							button.disabled = false;
						}
					})();
				});
			}
		} catch (error) {
			body.innerHTML = `<div class="tb-eztb-error">${escapeHtml(describeRequestError(error))}</div>`;
		}
	})();
}
