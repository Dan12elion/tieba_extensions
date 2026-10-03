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

/**
 * 关键词的匹配方式。
 *
 * - `contains`（默认）：包含匹配。关键词出现在吧名 / 文本的任意位置就算命中。
 * - `exact`：完全匹配。吧名要**整个相等**（`V` 匹配 `V吧`，不匹配 `zerosievert吧`）；
 *   文本里的英文 / 数字关键词要**独立成词**（两侧不能是字母数字下划线），
 *   所以 `V` 不会命中 `zerosievert`。
 *
 * 为什么要有：用户实测踩过——某个只在「zerosievert吧」发过言的人，因为吧名里有个 `v`，
 * 被 `V` 这条规则用包含匹配判成了 V 圈（HANDOFF §5 #59）。
 * 纯中文关键词在 `exact` 下退化为包含（中文没有词边界），文档里写明了。
 */
export type KeywordMatchMode = "contains" | "exact";

export const KEYWORD_MATCH_MODES: ReadonlyArray<{
	id: KeywordMatchMode;
	label: string;
}> = [
	{ id: "contains", label: "包含匹配（默认）" },
	{ id: "exact", label: "完全匹配" },
];

/**
 * 单个关键词写成 `=xxx` 表示这一个词用完全匹配。
 *
 * 用前缀而不是"每个词配一个开关"：规则表是一行行手写的纯文本，
 * 前缀是唯一能就地表达"这一个词要精确"的写法（`=V` 读起来也直观）。
 */
const EXACT_PREFIX = "=";

export function isExactKeyword(token: string): boolean {
	return String(token ?? "").startsWith(EXACT_PREFIX);
}

/** 去掉 `=` 前缀后的关键词本体（界面显示、高亮、理由文案都用它）。 */
export function keywordText(token: string): string {
	return isExactKeyword(token)
		? String(token).slice(EXACT_PREFIX.length).trim()
		: String(token ?? "");
}

