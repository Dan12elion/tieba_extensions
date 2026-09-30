/**
 * 「资料」页签：把解析出来的身份信息按字段列出来。
 *
 * 输入：面板编排层传进来的容器元素与已经解析完成的 identity。
 * 只读 identity.profile，不发任何请求。
 */

import type { Identity } from "../../core/identity.ts";
import { escapeHtml } from "../../core/util.ts";

export function renderProfile(body: HTMLElement, identity: Identity): void {
	const profile = identity.profile ?? {};
	const genderText =
		profile.gender === 1 ? "男" : profile.gender === 2 ? "女" : "未知";
	const rows: Array<[string, string]> = [
		["贴吧号", profile.uid ? String(profile.uid) : "—"],
		["用户名", profile.un || "—"],
		["昵称", profile.nickname || "—"],
		["等级", profile.level ? String(profile.level) : "—"],
		["吧龄", profile.tbAge || "—"],
		["发帖数", profile.postNum !== undefined ? String(profile.postNum) : "—"],
		["粉丝数", profile.fansNum !== undefined ? String(profile.fansNum) : "—"],
		["关注数", profile.concernNum !== undefined ? String(profile.concernNum) : "—"],
		["关注吧数", profile.likeNum !== undefined ? String(profile.likeNum) : "—"],
		["性别", genderText],
		["IP 属地", profile.ip || "—"],
		["会员", profile.vipLevel ? `VIP ${profile.vipLevel}` : "—"],
		["吧务", profile.isBawu ? profile.bawuType || "是" : "—"],
		["简介", profile.intro || "—"],
	];

	body.innerHTML =
		`<dl class="tb-eztb-kv">${rows
			.map(
				([key, value]) =>
					`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`,
			)
			.join("")}</dl>` +
		`<div class="tb-eztb-actions" style="justify-content:flex-start;margin-top:14px;">` +
		(identity.portrait
			? `<button data-act="home">打开贴吧主页</button>`
			: "") +
		`</div>`;

	body.querySelector('[data-act="home"]')?.addEventListener("click", () => {
		if (!identity.portrait) return;
		window.open(
			`https://tieba.baidu.com/home/main?id=${encodeURIComponent(identity.portrait)}`,
			"_blank",
			"noopener,noreferrer",
		);
	});
}
