/**
 * 活跃度判定：「等级高、近期又几乎不发言」的吧（俗称签到号）。
 *
 * 纯逻辑：只吃"已经取到的发帖行"和"关注的吧"，不碰 DOM、不发请求，
 * 离线可测（scripts/keyword-test.mjs）。
 *
 * 说明为什么只能这么说：发帖 feed 只给最近的一页（主题帖 60 条 + 回复 60 条），
 * 所以"某吧 0 条"只能说明**最近这批帖子里没有**，不能断言"他从来不发言"。
 * 界面上的措辞必须带上这层限定。
 */

/**
 * 吧名没解析出来的行都归到这一档。

 * **不能静默丢掉**：回复 feed 本身不返回吧名（要按 forumId 反查），反查失败时
 * 那一行的 forumName 就是空串。早先统计时把空吧名直接跳过，于是"回复一条都统计不到"，
 * 饼图看起来就只剩主题帖的数据（用户 2026-09-27 报的"有时只统计了发帖的数据"）。
 * 归到「未知贴吧」至少能看出"有这些条数、只是没认出是哪个吧"。
 */
export const UNKNOWN_FORUM = "未知贴吧";

/** 按吧名统计发言条数；吧名为空的行计入「未知贴吧」。 */
export function countPostsByForum(
	rows: Array<{ forumName: string }>,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const row of rows) {
		const name = String(row.forumName ?? "").trim() || UNKNOWN_FORUM;
		out[name] = (out[name] ?? 0) + 1;
	}
	return out;
}

export interface SignInCandidate {
	forumName: string;
	level: number;
	/** 最近这一页发帖里，他在该吧的发言条数（通常是 0） */
	posts: number;
}

/**
 * 找出「疑似只签到」的吧：吧内等级 ≥ 阈值，但最近这批帖子里在该吧没有发言。
 *
 * 只对**有等级**的吧判定——拿不到等级的（见 userForums.ts 的两种情况）本来就是未知，
 * 不能算成"等级高"。
 */
export function findSignInForums(
	forums: Array<{ name: string; level?: number }>,
	byForum: Record<string, number>,
	levelThreshold: number,
): SignInCandidate[] {
	const threshold = Number.isFinite(levelThreshold) ? levelThreshold : 6;
	const out: SignInCandidate[] = [];
	for (const forum of forums) {
		const level = Number(forum.level ?? 0);
		if (!(level >= threshold)) continue;
		const posts = Number(byForum[forum.name] ?? 0);
		if (posts > 0) continue;
		out.push({ forumName: forum.name, level, posts });
	}
	return out.sort((a, b) => b.level - a.level);
}

/**
 * 界面上的措辞：必须**同时**说清"多高等级"与"样本只有最近这一页"，
 * 否则用户会把它当成"这个人从来不发言"的结论。
 */
export function signInSummary(
	candidates: SignInCandidate[],
	levelThreshold: number,
	sample: { topics: number; replies: number },
): string {
	const sampleText = `样本：最近一页发帖（主题帖 ${sample.topics} 条 + 回复 ${sample.replies} 条）`;
	if (!candidates.length) {
		// 没有候选时也要把"按什么条件判的、样本多大"说清楚，否则这句话读起来像个无法验证的结论
		return (
			`没有发现「等级 ≥ ${levelThreshold} 但最近没在该吧发言」的吧。` +
			`判定条件：吧内等级 ≥ ${levelThreshold}，且最近这批帖子里在该吧 0 条发言。${sampleText}。`
		);
	}
	const names = candidates
		.slice(0, 5)
		.map((item) => `${item.forumName}(Lv.${item.level})`)
		.join("、");
	return (
		`疑似只签到 ${candidates.length} 个吧：${names}${candidates.length > 5 ? " 等" : ""}。` +
		`判定条件：吧内等级 ≥ ${levelThreshold}，且最近这批帖子里在该吧 0 条发言。` +
		`${sampleText}——所以也可能是"以前发言多、最近没来"，请结合其它信息判断。`
	);
}
