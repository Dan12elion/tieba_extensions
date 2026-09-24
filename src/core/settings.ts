/** 脚本配置：全部存放在油猴存储里，不上传任何地方。 */

const STORAGE_KEY = "tbEztbToolboxSettingsV1";

export interface ToolboxSettings {
	/** 贴吧鉴权凭据，只保存在本机浏览器配置目录 */
	bduss: string;
	/** 获取 BDUSS 的引导网址 */
	bdussHelpUrl: string;
	/** 两次贴吧接口请求之间的最小间隔（毫秒） */
	minIntervalMs: number;
	/** 单个列表最多自动加载的页数，防止误点造成大量请求 */
	maxPagesPerList: number;
	/**
	 * 「成分」关键词规则表，一行一条：
	 * 名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省)
	 */
	compositionRules: string;
	/** 是否在页面上自动检测并标注（默认开；规则为空时不会发任何请求） */
	compositionAuto: boolean;
	/** 每页最多自动检测多少个用户 */
	compositionMaxPerPage: number;
	/** 成分结果缓存多少天 */
	compositionCacheDays: number;
}

export const DEFAULT_SETTINGS: ToolboxSettings = {
	bduss: "",
	bdussHelpUrl: "https://bduss.nest.moe/",
	minIntervalMs: 400,
	maxPagesPerList: 50,
	compositionRules: "",
	compositionAuto: true,
	compositionMaxPerPage: 20,
	compositionCacheDays: 3,
};

let cache: ToolboxSettings | null = null;

function readRaw(): Partial<ToolboxSettings> {
	try {
		const stored = GM_getValue<Partial<ToolboxSettings>>(STORAGE_KEY, {});
		return stored && typeof stored === "object" ? stored : {};
	} catch {
		return {};
	}
}

export function getSettings(): ToolboxSettings {
	if (!cache) {
		cache = { ...DEFAULT_SETTINGS, ...readRaw() };
	}
	return cache;
}

export function updateSettings(patch: Partial<ToolboxSettings>): ToolboxSettings {
	const next = { ...getSettings(), ...patch };
	if (!Number.isFinite(next.minIntervalMs) || next.minIntervalMs < 0) {
		next.minIntervalMs = DEFAULT_SETTINGS.minIntervalMs;
	}
	if (!Number.isFinite(next.maxPagesPerList) || next.maxPagesPerList < 1) {
		next.maxPagesPerList = DEFAULT_SETTINGS.maxPagesPerList;
	}
	if (
		!Number.isFinite(next.compositionMaxPerPage) ||
		next.compositionMaxPerPage < 1
	) {
		next.compositionMaxPerPage = DEFAULT_SETTINGS.compositionMaxPerPage;
	}
	if (next.compositionMaxPerPage > 200) next.compositionMaxPerPage = 200;
	if (
		!Number.isFinite(next.compositionCacheDays) ||
		next.compositionCacheDays < 1
	) {
		next.compositionCacheDays = DEFAULT_SETTINGS.compositionCacheDays;
	}
	if (next.compositionCacheDays > 365) next.compositionCacheDays = 365;
	next.compositionAuto = next.compositionAuto !== false;
	cache = next;
	try {
		GM_setValue(STORAGE_KEY, next);
	} catch {
		/* 存储失败时至少内存里生效 */
	}
	return next;
}

export function hasBduss(): boolean {
	return getSettings().bduss.trim().length > 0;
}

export function resetSettingsCache(): void {
	cache = null;
}
