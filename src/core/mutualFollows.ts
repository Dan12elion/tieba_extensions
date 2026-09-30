/**
 * 「共同关注」的纯逻辑：把两份关注列表求交集，并把结论写成一句话。
 *
 * 为什么单独一个模块：这部分不碰网络、不碰 DOM，可以离线钉死（keyword-test 里跑）。
 * 取数（两边各翻几页）在 features/panel/mutual.ts 里做。
 *
 * 一个必须写清楚的限制：**两边都只读前 N 页**（每页 20 人，页数上限来自设置里的
 * 「单个列表最多加载页数」，默认先只读 3 页）。所以结论只能说"在已读到的范围内
 * 有 N 个共同关注"，不能说"一共就 N 个"——措辞由 `buildMutualSummary()` 统一产出。
 */

export interface FollowUser {
	id?: string | number;
	name?: string;
	name_show?: string;
	portrait?: string;
}

/**
 * 认一个人的键。
 *
 * 优先用数字 id（最可靠）；没有 id 时退回 portrait（同一个人的 portrait 是稳定的）；
 * 再没有就只能用名字——同名不同人的情况存在，所以这种情况在结论里会标注"按名字比对"。
 */
export function followKey(user: FollowUser | null | undefined): string {
	if (!user) return "";
	if (user.id !== undefined && user.id !== null && String(user.id)) {
		return `id:${String(user.id)}`;
	}
	const portrait = String(user.portrait ?? "").split("?")[0];
	if (portrait) return `portrait:${portrait}`;
	const name = String(user.name ?? user.name_show ?? "").trim();
	return name ? `name:${name}` : "";
}

export interface MutualFollowResult {
	/** 交集（按"对方"列表里的顺序，也就是对方关注的时间倒序） */
	common: FollowUser[];
	/** 有多少人是靠名字（而不是 id / portrait）比上的——这种可能有同名误差 */
	byName: number;
}

/** 求交集：以"对方"的顺序为准，方便对照对方的关注列表。 */
export function intersectFollows(
	mine: FollowUser[],
	theirs: FollowUser[],
): MutualFollowResult {
	const myKeys = new Set<string>();
	for (const user of mine) {
		const key = followKey(user);
		if (key) myKeys.add(key);
	}
	const common: FollowUser[] = [];
	const seen = new Set<string>();
	let byName = 0;
	for (const user of theirs) {
		const key = followKey(user);
		if (!key || !myKeys.has(key) || seen.has(key)) continue;
		seen.add(key);
		if (key.startsWith("name:")) byName += 1;
		common.push(user);
	}
	return { common, byName };
}

export interface MutualSummaryInput {
	/** 交集里的人数 */
	common: number;
	/** 靠名字比上的人数（可能有同名误差） */
	byName?: number;
	/** 我这边的列表读到了多少人 / 几页 */
	mineRead: number;
	minePages: number;
	/** 对方那边读到了多少人 / 几页 */
	theirsRead: number;
	theirsPages: number;
	/** 某一边是"到了页数上限才停"的（还可能有关注的人没读到） */
	capped?: boolean;
	/** 我这边的标签（默认「我」） */
	mineLabel?: string;
}

/**
 * 结论一句话。
 *
 * 关键在于**把样本说清楚**：只读了几页就必须写出来，否则"共同关注 2 人"会被读成
 * "你们俩一共只有 2 个共同关注"（同类教训见 §7 的签到号结论）。
 */
export function buildMutualSummary(input: MutualSummaryInput): string {
	const mineLabel = input.mineLabel ?? "我";
	const parts = [
		`共同关注 ${input.common} 人`,
		`${mineLabel}这边读了 ${input.mineRead} 人（${input.minePages} 页）`,
		`对方读了 ${input.theirsRead} 人（${input.theirsPages} 页）`,
	];
	if (input.byName) {
		parts.push(`其中 ${input.byName} 个是按用户名比上的（可能有同名）`);
	}
	if (input.capped) {
		parts.push("已到这边的页数上限，可能还有没比对到的");
	}
	return parts.join(" · ");
}
