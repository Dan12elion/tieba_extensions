/**
 * 「成分」关键词规则：把参考脚本（B站成分检测器）的做法搬到贴吧。
 *
 * 规则一行一条，用 `|` 分成最多 6 段：
 *
 *     名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单 | 发帖所在吧关键词
 *
 * 后四段可以省略；关键词用逗号分隔（中英文逗号都行）；`#` 开头是注释行。
 * 判定方式与参考脚本一致，是「包含」（大小写不敏感）：
 *   - 发帖关键词打在「标题 + 正文摘要」上
 *   - 吧关键词打在该用户关注的吧名上
 *   - 发帖所在吧关键词打在「他发过帖的吧名」上（注意与上一段相反：一段看他关注了什么，
 *     这一段看他**实际在哪儿发言**）——新增字段放在最后一段，就是为了不动老规则的列序
 *   - 排除关键词命中就整条跳过（对应参考脚本的 keywordsReverse，用来压住玩梗误伤）
 *
 * 证据强度（sure）也照参考脚本分档：名单 / 关注的吧 / **主题帖**是强证据，
 * 回复与楼中楼只是弱证据——回复里出现某个词很可能只是在讨论或玩梗，界面上会标"可能是误判"。
 *
 * 本文件只放纯逻辑：不碰 DOM、不发请求，Node 里可以直接测（scripts/keyword-test.mjs）。
 */

import { escapeHtml } from "./util.ts";

export interface CompositionRule {
	/** 规则名，也是页面上徽章上显示的文字（可以带 emoji） */
	name: string;
	/** 发帖关键词 */
	postKeywords: string[];
	/** 关注的吧关键词 */
	forumKeywords: string[];
	/**
	 * 发帖所在吧的关键词：他**实际发过言**的吧。
	 *
	 * 与 forumKeywords 的区别：forumKeywords 看的是"关注了什么吧"（关注是主动行为，
	 * 但很多人关注了并不说话），这一段看的是"他确实在这个吧发过帖"。
	 * 规则文本里这是第 6 段，放在最后是为了不改动老规则（5 段）的列序。
	 */
	postForumKeywords: string[];
	/** 排除关键词：命中则这条证据不算数 */
	excludes: string[];
	/** 直接命中名单：贴吧号或内部用户 ID */
	uids: string[];
}

/** 关键词分隔符：只用逗号，不用空格——参考脚本里有「互动抽奖 #原神」这种带空格的词。 */
const LIST_SEPARATOR = /[,，;；]+/;

export const RULE_FORMAT_HINT =
	"每行一条：名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省) | 发帖所在吧关键词(可省)；关键词用逗号分隔，`#` 开头是注释。";

export const EXAMPLE_RULES = [
	"# 每行一条规则，示例如下（可以直接改成你要的词）",
	"# 名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省) | 发帖所在吧关键词(可省)",
	"🎮原神 | 原神,芙宁娜,米哈游 | 原神吧,米哈游吧 | 原神怎么你了",
	"🎁抽奖 | 互动抽奖,转发本条动态 | 抽奖吧",
	"# 最后一段看的是他实际在哪个吧发过言，与关注了哪个吧是两回事",
	"🛒带货 | | | | | 拼多多,淘宝",
	"⚠️示例名单 | | | | 1234567890",
].join("\n");

function splitList(value: string | undefined): string[] {
	if (!value) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value.split(LIST_SEPARATOR)) {
		const token = item.trim();
		if (!token) continue;
		const key = token.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(token);
	}
	return out;
}

/** 规则文本里的问题（解析时收集，设置面板按行号展示） */
export interface RuleIssue {
	/** 行号，从 1 开始（用户在设置面板里看到的行号） */
	line: number;
	/** 原始那一行（截断到 60 字，只用于展示） */
	text: string;
	level: "error" | "warn";
	message: string;
}

export interface ParsedRules {
	rules: CompositionRule[];
	issues: RuleIssue[];
}

/**
 * 解析规则文本，并**逐行收集问题**。
 *
 * 为什么要收集而不是默默忽略：解析本身是容错的（注释、空行、缺条件的行都会被跳过），
 * 但用户看到的是"规则写了却没生效"。以前唯一的反馈是"没命中"，
 * 现在设置面板能直接说"第 7 行只有名称没有条件，被忽略了"（IMPROVEMENTS §5 的规则生态）。
 */
