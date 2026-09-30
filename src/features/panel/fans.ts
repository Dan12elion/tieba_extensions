/**
 * 「粉丝」页签：分页列表，总页数取自接口返回的 page.total_page。
 *
 * 输入：面板编排层传进来的容器元素与 identity（取数要用 identity.id）。
 * 取数走 tieba.js 的 getFans。
 */

import { getFans } from "tieba.js";
import { type Identity, callSdkLoose } from "../../core/identity.ts";
import { toNumber } from "../../core/util.ts";
import { mountPagedList } from "./pagedList.ts";
import { renderUserRow } from "./rows.ts";

export function renderFansTab(body: HTMLElement, identity: Identity): void {
	mountPagedList({
		body,
		emptyText: "该用户没有公开的粉丝",
		summaryText: (loaded, totalPages) =>
			Number.isFinite(totalPages)
				? `已加载 ${loaded} 位 / 共 ${totalPages} 页`
				: `已加载 ${loaded} 位`,
		loadPage: async (page) => {
			const res: any = await callSdkLoose(() => getFans(identity.id, page));
			const items = Array.isArray(res?.user_list) ? res.user_list : [];
			const totalPages = toNumber(res?.page?.total_page);
			return { items, totalPages: totalPages || undefined };
		},
		renderRow: renderUserRow,
	});
}
