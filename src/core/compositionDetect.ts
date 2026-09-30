/**
 * 「成分」检测的取数与匹配编排。
 *
 * 检测一个用户需要看两处数据，分别对应规则里的两类关键词：
 *   - 关注的吧  → getLikeForum（隐藏时回退 getHiddenLikeForum）
 *   - 发帖      → 主题帖 feed + 回复 feed，各取前 N 页（每页 60 条，N 见设置里的
 *                 `compositionPages`，默认 1）
 *
 * 只有"规则里真的用到了某类关键词"才会去取对应数据：
 * 规则表里如果只写了名单（直接命中名单），这里一个请求都不会发。
 *
 * 1.9.0 起还把「没有命中」与「数据没拿到」分开：返回的 stat 里带上
 * `hidden` / `pages` / `insufficient`，界面据此给出「证据不足」而不是装作没事
 * （判据是纯函数 `compositionVerdict()`，在 core/composition.ts 里）。
 */

import {
	type CompositionHit,
	type CompositionPostInput,
	type CompositionRule,
	type CompositionVerdict,
	compositionVerdict,
	matchComposition,
} from "./composition.ts";
import { loadUserForums } from "./userForums.ts";
import { loadReplyPage, loadTopicPage } from "./userPost.ts";
import { describeRequestError } from "./errno.ts";

export interface CompositionScanStat {
	/** 读到的关注吧数量 */
	forums: number;
	/** 其中有多少个是从 profile / 隐藏通道恢复出来的（不在主接口列表里） */
	forumsRecovered: number;
	/** 读到的主题帖条数 */
	topics: number;
	/** 读到的回复条数（含楼中楼） */
	replies: number;
	/** 主题帖实际翻了几页 */
	topicPages: number;
	/** 回复实际翻了几页 */
	replyPages: number;
	/** 对方把发帖记录设为私密（两路 feed 任一返回 hidePost=1） */
	hidden: boolean;
	/** 某个数据源失败时的说明；局部失败不影响其余部分 */
	failed: string[];
	/** 「没有命中」还是「证据不足」——由 `compositionVerdict()` 判定 */
	verdict: CompositionVerdict;
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

export interface CompositionDetectOptions {
	/** 两路 feed 各翻几页（默认 1；设置里可改，代价是每个用户多 N-1 个请求） */
	pages?: number;
}

/** 一页最多 60 条；返回 0 条就说明没有下一页了（HANDOFF §4.3） */
function normalizePages(value: unknown): number {
	const num = Number(value);
	if (!Number.isFinite(num) || num < 1) return 1;
	return Math.min(Math.floor(num), 10);
}

/** 检测一个用户，返回命中的规则与本次扫描的统计。 */
export async function detectComposition(
	target: CompositionTarget,
	rules: CompositionRule[],
	options: CompositionDetectOptions = {},
): Promise<CompositionDetection> {
	const pages = normalizePages(options.pages ?? 1);
	const stat: CompositionScanStat = {
		forums: 0,
		forumsRecovered: 0,
		topics: 0,
		replies: 0,
		topicPages: 0,
		replyPages: 0,
		hidden: false,
		failed: [],
		verdict: { insufficient: false, note: "" },
	};
	const posts: CompositionPostInput[] = [];
	let forums: string[] = [];

	const needForums = rules.some((rule) => rule.forumKeywords.length);
	// 「发帖关键词」与「发帖所在吧关键词」都吃发帖 feed，所以两者只要有一个配了就得取；
	// 只配了名单的规则一个请求都不会发。
	const needPosts = rules.some(
		(rule) => rule.postKeywords.length || rule.postForumKeywords.length,
	);

	if (needForums) {
		try {
			const loaded = await loadUserForums(
				target.id,
				target.profileForums ?? [],
			);
			forums = loaded.forums.map((forum) => forum.name);
			stat.forums = forums.length;
			stat.forumsRecovered = loaded.recovered;
		} catch (error) {
			stat.failed.push(`关注的吧：${describeRequestError(error, "成分·关注的吧")}`);
		}
	}

	if (needPosts) {
		for (let page = 1; page <= pages; page += 1) {
			try {
				const result = await loadTopicPage(target.id, page);
				stat.topicPages = page;
				stat.topics += result.rows.length;
				stat.hidden = stat.hidden || result.hidden;
				for (const row of result.rows) {
					posts.push({
						title: row.title,
						preview: row.preview,
						kind: "topic",
						forumName: row.forumName,
					});
				}
				// 这一页是空的 ⇒ 没有下一页了，别再白花请求
				if (!result.rows.length) break;
			} catch (error) {
				stat.failed.push(`主题帖：${describeRequestError(error, "成分·主题帖")}`);
				break;
			}
		}
		for (let page = 1; page <= pages; page += 1) {
			try {
				const result = await loadReplyPage(target.id, page);
				stat.replyPages = page;
				stat.replies += result.rows.length;
				stat.hidden = stat.hidden || result.hidden;
				for (const row of result.rows) {
					posts.push({
						title: row.title,
						preview: row.preview,
						kind: row.kind === "sub" ? "sub" : "reply",
						forumName: row.forumName,
					});
				}
				if (!result.rows.length) break;
			} catch (error) {
				stat.failed.push(`回复：${describeRequestError(error, "成分·回复")}`);
				break;
			}
		}
	}

	const hits = matchComposition(
		{ uid: target.uid, userId: target.id, forums, posts },
		rules,
	);
	stat.verdict = compositionVerdict({
		hits: hits.length,
		failed: stat.failed,
		hidden: stat.hidden,
		needForums,
		needPosts,
		forums: stat.forums,
		posts: stat.topics + stat.replies,
	});

	return { hits, stat };
}