export function parseRulesDetailed(text: string): ParsedRules {
	const rules: CompositionRule[] = [];
	const issues: RuleIssue[] = [];
	const seen = new Map<string, number>();
	const lines = String(text ?? "").split(/\r?\n/);

	lines.forEach((rawLine, index) => {
		const lineNumber = index + 1;
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) return;
		const brief = line.length > 60 ? `${line.slice(0, 60)}…` : line;
		const parts = line.split("|").map((part) => part.trim());
		const name = parts[0];
		if (!name) {
			issues.push({
				line: lineNumber,
				text: brief,
				level: "error",
				message: "这一行没有名称（`|` 前面是空的），整行被忽略。",
			});
			return;
		}
		if (parts.length > 6) {
			issues.push({
				line: lineNumber,
				text: brief,
				level: "warn",
				message: `这一行有 ${parts.length} 段，第 7 段起会被忽略（格式只有 6 段）。`,
			});
		}

		const rule: CompositionRule = {
			name,
			postKeywords: splitList(parts[1]),
			forumKeywords: splitList(parts[2]),
			excludes: splitList(parts[3]),
			uids: splitList(parts[4]),
			postForumKeywords: splitList(parts[5]),
		};

		// 关键词里带空格：不按空格切分是**故意**的，但用户常常是想写两个词
		for (const [field, values] of [
			["发帖关键词", rule.postKeywords],
			["关注的吧关键词", rule.forumKeywords],
			["排除关键词", rule.excludes],
			["发帖所在吧关键词", rule.postForumKeywords],
		] as const) {
			const spaced = values.find((value) => /\s/.test(value));
			if (spaced) {
				issues.push({
					line: lineNumber,
					text: brief,
					level: "warn",
					message: `${field}里的「${spaced}」带空格。脚本**不按空格切分**关键词，它会被当成一个整词；如果那是两个词，请用逗号分开。`,
				});
			}
		}

		const overlap = rule.postKeywords.filter((keyword) =>
			rule.excludes.some((item) => item.toLowerCase() === keyword.toLowerCase()),
		);
		if (overlap.length) {
			issues.push({
				line: lineNumber,
				text: brief,
				level: "warn",
				message: `「${overlap.join("、")}」同时出现在发帖关键词与排除关键词里，这条证据永远会被自己否决。`,
			});
		}

		if (
			!rule.postKeywords.length &&
			!rule.forumKeywords.length &&
			!rule.postForumKeywords.length &&
			!rule.uids.length
		) {
			issues.push({
				line: lineNumber,
				text: brief,
				level: "warn",
				message: "这一行只有名称，没有任何条件，被忽略了（至少要有发帖关键词 / 关注的吧 / 名单 / 发帖所在吧 之一）。",
			});
			return;
		}

		const key = name.toLowerCase();
		const firstLine = seen.get(key);
		if (firstLine !== undefined) {
			issues.push({
				line: lineNumber,
				text: brief,
				level: "warn",
				message: `与第 ${firstLine} 行的规则同名，只保留第一条。`,
			});
			return;
		}
		seen.set(key, lineNumber);
		rules.push(rule);
	});

	return { rules, issues };
}

/**
 * 解析规则文本。
 *
 * 容错策略：空行 / 注释行 / 只有名称没有条件的行直接忽略；同名规则只保留第一条。
 * 这样用户从别处粘一份带说明的规则进来，也不会把整张表弄坏。
 * 需要"告诉用户哪一行有问题"时用 `parseRulesDetailed()`。
 */
export function parseRules(text: string): CompositionRule[] {
	return parseRulesDetailed(text).rules;
}

/** 规则内容的指纹：用来判断缓存是不是上一版规则的产物。 */
export function hashRules(text: string): string {
	const normalized = JSON.stringify(parseRules(text));
	let hash = 5381;
	for (let index = 0; index < normalized.length; index += 1) {
		hash = ((hash << 5) + hash + normalized.charCodeAt(index)) | 0;
	}
	return (hash >>> 0).toString(36);
}

const POST_KIND_TEXT = {
	topic: "主题帖",
	reply: "回复",
	sub: "楼中楼",
} as const;

export type CompositionPostKind = keyof typeof POST_KIND_TEXT;

export interface CompositionPostInput {
	title: string;
	preview: string;
	kind: CompositionPostKind;
	/** 这条帖子发在哪个吧（「发帖所在吧」那一类关键词打在它上面） */
	forumName?: string;
}

export interface CompositionInput {
	uid?: string | null;
	userId?: number | null;
	/** 该用户关注的吧名 */
	forums: string[];
	/** 该用户的主题帖与回复（标题 + 正文摘要） */
	posts: CompositionPostInput[];
}

