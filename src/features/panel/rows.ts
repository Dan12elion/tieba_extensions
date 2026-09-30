/**
 * 面板通用：用户行的小渲染函数（「关注的人」与「粉丝」两个页签共用）。
 *
 * 输入：贴吧接口返回的用户对象（id / name / name_show / portrait）。
 * 输出：一行 HTML 字符串；头像地址与主页链接的口径都取自 core/util.ts。
 */

import { escapeHtml, portraitUrl, stripPortraitQuery } from "../../core/util.ts";

export function renderUserRow(user: {
	/** 贴吧接口有的地方给数字、有的地方给字符串，两种都要能渲染 */
	id?: string | number;
	name?: string;
	name_show?: string;
	portrait?: string;
}): string {
	const display = user.name_show || user.name || "贴吧用户";
	const portrait = stripPortraitQuery(user.portrait);
	const href = portrait
		? `https://tieba.baidu.com/home/main?id=${encodeURIComponent(portrait)}`
		: "";
	return (
		`<a class="tb-eztb-row" ${href ? `href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"` : ""}>` +
		(portrait
			? `<img class="tb-eztb-row-avatar" src="${escapeHtml(portraitUrl(portrait))}" alt="">`
			: `<span class="tb-eztb-row-avatar"></span>`) +
		`<span class="tb-eztb-row-main">` +
		`<span class="tb-eztb-row-title">${escapeHtml(display)}</span>` +
		(user.name ? `<span class="tb-eztb-row-sub">${escapeHtml(user.name)}</span>` : "") +
		`</span>` +
		`</a>`
	);
}
