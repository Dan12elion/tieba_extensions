/**
 * 贴吧新旧版页面的 DOM 适配。
 *
 * 这部分逻辑来自已在生产中验证过的基线脚本（早期那个把 eztb.org 内嵌进
 * iframe 的版本），只把"挂按钮"的动作抽成回调，其余保持不变。
 */

import {
	cleanText,
	decodeUserName,
	stripPortraitQuery,
} from "../core/util.ts";

export interface UserRef {
	/** 贴吧内部用户 ID（数字） */
	userId?: number | null;
	/** 贴吧号（UID） */
	uid?: string | null;
	/** 用户名 */
	un?: string;
	/** 头像串 */
	portrait?: string;
	/** 昵称 */
	nickname?: string;
}

export type MountFn = (
	ref: UserRef,
	nameEl: Element,
	wrapper?: Element | null,
) => void;

type DataField = Record<string, any>;

function parseDataField(el: Element | null | undefined): DataField | null {
	const raw = el?.getAttribute?.("data-field");
	if (!raw) return null;
	try {
		return JSON.parse(raw.replace(/'/g, '"'));
	} catch {
		return null;
	}
}

function portraitFromHref(href: string | null | undefined): string | null {
	if (!href) return null;
	try {
		const url = new URL(href, location.href);
		const id = url.searchParams.get("id");
		return id ? stripPortraitQuery(id) : null;
	} catch {
		const matched = String(href).match(/[?&]id=([^&]+)/);
		return matched ? stripPortraitQuery(decodeURIComponent(matched[1])) : null;
	}
}

/** 旧版：帖子楼层作者 */
export function processOldPostAuthor(nameEl: Element, mount: MountFn): void {
	const post = nameEl.closest(".l_post");
	const dName = nameEl.closest("li.d_name");
	const card = post?.querySelector(".j_user_card") ?? null;
	const postData = parseDataField(post);
	const nameData = parseDataField(nameEl);
	const dNameData = parseDataField(dName);
	const cardData = parseDataField(card);
	const img =
		nameEl.closest(".d_author")?.querySelector("img[username]") ?? null;
	const author = (postData?.author ?? {}) as DataField;

	mount(
		{
			userId: author.user_id ?? dNameData?.user_id ?? null,
			un:
				decodeUserName(author.user_name) ||
				decodeUserName(nameData?.un) ||
				decodeUserName(cardData?.un) ||
				decodeUserName(img?.getAttribute("username")),
			portrait:
				stripPortraitQuery(author.portrait) ||
				stripPortraitQuery(nameData?.id) ||
				stripPortraitQuery(cardData?.id) ||
				portraitFromHref(nameEl.getAttribute("href")) ||
				"",
			nickname: cleanText(nameEl),
		},
		nameEl,
	);
}

/** 旧版：吧列表 / 首页的作者名 */
export function processOldFrsAuthor(nameEl: Element, mount: MountFn): void {
	const holder = nameEl.closest("[data-field]");
	const data = parseDataField(holder);
	const author = (data?.author ?? data?.author_user ?? {}) as DataField;

	mount(
		{
			userId: author.user_id ?? data?.user_id ?? null,
			un:
				decodeUserName(author.user_name ?? author.name) ||
				decodeUserName(data?.user_name ?? data?.author_name) ||
				decodeUserName(nameEl.getAttribute("username")),
			portrait:
				stripPortraitQuery(author.portrait) ||
				portraitFromHref(nameEl.getAttribute("href")) ||
				"",
			nickname: cleanText(nameEl),
		},
		nameEl,
	);
}

/** 旧版：楼中楼 @ 用户名 */
export function processOldLzlAuthor(atEl: Element, mount: MountFn): void {
	const item = atEl.closest(".lzl_item, li[data-field]");
	const itemData = parseDataField(item);
	const author = (itemData?.author ?? itemData?.user ?? {}) as DataField;

	mount(
		{
			userId: author.user_id ?? null,
			un:
				decodeUserName(author.user_name) ||
				decodeUserName(atEl.getAttribute("username")) ||
				decodeUserName(parseDataField(atEl)?.un),
			portrait:
				stripPortraitQuery(author.portrait) ||
				portraitFromHref(atEl.getAttribute("href")) ||
				"",
			nickname: cleanText(atEl),
		},
		atEl,
	);
}

/** 新版：head-line 用户信息行（楼层、回复、主页帖子列表） */
export function processNewHeadline(headline: Element, mount: MountFn): void {
	const link =
		headline.querySelector('a.name-info-link[href*="home/main?id="]') ??
		headline.querySelector('a[href*="home/main?id="]');
	if (!link) return;
	const nameEl = headline.querySelector(".head-name") ?? link;
	const wrapper = headline.querySelector(".btn-wrapper") ?? headline;

	mount(
		{
			userId: null,
			un: "",
			portrait: portraitFromHref(link.getAttribute("href")) ?? "",
			nickname: cleanText(nameEl),
		},
		nameEl,
		wrapper,
	);
}
