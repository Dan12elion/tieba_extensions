/**
 * 脚本配置：全部存放在油猴存储里，不上传任何地方。
 *
 * 存储键名里的 `V1` 是历史遗留，**不要改**——油猴的脚本存储是按「脚本 + 键名」
 * 找的，改键名等于把已装用户的 BDUSS 与规则表全部孤儿化。真正的结构版本用
 * `schemaVersion` 字段记，见下面的迁移。
 */

import { log } from "./log.ts";
import {
	DEFAULT_PANEL_TAB,
	normalizePanelTabId,
	type PanelTabId,
} from "./panelTabs.ts";

/**
 * 当前设置结构版本。
 *
 * 以后**改动存储结构**（改字段名、改值的形状、删字段）时：
 *   1. 提这个数字；
 *   2. 在 `MIGRATIONS` 里补一条 `旧版本 → 新版本` 的迁移。
 * 只加新字段不需要提版本——`normalize()` 会自动补上默认值。
 */
export const SETTINGS_SCHEMA_VERSION = 2;

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
	 * 名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词(可省) | 直接命中名单(可省) | 发帖所在吧关键词(可省)
	 */
	compositionRules: string;
	/** 是否在页面上自动检测并标注（默认开；规则为空时不会发任何请求） */
	compositionAuto: boolean;
	/** 每页最多自动检测多少个用户 */
	compositionMaxPerPage: number;
	/** 成分结果缓存多少天 */
	compositionCacheDays: number;
	/**
	 * 「疑似只签到」判定的吧内等级门槛：
	 * 等级 ≥ 这个值、且最近一页发帖里在该吧 0 条发言的吧会被标出来。
	 */
	signInLevelThreshold: number;
	/** 打开用户面板时默认停在哪个页签（见 core/panelTabs.ts 的页签注册表） */
	defaultTab: PanelTabId;
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
	signInLevelThreshold: 6,
	defaultTab: DEFAULT_PANEL_TAB,
};

/** 存储里比 `ToolboxSettings` 多一个版本号 */
type StoredSettings = Partial<ToolboxSettings> & { schemaVersion?: number };

let cache: ToolboxSettings | null = null;

function clampNumber(
	value: unknown,
	fallback: number,
	min: number,
	max = Number.POSITIVE_INFINITY,
): number {
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num) || num < min) return fallback;
	return Math.min(num, max);
}

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

/**
 * 把任意来源的数据归一化成一份合法设置。
 *
 * 读存储、导入 JSON、保存表单三条路都走这里，所以**未知键会被丢掉**、
 * 数值一律夹到合法区间、缺失项补默认值。
 */
export function normalizeSettings(input: unknown): ToolboxSettings {
	const raw: StoredSettings =
		input && typeof input === "object" ? (input as StoredSettings) : {};
	return {
		bduss: readString(raw.bduss, DEFAULT_SETTINGS.bduss).trim(),
		bdussHelpUrl: readString(raw.bdussHelpUrl, DEFAULT_SETTINGS.bdussHelpUrl),
		minIntervalMs: clampNumber(
			raw.minIntervalMs,
			DEFAULT_SETTINGS.minIntervalMs,
			0,
		),
		maxPagesPerList: clampNumber(
			raw.maxPagesPerList,
			DEFAULT_SETTINGS.maxPagesPerList,
			1,
		),
		compositionRules: readString(
			raw.compositionRules,
			DEFAULT_SETTINGS.compositionRules,
		),
		compositionAuto: raw.compositionAuto !== false,
		compositionMaxPerPage: clampNumber(
			raw.compositionMaxPerPage,
			DEFAULT_SETTINGS.compositionMaxPerPage,
			1,
			200,
		),
		compositionCacheDays: clampNumber(
			raw.compositionCacheDays,
			DEFAULT_SETTINGS.compositionCacheDays,
			1,
			365,
		),
		signInLevelThreshold: clampNumber(
			raw.signInLevelThreshold,
			DEFAULT_SETTINGS.signInLevelThreshold,
			1,
			18,
		),
		defaultTab: normalizePanelTabId(raw.defaultTab),
	};
}

/**
 * 结构迁移表：键是**迁移前的版本号**，值是把这个版本的数据升到下一版的函数。
 *
 * 目前只有一条 v1 → v2：这一版只是把「归一化」正式纳入版本管理
 * （以前读出来直接 `{ ...DEFAULT, ...stored }`，未知键会原样留在存储里）。
 * 留着这张表是为了以后真有结构改动时有地方落脚。
 */
const MIGRATIONS: Record<number, (raw: StoredSettings) => StoredSettings> = {
	1: (raw) => raw,
};

function readRaw(): StoredSettings {
	try {
		const stored = GM_getValue<StoredSettings>(STORAGE_KEY, {});
		return stored && typeof stored === "object"
			? (stored as StoredSettings)
			: {};
	} catch {
		return {};
	}
}

