/**
 * 「关注的人」页签：分页列表，每页 20 人。
 *
 * 输入：面板编排层传进来的容器元素与 identity（取数要用 identity.id）。
 * 取数走 tieba.js 的 getFollow（/c/u/follow/followList，返回的是用户而不是贴吧）。
 */

import { getFollow } from "tieba.js";
import { type Identity, callSdkLoose } from "../../core/identity.ts";
import { toNumber } from "../../core/util.ts";
import { mountPagedList } from "./pagedList.ts";
import { renderUserRow } from "./rows.ts";

const FOLLOW_PAGE_SIZE = 20;

/**
 * 「关注的人」。
 *
 * 注意：`getFollow` 对应 /c/u/follow/followList，返回的是**用户**而不是贴吧。
 * 上游网页的 /follow 页面标题是「关注列表 / 共关注 N 人」。
 * 关注贴吧是另一个接口（getLikeForum），见 renderFollowForumsTab。
 */
export function renderFollowUsersTab(
	body: HTMLElement,
	identity: Identity,
): void {
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
