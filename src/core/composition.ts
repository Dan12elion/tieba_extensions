/**
 * 「成分」关键词规则：把参考脚本（B站成分检测器）的做法搬到贴吧。
 *
 * 规则一行一条，用 `|` 分成最多 5 段：
 *
 *     名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单
 *
 * 后三段可以省略；关键词用逗号分隔（中英文逗号都行）；`#` 开头是注释行。
 * 判定方式与参考脚本一致，是「包含」（大小写不敏感）：
 *   - 发帖关键词打在「标题 + 正文摘要」上
 *   - 吧关键词打在该用户关注的吧名上
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
	/** 排除关键词：命中则这条证据不算数 */
	excludes: string[];
	/** 直接命中名单：贴吧号或内部用户 ID */
	uids: string[];
}

/** 关键词分隔符：只用逗号，不用空格——参考脚本里有「互动抽奖 #原神」这种带空格的词。 */
const LIST_SEPARATOR = /[,，;；]+/;

export const RULE_FORMAT_HINT =
	"每行一条：名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省)；关键词用逗号分隔，`#` 开头是注释。";

export const EXAMPLE_RULES = [
	"# 每行一条规则，示例如下（可以直接改成你要的词）",
	"# 名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省)",
	"🎮原神 | 原神,芙宁娜,米哈游 | 原神吧,米哈游吧 | 原神怎么你了",
	"🎁抽奖 | 互动抽奖,转发本条动态 | 抽奖吧",
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

/**
 * 解析规则文本。
 *
 * 容错策略：空行 / 注释行 / 只有名称没有条件的行直接忽略；同名规则只保留第一条。
 * 这样用户从别处粘一份带说明的规则进来，也不会把整张表弄坏。
 */
export function parseRules(text: string): CompositionRule[] {
	const rules: CompositionRule[] = [];
	const seen = new Set<string>();
	for (const rawLine of String(text ?? "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split("|").map((part) => part.trim());
		const name = parts[0];
		if (!name) continue;
		const rule: CompositionRule = {
			name,
			postKeywords: splitList(parts[1]),
			forumKeywords: splitList(parts[2]),
			excludes: splitList(parts[3]),
			uids: splitList(parts[4]),
		};
		if (
			!rule.postKeywords.length &&
			!rule.forumKeywords.length &&
			!rule.uids.length
		) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		rules.push(rule);
	}
	return rules;
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
	source: "uid" | "forum" | "post";
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
