/**
 * 「关注的吧」取数。
 *
 * 正常情况下用 getLikeForum（/c/f/forum/like），它带 level_id；
 * 用户隐藏关注贴吧时该接口返回空，退回 getHiddenLikeForum：
 * panel.honor.grade 是一个 { 吧内等级: { forum_list: [吧名] } } 的结构，
 * **键就是等级**，必须按组取出，否则等级会全部丢失。
 *
 * 从 features/userPanel.ts 抽出来，因为后台成分检测也要看关注的吧。
 *
 * 三个来源，按代价从小到大：
 *   1. profile 里本来就带着的 likeForum（调用方从资料缓存里传进来，**零请求**）
 *   2. getLikeForum：完整列表，但隐藏关注贴吧的用户这里是空的
 *   3. getHiddenLikeForum：profile + panel 的等级分组，恢复出部分吧名
 * 现在的做法是 1 与 2 合并（隐藏的人经常是"接口给一半、profile 里还有一部分"），
 * 只有当 2 拿不到东西（空或者报错）时才去请求 3。
 */

import { getHiddenLikeForum, getLikeForum } from "tieba.js";
import { callSdkLoose } from "./identity.ts";
import { toNumber } from "./util.ts";

export interface ForumRow {
	/** 吧名，用于拼接链接 */
	name: string;
	/** 展示名 */
	display: string;
	/** 该用户在此吧的吧内等级 */
	level?: number;
	/** 等级称号，例如「初级粉丝」 */
	levelName?: string;
	/** 吧简介 */
	slogan?: string;
}

export interface UserForums {
	forums: ForumRow[];
	/** 是否走了「隐藏关注贴吧」的回退通道 */
	hidden: boolean;
	/** 从隐藏通道 / profile 里额外恢复出来的吧数量（0 表示列表完全来自 getLikeForum） */
	recovered: number;
}

export const HIDDEN_FORUMS_NOTE =
	"该用户的关注贴吧没有完整公开。下面这份列表里混入了从用户资料 / 用户面板恢复出来的部分，可能仍然不完整；标了等级的表示这是他在该吧的吧内等级，没标的是资料里只给了吧名。";

/**
 * 为什么有些吧拿不到等级——两个原因，界面上要说清楚，否则看着像 bug。
 *
 * 原因一：**这个用户没有用户名**。贴吧的等级数据（`/home/get/panel` 的 honor.grade）
 * 只能按"用户名"查询；页面上显示成「贴吧用户_XXXX」这类系统昵称的用户压根没有用户名，
 * 于是查不到任何吧内等级（贴吧号、内部 ID、portrait 都试过，同样查不到）。
 * 原因二：即使有用户名，panel 也只列出**一部分**吧；剩下那些只能从资料接口里拿到吧名，
 * 而资料接口的 likeForum 字段本身就只给吧名、不给等级。
 */
export const NO_USERNAME_NOTE =
	"注意：该用户没有设置用户名（页面上显示为「贴吧用户_xxxx」这类系统昵称）。贴吧的等级数据只能按用户名查询，所以这个用户的所有吧内等级都查不到——这是贴吧数据源的限制，不是脚本出错。";

export const NO_LEVEL_NOTE =
	"没有等级的项来自用户资料里的吧名：贴吧只给了吧名，没有给该吧的等级。";

export async function loadUserForums(
	id: number,
	/** profile 里的关注贴吧名单（identity.profile.likeForum），用来补齐接口没给全的部分 */
	profileForums: string[] = [],
): Promise<UserForums> {
	let items: ForumRow[] = [];
	let primaryFailed = false;
	try {
		const forums: any[] = await callSdkLoose(() => getLikeForum(id));
		items = (Array.isArray(forums) ? forums : []).map((forum) => ({
			name: forum.name,
			display: forum.name_show || forum.name,
			level: toNumber(forum.level_id) || undefined,
			levelName: forum.level_name || undefined,
			slogan: forum.slogan || undefined,
		}));
	} catch {
		// 隐藏关注贴吧 / 接口抽风都可能让这里抛错，抛错不等于"没有关注的吧"
		primaryFailed = true;
	}

	if (!items.length) {
		// 主接口空或失败：完整走一遍恢复通道（含 panel 的等级分组）
		const hidden: any = await callSdkLoose(() => getHiddenLikeForum(id));
		// grade 的键是吧内等级，按组展开才能保留等级
		const graded: ForumRow[] = Object.entries<any>(
			hidden?.grade ?? {},
		).flatMap(([level, group]) =>
			(group?.forum_list ?? []).map((name: string) => ({
				name,
				display: name,
				level: toNumber(level) || undefined,
			})),
		);
		const recovered = mergeForums(graded, hidden?.plain ?? [], profileForums);
		return {
			forums: recovered,
			hidden: true,
			recovered: recovered.length,
		};
	}

	// 主接口给了列表：把 profile 里有、它没列出来的补上（不需要额外请求）
	const merged = mergeForums(items, [], profileForums);
	return {
		forums: merged,
		hidden: merged.length > items.length,
		recovered: merged.length - items.length,
	};
}

/** 合并三份吧名（保持顺序、按名字去重）。 */
function mergeForums(
	base: ForumRow[],
	extraNames: string[],
	profileNames: string[],
): ForumRow[] {
	const seen = new Set(base.map((item) => item.name));
	const out = [...base];
	for (const name of [...extraNames, ...profileNames]) {
		const clean = String(name ?? "").trim();
		if (!clean || seen.has(clean)) continue;
		seen.add(clean);
		out.push({ name: clean, display: clean });
	}
	return out;
}
