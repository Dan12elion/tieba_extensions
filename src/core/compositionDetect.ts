/**
 * 「成分」检测的取数与匹配编排。
 *
 * 检测一个用户需要看两处数据，分别对应规则里的两类关键词：
 *   - 关注的吧  → getLikeForum（隐藏时回退 getHiddenLikeForum）
 *   - 发帖      → 主题帖 feed + 回复 feed，各取第 1 页（每页 60 条）
 *
 * 只有"规则里真的用到了某类关键词"才会去取对应数据：
 * 规则表里如果只写了名单（直接命中名单），这里一个请求都不会发。
 */

import {
	type CompositionHit,
	type CompositionPostInput,
	type CompositionRule,
	matchComposition,
} from "./composition.ts";
import { loadUserForums } from "./userForums.ts";
import { loadReplyRows, loadTopicRows } from "./userPost.ts";
import { errorMessage } from "./util.ts";

export interface CompositionScanStat {
	/** 读到的关注吧数量 */
	forums: number;
	/** 其中有多少个是从 profile / 隐藏通道恢复出来的（不在主接口列表里） */
	forumsRecovered: number;
	/** 读到的主题帖条数 */
	topics: number;
	/** 读到的回复条数 */
	replies: number;
	/** 某个数据源失败时的说明；局部失败不影响其余部分 */
	failed: string[];
}

export interface CompositionDetection {
	hits: CompositionHit[];
	stat: CompositionScanStat;
}

export interface CompositionTarget {
	id: number;
	uid?: string | null;
	/** profile 里带着的关注贴吧名单：隐藏关注贴吧时的恢复与补齐都靠它 */
	profileForums?: string[];
}

/** 检测一个用户，返回命中的规则与本次扫描的统计。 */
export async function detectComposition(
	target: CompositionTarget,
	rules: CompositionRule[],
): Promise<CompositionDetection> {
	const stat: CompositionScanStat = {
		forums: 0,
		forumsRecovered: 0,
		topics: 0,
		replies: 0,
		failed: [],
	};
	const posts: CompositionPostInput[] = [];
	let forums: string[] = [];

	if (rules.some((rule) => rule.forumKeywords.length)) {
		try {
			const loaded = await loadUserForums(
				target.id,
				target.profileForums ?? [],
			);
			forums = loaded.forums.map((forum) => forum.name);
			stat.forums = forums.length;
			stat.forumsRecovered = loaded.recovered;
		} catch (error) {
			stat.failed.push(`关注的吧：${errorMessage(error)}`);
		}
	}

	if (rules.some((rule) => rule.postKeywords.length)) {
		try {
			const rows = await loadTopicRows(target.id, 1);
			stat.topics = rows.length;
			for (const row of rows) {
				posts.push({ title: row.title, preview: row.preview, kind: "topic" });
			}
		} catch (error) {
			stat.failed.push(`主题帖：${errorMessage(error)}`);
		}
		try {
			const rows = await loadReplyRows(target.id, 1);
			stat.replies = rows.length;
			for (const row of rows) {
				posts.push({
					title: row.title,
					preview: row.preview,
					kind: row.kind === "sub" ? "sub" : "reply",
				});
			}
		} catch (error) {
			stat.failed.push(`回复：${errorMessage(error)}`);
		}
	}

	return {
		hits: matchComposition(
			{ uid: target.uid, userId: target.id, forums, posts },
			rules,
		),
		stat,
	};
}