export interface CompositionEvidence {
	source: "uid" | "forum" | "postForum" | "post";
	/** 命中的关键词 */
	keyword: string;
	/** 人类可读的原因，例如「关注了「原神吧」」 */
	reason: string;
	/** 命中的内容片段（只有发帖证据有） */
	excerpt: string;
	/** 是否强证据 */
	sure: boolean;
}

export interface CompositionHit {
	rule: CompositionRule;
	evidences: CompositionEvidence[];
	/** 有任何一条强证据 */
	sure: boolean;
	/** 一句话总结，例如「关注了「原神吧」；主题帖命中「原神」」 */
	summary: string;
}

function contains(text: string, keyword: string): boolean {
	return text.toLowerCase().includes(keyword.toLowerCase());
}

function firstKeyword(text: string, keywords: string[]): string {
	for (const keyword of keywords) {
		if (contains(text, keyword)) return keyword;
	}
	return "";
}

function isExcluded(text: string, excludes: string[]): boolean {
	return excludes.some((word) => contains(text, word));
}

/** 截取命中位置前后的一段，方便在面板里看清楚是哪儿命中的。 */
export function excerptAround(
	text: string,
	keyword: string,
	width = 40,
): string {
	const source = String(text ?? "").replace(/\s+/g, " ").trim();
	if (!source) return "";
	const index = source.toLowerCase().indexOf(keyword.toLowerCase());
	if (index < 0) return source.slice(0, width * 2);
	const start = Math.max(0, index - width);
	const end = Math.min(source.length, index + keyword.length + width);
	return (
		(start > 0 ? "…" : "") +
		source.slice(start, end) +
		(end < source.length ? "…" : "")
	);
}

/**
 * 按规则匹配一个用户，返回命中的规则（顺序与规则表一致）。
 *
 * 每条规则最多产出一条 hit，但可以带多条证据：一个用户既关注了「原神吧」、
 * 又发过带「原神」的主题帖，就会把两条原因都写进去，而不是变成两个重复徽章。
 */
export function matchComposition(
	input: CompositionInput,
	rules: CompositionRule[],
): CompositionHit[] {
	const hits: CompositionHit[] = [];
	const ids = [input.uid, input.userId ? String(input.userId) : ""]
		.map((value) => String(value ?? "").trim())
		.filter(Boolean);

	for (const rule of rules) {
		const evidences: CompositionEvidence[] = [];

		// 1) 直接命中名单：不需要任何请求
		const matchedUid = rule.uids.find((uid) => ids.includes(uid.trim()));
		if (matchedUid) {
			evidences.push({
				source: "uid",
				keyword: matchedUid,
				reason: "在名单里",
				excerpt: "",
				sure: true,
			});
		}

		// 2) 关注的吧（关注是主动行为，算强证据）
		for (const forum of input.forums) {
			if (isExcluded(forum, rule.excludes)) continue;
			const keyword = firstKeyword(forum, rule.forumKeywords);
			if (!keyword) continue;
			evidences.push({
				source: "forum",
				keyword,
				reason: `关注了「${forum}」`,
				excerpt: "",
				sure: true,
			});
			break;
		}

		// 3) 发帖：主题帖算强证据，回复 / 楼中楼只算弱证据
		//    3a) 先看"发帖所在吧"：他确实在这个吧发过言
		let postForumEvidence: CompositionEvidence | null = null;
		for (const post of input.posts) {
			const name = String(post.forumName ?? "").trim();
			if (!name || isExcluded(name, rule.excludes)) continue;
			const keyword = firstKeyword(name, rule.postForumKeywords);
			if (!keyword) continue;
			const evidence: CompositionEvidence = {
				source: "postForum",
				keyword,
				reason: `在「${name}」发过帖`,
				excerpt: [post.title, post.preview]
					.filter(Boolean)
					.join(" ")
					.slice(0, 60),
				sure: post.kind === "topic",
			};
			postForumEvidence = evidence;
			if (evidence.sure) break;
		}
		if (postForumEvidence) evidences.push(postForumEvidence);

		//    3b) 再看发帖内容关键词
		let postEvidence: CompositionEvidence | null = null;
		for (const post of input.posts) {
			const text = [post.title, post.preview].filter(Boolean).join(" ");
			if (!text || isExcluded(text, rule.excludes)) continue;
			const keyword = firstKeyword(text, rule.postKeywords);
			if (!keyword) continue;
			const evidence: CompositionEvidence = {
				source: "post",
				keyword,
				reason: `${POST_KIND_TEXT[post.kind]}命中`,
				excerpt: excerptAround(text, keyword),
				sure: post.kind === "topic",
			};
			postEvidence = evidence;
			if (evidence.sure) break;
		}
		if (postEvidence) evidences.push(postEvidence);

		if (!evidences.length) continue;
		hits.push({
			rule,
			evidences,
			sure: evidences.some((evidence) => evidence.sure),
			summary: evidences
				.map((evidence) =>
					evidence.source === "post"
						? `${evidence.reason}「${evidence.keyword}」`
						: evidence.reason,
				)
				.join("；"),
		});
	}

	return hits;
}