/** 一个关键词是不是"短英文/数字"——这种词用包含匹配最容易误伤（`V` 命中 `zerosievert`）。 */
export function isRiskyShortKeyword(token: string): boolean {
	const text = keywordText(token);
	if (isExactKeyword(token)) return false;
	return /^[A-Za-z0-9_]+$/.test(text) && text.length <= 2;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/** 找到就能命中：英文 / 数字按"独立成词"判断，中文没有词边界，退化为包含。 */
function containsAsWord(text: string, keyword: string): boolean {
	if (!keyword) return false;
	const haystack = text.toLowerCase();
	const needle = keyword.toLowerCase();
	// 纯中文（含其它非 ASCII）没有词边界可用：与包含匹配等价
	if (/^[^A-Za-z0-9_]+$/.test(needle)) return haystack.includes(needle);
	let index = haystack.indexOf(needle);
	while (index >= 0) {
		const before = index > 0 ? haystack[index - 1] : "";
		const after = haystack[index + needle.length] ?? "";
		const leftOk = !before || !WORD_CHAR.test(before);
		const rightOk = !after || !WORD_CHAR.test(after);
		if (leftOk && rightOk) return true;
		index = haystack.indexOf(needle, index + 1);
	}
	return false;
}

/** 吧名比较前先去掉末尾的「吧」：用户写 `=V` 时，`V吧` 也该算命中。 */
function normalizeForumName(value: string): string {
	return String(value ?? "")
		.trim()
		.replace(/吧$/, "")
		.toLowerCase();
}

/** 关键词 vs 文本（发帖内容 / 排除词）。 */
export function keywordMatchesText(
	text: string,
	token: string,
	mode: KeywordMatchMode,
): boolean {
	const keyword = keywordText(token);
	if (!keyword) return false;
	if (isExactKeyword(token) || mode === "exact") {
		return containsAsWord(text, keyword);
	}
	return String(text ?? "").toLowerCase().includes(keyword.toLowerCase());
}

/** 关键词 vs 吧名：`exact` 下要求整个吧名相等（忽略末尾的「吧」）。 */
export function keywordMatchesForum(
	forumName: string,
	token: string,
	mode: KeywordMatchMode,
): boolean {
	const keyword = keywordText(token);
	if (!keyword) return false;
	if (isExactKeyword(token) || mode === "exact") {
		return normalizeForumName(forumName) === normalizeForumName(keyword);
	}
	return String(forumName ?? "")
		.toLowerCase()
		.includes(keyword.toLowerCase());
}

export const RULE_FORMAT_HINT =
	"每行一条：名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省) | 发帖所在吧关键词(可省)；关键词用逗号分隔，`#` 开头是注释；单个词前面加 `=` 表示这个词要完全匹配（例如 `=V` 只命中吧名就是 V 的，不会命中 zerosievert）。";

export const EXAMPLE_RULES = [
	"# 名称 | 发帖关键词 | 关注的关键词 | 排除关键词(可省) | 直接命中名单(可省) | 发帖所在关键词(可省)",
	"米||米哈游, 米游社, mihoyo, 反米哈游, 米哈游笑话,源初之结, 源初之结内鬼,Varsapura, varsapura内鬼,flyme2themoon,星布谷地, 星布谷地内鬼,崩坏因缘精灵, 崩坏因缘精灵内鬼, 崩坏因缘精灵爆料|||米哈游, 米游社, mihoyo, 反米哈游, 米哈游笑话,源初之结, 源初之结内鬼,Varsapura, varsapura内鬼,flyme2themoon,星布谷地, 星布谷地内鬼,崩坏因缘精灵, 崩坏因缘精灵内鬼, 崩坏因缘精灵爆料",
	"原||原神, 原神玩家, 原神2, 原神爆料,原神内鬼, 原神天堂内鬼, 原神内容讨论,原神爆料|||原神, 原神玩家, 原神2, 原神爆料,原神内鬼, 原神天堂内鬼, 原神内容讨论,原神爆料",
	"崩坏||崩坏3rd, 崩坏三, 崩坏三日服, 反崩坏3, 崩坏3交易,崩坏学园2, 崩坏学园|||崩坏3rd, 崩坏三, 崩坏三日服, 反崩坏3, 崩坏3交易,崩坏学园2, 崩坏学园",
	"崩轨||崩坏星穹铁道, 星穹铁道内鬼, 崩坏星穹铁道内鬼, 崩坏星穹铁道交易账号, 崩坏星穹铁道萌新|||崩坏星穹铁道, 星穹铁道内鬼, 崩坏星穹铁道内鬼, 崩坏星穹铁道交易账号, 崩坏星穹铁道萌新",
	"绝||绝区零,绝区零内鬼,绝区零ml,绝区零内鬼爆料,绝区零, 绝区零内鬼, 绝区零虚拟偶像, 绝区零福瑞|||绝区零,绝区零内鬼,绝区零ml,绝区零内鬼爆料,绝区零, 绝区零内鬼, 绝区零虚拟偶像, 绝区零福瑞",
	"未定||未定事件簿, 未定事件薄|||未定事件簿, 未定事件薄",
	"舟||明日方舟, 明日方舟内鬼, 明日方舟终末地, 反明日方舟, 明日方舟脚臭, 明日方舟配种, 明日方舟论战, 明日方舟豆苗,半壁江山雪之下,明日方舟pl,明日方舟dl,快乐雪花,危机合约|||明日方舟, 明日方舟内鬼, 明日方舟终末地, 反明日方舟, 明日方舟脚臭, 明日方舟配种, 明日方舟论战, 明日方舟豆苗,半壁江山雪之下,明日方舟pl,明日方舟dl,快乐雪花,危机合约",
	"舰B||碧蓝航线, 新碧蓝航线, 碧蓝航线国服, 碧蓝航线r, 碧蓝航线初月, 碧蓝航线不挠, 碧蓝航线光辉, 碧蓝航线可畏, 碧蓝航线怨仇, 碧蓝航线胜利, 碧蓝航线俾斯麦, 碧蓝航线柴郡,异色格,赤色中轴|||碧蓝航线, 新碧蓝航线, 碧蓝航线国服, 碧蓝航线r, 碧蓝航线初月, 碧蓝航线不挠, 碧蓝航线光辉, 碧蓝航线可畏, 碧蓝航线怨仇, 碧蓝航线胜利, 碧蓝航线俾斯麦, 碧蓝航线柴郡,异色格,赤色中轴",
	"旅谣||蓝色星原旅谣|||蓝色星原旅谣",
	"少前||少女前线, 少女前线r, 少女前线2, 少前2,少前r追放,少前2内鬼|||少女前线, 少女前线r, 少女前线2, 少前2,少前r追放,少前2内鬼",
	"档案||碧蓝档案, 蔚蓝档案, 蔚蓝档案国服, 蔚蓝档案社区, 反蔚蓝档案, 碧蓝档案垃圾桶,碧蓝档案吐槽|||碧蓝档案, 蔚蓝档案, 蔚蓝档案国服, 蔚蓝档案社区, 反蔚蓝档案, 碧蓝档案垃圾桶,碧蓝档案吐槽",
	"fgo||fgo, 命运冠位指定, fgo日服, fgo晒卡, 命运冠位指定交易|||fgo, 命运冠位指定, fgo日服, fgo晒卡, 命运冠位指定交易",
	"Nikke||nikke, nikke胜利女神, nikke方舟人口, nikke伊甸园, nikke外缘区, 胜利女神, 胜利女神妮姬, 尼姬胜利女神|||nikke, nikke胜利女神, nikke方舟人口, nikke伊甸园, nikke外缘区, 胜利女神, 胜利女神妮姬, 尼姬胜利女神",
	"尘白||尘白禁区, 尘白禁区埃达, 尘白禁区后勤, 尘白禁区鸣濑晴, 尘白禁区百合, 尘白禁区串子配种, 尘白禁区内鬼, 尘白禁区睡觉, 尘白禁区观光区|||尘白禁区, 尘白禁区埃达, 尘白禁区后勤, 尘白禁区鸣濑晴, 尘白禁区百合, 尘白禁区串子配种, 尘白禁区内鬼, 尘白禁区睡觉, 尘白禁区观光区",
	"无期||反无期迷途, 无期迷途交易, 无期迷途内鬼|||反无期迷途, 无期迷途交易, 无期迷途内鬼",
	"1999||重返未来1999, 重返未来1999内鬼, 重返未来1999节奏, 重返未来1999配种|||重返未来1999, 重返未来1999内鬼, 重返未来1999节奏, 重返未来1999配种",
	"鸣潮||鸣潮, 鸣潮内鬼, 鸣潮爆料, 鸣潮天堂内鬼, 鸣潮包容,旧鸣潮内鬼,新鸣潮内鬼,北落野|||鸣潮, 鸣潮内鬼, 鸣潮爆料, 鸣潮天堂内鬼, 鸣潮包容,旧鸣潮内鬼,新鸣潮内鬼,北落野",
	"战双||战双帕弥什, 战双, 升格网络|||战双帕弥什, 战双, 升格网络",
	"偷玩||有男偷玩|||有男偷玩",
	"辣仙||有男不玩ml|||有男不玩ml",
	"红烧天堂||heavenburnsred|||heavenburnsred",
	"二笑||二游笑话|||二游笑话",
	"笑话||dinner笑话,伪史笑话,皇汉笑话,galgame笑话|||dinner笑话,伪史笑话,皇汉笑话,galgame笑话",
	"异环||异环, 异环内鬼, 异环人口, 异环爆料, 异环交易, 异环买卖, 异环代练, 幻塔异环, 异环手游, 异环终极内鬼|||异环, 异环内鬼, 异环人口, 异环爆料, 异环交易, 异环买卖, 异环代练, 幻塔异环, 异环手游, 异环终极内鬼",
	"百合||偶像大师,学园偶像大师,偶像大师闪耀色彩,东方,东方幻想魔录,隔壁东方,东方口袋战争,反百破,百合,新百合,魔法少女的魔女裁判,光之美少女,萌战|||偶像大师,学园偶像大师,偶像大师闪耀色彩,东方,东方幻想魔录,隔壁东方,东方口袋战争,反百破,百合,新百合,魔法少女的魔女裁判,光之美少女,萌战",
	"边狱||边狱公司|||边狱公司",
	"圆规||原神内鬼,原神内鬼避风港|||原神内鬼,原神内鬼避风港",
	"V||asoul,=V|||asoul,=V",
	"bang||bangdream,bangdream国服,邦多利声优,笔记紫,梦想紫,avemujica|||bangdream,bangdream国服,邦多利声优,笔记紫,梦想紫,avemujica",
	"⭕️||反激女|||反激女",
	"同||燕淋十六声,淋神,王者淋耀,欧美后花园,lol淋价,淋日方舟,淋,极地大乱斗,新极地大乱斗|||燕淋十六声,淋神,王者淋耀,欧美后花园,lol淋价,淋日方舟,淋,极地大乱斗,新极地大乱斗",
	"鉴证||航空母舰,中国人口,椎名立希吐槽,小王避难所,朴正熙,印度|||航空母舰,中国人口,椎名立希吐槽,小王避难所,朴正熙,印度",
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

		// 短英文 / 数字关键词 + 包含匹配 = 最容易误伤的一种写法（用户实测被 `V` 命中 `zerosievert`）
		for (const [field, values] of [
			["发帖关键词", rule.postKeywords],
			["关注的吧关键词", rule.forumKeywords],
			["排除关键词", rule.excludes],
			["发帖所在吧关键词", rule.postForumKeywords],
		] as const) {
			const risky = values.find((value) => isRiskyShortKeyword(value));
			if (risky) {
				issues.push({
					line: lineNumber,
					text: brief,
					level: "warn",
					message: `${field}里的「${keywordText(risky)}」很短，用包含匹配会命中无关内容（实测：关键词 V 命中了「zerosievert吧」）。要精确匹配就写成 =${keywordText(risky)}。`,
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
	/** 发帖时间（unix 秒）。没有时间的证据排序时排在带时间的后面 */
	createTime?: number;
	/** 所在主题帖的 id（跳转要用） */
	threadId?: string;
	/** 这一楼的帖子 id：回复 / 楼中楼用它精确跳到那一楼、并查楼层 */
	postId?: string;
	/** 楼中楼回复了谁 */
	replyTo?: string;
}

export interface CompositionInput {
	uid?: string | null;
	userId?: number | null;
	/** 该用户关注的吧名 */
	forums: string[];
	/** 该用户的主题帖与回复（标题 + 正文摘要） */
	posts: CompositionPostInput[];
}

/** 一条发帖类证据的出处：面板据此渲染类型标签、时间、跳转链接与「查楼层」。 */
export interface CompositionEvidencePost {
	kind: CompositionPostKind;
	forumName: string;
	title: string;
	preview: string;
	createTime?: number;
	threadId?: string;
	postId?: string;
	replyTo?: string;
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
	/**
	 * 这条证据发生在什么时候（unix 秒）。
	 *
	 * 只有发帖类证据有：名单与关注的吧是"状态"，没有时间。
	 * 排序规则见 `sortEvidencesByRecency()`：带时间的按时间倒序排前面，没时间的排在后面。
	 */
	at?: number;
	/** 发帖类证据的出处（跳转 / 楼层要用；名单与关注的吧没有） */
	post?: CompositionEvidencePost;
}

/** 从一条发帖输入里摘出"出处"，附在证据上（渲染与排序都要用）。 */
function evidencePost(post: CompositionPostInput): CompositionEvidencePost {
	return {
		kind: post.kind,
		forumName: String(post.forumName ?? "").trim(),
		title: post.title ?? "",
		preview: post.preview ?? "",
		createTime: post.createTime,
		threadId: post.threadId,
		postId: post.postId,
		replyTo: post.replyTo,
	};
}

export interface CompositionHit {
	rule: CompositionRule;
	evidences: CompositionEvidence[];
	/** 有任何一条强证据 */
	sure: boolean;
	/** 一句话总结，例如「关注了「原神吧」；主题帖命中「原神」」 */
	summary: string;
}

/** 找到一个命中的关键词，返回**去掉 `=` 前缀**的词（界面显示与高亮都用它）。 */
function firstKeywordText(
	text: string,
	keywords: string[],
	mode: KeywordMatchMode,
): string {
	for (const keyword of keywords) {
		if (keywordMatchesText(text, keyword, mode)) return keywordText(keyword);
	}
	return "";
}

/** 吧名匹配：`exact` 要求整个吧名相等，`contains` 按包含。 */
function firstKeywordForum(
	forumName: string,
	keywords: string[],
	mode: KeywordMatchMode,
): string {
	for (const keyword of keywords) {
		if (keywordMatchesForum(forumName, keyword, mode)) {
			return keywordText(keyword);
		}
	}
	return "";
}

function isExcluded(
	text: string,
	excludes: string[],
	mode: KeywordMatchMode,
): boolean {
	return excludes.some((word) => keywordMatchesText(text, word, mode));
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
 * 证据按时间倒序：**最近的排前面**。
 *
 * 为什么要有：一条规则可能同时命中"关注了吧"和"上周发的帖"，用户想先看到的是
 * 最近那条依据（用来判断"这人现在还这样吗"）。名单与关注的吧没有时间，
 * 它们是"状态"而不是"事件"，所以排在带时间的证据后面，并保持原来的相对顺序
 * （稳定排序：不传时间的不参与比较）。
 */
export function sortEvidencesByRecency(
	evidences: CompositionEvidence[],
): CompositionEvidence[] {
	return evidences
		.map((evidence, index) => ({ evidence, index }))
		.sort((a, b) => {
			const left = Number(a.evidence.at ?? 0);
			const right = Number(b.evidence.at ?? 0);
			if (left !== right) return right - left;
			return a.index - b.index;
		})
		.map((item) => item.evidence);
}

/** 一条命中里最新的证据时间（没有带时间的证据就返回 0）。 */
export function newestEvidenceAt(hit: CompositionHit): number {
	let newest = 0;
	for (const evidence of hit.evidences) {
		const at = Number(evidence.at ?? 0);
		if (at > newest) newest = at;
	}
	return newest;
}

/**
 * 命中规则也按时间倒序：最近有依据的规则排在前面。
 *
 * 原来的顺序是"规则表里的书写顺序"——用户看到的第一个标记与他最近看到的东西无关。
 * 没有时间依据的命中（只靠名单 / 关注的吧）排在有时间的后面，内部保持规则表顺序。
 */
export function sortHitsByRecency(hits: CompositionHit[]): CompositionHit[] {
	return hits
		.map((hit, index) => ({
			hit: { ...hit, evidences: sortEvidencesByRecency(hit.evidences) },
			index,
			newest: newestEvidenceAt(hit),
		}))
		.sort((a, b) => {
			if (a.newest !== b.newest) return b.newest - a.newest;
			return a.index - b.index;
		})
		.map((item) => item.hit);
}

/**
 * 按规则匹配一个用户。
 *
 * 每条规则最多产出一条 hit，但可以带多条证据：一个用户既关注了「原神吧」、
 * 又发过带「原神」的主题帖，就会把两条原因都写进去，而不是变成两个重复徽章。
 *
 * **返回顺序 = 时间倒序**（1.10.0 起，见 `sortHitsByRecency`）：最近的依据排在前面。
 * 需要"规则表顺序"的地方（比如测试里对照规则）自己按 `rule` 取即可。
 *
 * `options.mode` 是**不带 `=` 前缀**的关键词用哪种匹配方式（默认包含）；
 * 单个关键词写了 `=xxx` 就一定是完全匹配（见 `keywordMatchesText`）。
 */
export function matchComposition(
	input: CompositionInput,
	rules: CompositionRule[],
	options: { mode?: KeywordMatchMode } = {},
): CompositionHit[] {
	const mode = options.mode ?? "contains";
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
			if (isExcluded(forum, rule.excludes, mode)) continue;
			const keyword = firstKeywordForum(forum, rule.forumKeywords, mode);
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
			if (!name || isExcluded(name, rule.excludes, mode)) continue;
			const keyword = firstKeywordForum(name, rule.postForumKeywords, mode);
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
				at: post.createTime,
				post: evidencePost(post),
			};
			postForumEvidence = evidence;
			if (evidence.sure) break;
		}
		if (postForumEvidence) evidences.push(postForumEvidence);

		//    3b) 再看发帖内容关键词
		let postEvidence: CompositionEvidence | null = null;
		for (const post of input.posts) {
			const text = [post.title, post.preview].filter(Boolean).join(" ");
			if (!text || isExcluded(text, rule.excludes, mode)) continue;
			const keyword = firstKeywordText(text, rule.postKeywords, mode);
			if (!keyword) continue;
			const evidence: CompositionEvidence = {
				source: "post",
				keyword,
				reason: `${POST_KIND_TEXT[post.kind]}命中`,
				excerpt: excerptAround(text, keyword),
				sure: post.kind === "topic",
				at: post.createTime,
				post: evidencePost(post),
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

	return sortHitsByRecency(hits);
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