/** 跑一遍迁移链，返回归一化后的设置；`changed` 表示存储里的结构不是当前版本。 */
function migrate(raw: StoredSettings): {
	settings: ToolboxSettings;
	changed: boolean;
} {
	const startVersion =
		typeof raw.schemaVersion === "number" && raw.schemaVersion >= 1
			? raw.schemaVersion
			: 1;
	let current = raw;
	let version = startVersion;
	while (version < SETTINGS_SCHEMA_VERSION) {
		const step = MIGRATIONS[version];
		current = step ? step(current) : current;
		version += 1;
	}
	return {
		settings: normalizeSettings(current),
		/*
		 * 只有「从旧版本升上来」才回写存储。
		 *
		 * 反过来（存储里的版本比本脚本新，比如用户装过更新的版本又退回旧版）**不能**回写：
		 * 回写会把这一版不认识的字段（`normalizeSettings` 会丢掉未知键）从存储里抹掉，
		 * 等用户再升回去时，那些设置就永久没了。不加 `changed` 时读一次就覆盖一次。
		 */
		changed: startVersion < SETTINGS_SCHEMA_VERSION,
	};
}

function persist(settings: ToolboxSettings): void {
	try {
		GM_setValue(STORAGE_KEY, {
			...settings,
			schemaVersion: SETTINGS_SCHEMA_VERSION,
		} satisfies StoredSettings);
	} catch (error) {
		// 存不进就只在内存里生效，但要让用户/诊断面板看得见（以前这里被静默吞掉）
		log.warn("设置写入油猴存储失败：", error);
	}
}

export function getSettings(): ToolboxSettings {
	if (!cache) {
		const { settings, changed } = migrate(readRaw());
		cache = settings;
		// 首次读取时把补全/迁移后的结果写回去，下次就不用再迁一遍
		if (changed) persist(settings);
	}
	return cache;
}

export function updateSettings(patch: Partial<ToolboxSettings>): ToolboxSettings {
	const next = normalizeSettings({ ...getSettings(), ...patch });
	cache = next;
	persist(next);
	return next;
}

export function hasBduss(): boolean {
	return getSettings().bduss.trim().length > 0;
}

export function resetSettingsCache(): void {
	cache = null;
}

/* ------------------------------------------------------------------------- *
 * 设置导入 / 导出
 *
 * BDUSS 是账号凭据，规则是：
 *   - 导出文件里**永远不含** bduss；
 *   - 导入时**永远不读** bduss，哪怕对方手写进去也没用。
 * 这样"把设置发给别人"这件事就没有泄露风险了。
 * ------------------------------------------------------------------------- */

export const SETTINGS_EXPORT_FORMAT = "eztb-toolbox-settings";

export type PortableSettings = Omit<ToolboxSettings, "bduss">;

export interface SettingsExport {
	_format: string;
	schemaVersion: number;
	exportedAt: string;
	settings: PortableSettings;
}

export function toPortable(settings: ToolboxSettings): PortableSettings {
	const { bduss: _bduss, ...rest } = settings;
	return rest;
}

export function exportSettingsJson(now = new Date()): string {
	const payload: SettingsExport = {
		_format: SETTINGS_EXPORT_FORMAT,
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		exportedAt: now.toISOString(),
		settings: toPortable(getSettings()),
	};
	return JSON.stringify(payload, null, 2);
}

export type ImportResult =
	| { ok: true; settings: ToolboxSettings }
	| { ok: false; reason: string };

/**
 * 从 JSON 文本导入设置。
 *
 * 兼容两种形状：本脚本导出的带 `_format` 的包装对象，以及直接给一份设置对象
 * （方便用户手写或从别处粘贴）。导入的内容会先归一化，未知键与非法值会被丢掉。
 */
export function importSettingsJson(text: string): ImportResult {
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, reason: "内容是空的" };

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		return {
			ok: false,
			reason: `不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "顶层必须是一个对象" };
	}

	const holder = parsed as Record<string, unknown>;
	const format = holder._format;
	if (typeof format === "string" && format !== SETTINGS_EXPORT_FORMAT) {
		return { ok: false, reason: `不是本脚本导出的设置（_format = ${format}）` };
	}
	if ("settings" in holder && holder.settings !== undefined) {
		// 数组也是 typeof "object"，放过去会被当成"空设置"从而谎报导入成功
		if (
			!holder.settings ||
			typeof holder.settings !== "object" ||
			Array.isArray(holder.settings)
		) {
			return { ok: false, reason: "settings 字段必须是一个对象" };
		}
	}
	const body = holder.settings
		? (holder.settings as Record<string, unknown>)
		: holder;

	// 明确丢掉 bduss：导入永远不会覆盖用户自己的凭据
	const { bduss: _ignored, ...safe } = body;
	const merged = normalizeSettings({ ...getSettings(), ...safe });
	// normalizeSettings 会保留现有 bduss，这里再钉一次，防止以后改坏
	merged.bduss = getSettings().bduss;
	cache = merged;
	persist(merged);
	return { ok: true, settings: merged };
}