/**
 * 「这次到底是没有命中，还是数据没拿到」。
 *
 * 起因（HANDOFF §9.2）：对方设了隐私、或者 BDUSS 失效时，取数会失败，
 * 于是页面上**什么标记都没有**——用户会读成「这人很干净」。
 * 这两件事必须分开说，所以把判断抽成纯函数放在这里（离线可测）：
 *   - 有命中 → 那就是命中，不掺"证据不足"；
 *   - 没有命中但**有数据没拿到 / 样本为空 / 对方隐藏了发帖** → 证据不足，
 *     界面上给一个中性标记，并写清缺的是什么；
 *   - 都不是 → 真的没命中（这才可以不挂标记）。
 */
export interface CompositionVerdictInput {
	/** 命中的规则条数 */
	hits: number;
	/** 取数失败的原因（每个数据源一条） */
	failed: string[];
	/** 对方把发帖记录设为私密（hidePost=1） */
	hidden: boolean;
	/** 规则里用到了「关注的吧」 */
	needForums: boolean;
	/** 规则里用到了发帖（发帖关键词 / 发帖所在吧） */
	needPosts: boolean;
	/** 实际读到的吧数 */
	forums: number;
	/** 实际读到的发帖条数（主题帖 + 回复 + 楼中楼） */
	posts: number;
}

export interface CompositionVerdict {
	insufficient: boolean;
	/** 给人看的一句话；insufficient 为 false 时是空串 */
	note: string;
}

export function compositionVerdict(
	input: CompositionVerdictInput,
): CompositionVerdict {
	if (input.hits > 0) return { insufficient: false, note: "" };

	const reasons: string[] = [];
	if (input.failed.length) {
		reasons.push(
			`有 ${input.failed.length} 路数据没取到（${input.failed
				.map((item) => item.split("：")[0])
				.join("、")}）`,
		);
	}
	if (input.hidden) reasons.push("对方把发帖记录设为私密");
	if (
		input.needPosts &&
		!input.hidden &&
		input.failed.length === 0 &&
		input.posts === 0
	) {
		reasons.push("一条发帖记录都没读到");
	}
	if (
		input.needForums &&
		input.failed.length === 0 &&
		input.forums === 0
	) {
		reasons.push("关注贴吧列表是空的（对方可能隐藏了它）");
	}

	if (!reasons.length) return { insufficient: false, note: "" };
	return {
		insufficient: true,
		note: `证据不足：${reasons.join("；")}。这不等于「没有命中」。`,
	};
}

/**
 * 把文本里出现的所有关键词包成 `<mark>`。
 *
 * 先按原始文本算命中区间、再做转义，避免"先转义后匹配"把 `&amp;` 这类实体切坏，
 * 也避免关键词里的正则元字符被当成模式。
 */
export function highlightKeywords(text: string, keywords: string[]): string {
	const source = String(text ?? "");
	const keys = keywords
		.map((keyword) => String(keyword ?? "").trim())
		.filter(Boolean);
	if (!source || !keys.length) return escapeHtml(source);

	const lower = source.toLowerCase();
	const ranges: Array<[number, number]> = [];
	for (const key of keys) {
		const needle = key.toLowerCase();
		let from = lower.indexOf(needle);
		while (from >= 0) {
			ranges.push([from, from + needle.length]);
			from = lower.indexOf(needle, from + needle.length);
		}
	}
	if (!ranges.length) return escapeHtml(source);

	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([range[0], range[1]]);
		}
	}

	let out = "";
	let cursor = 0;
	for (const [start, end] of merged) {
		out += escapeHtml(source.slice(cursor, start));
		out += `<mark class="tb-eztb-mark">${escapeHtml(source.slice(start, end))}</mark>`;
		cursor = end;
	}
	out += escapeHtml(source.slice(cursor));
	return out;
}

/** 徽章配色：同一个规则名永远同一个颜色，方便在不同页面上一眼认出。 */
export function badgeHue(name: string): number {
	let hash = 0;
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) | 0;
	}
	return Math.abs(hash) % 360;
}
