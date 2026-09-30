/**
 * 面板页签的注册表。
 *
 * 同一份名单有三个使用方：面板顶部的页签栏（`features/userPanel.ts`）、
 * 设置里的「打开面板时默认停在」（`features/settingsDialog.ts`）、以及设置存储
 * （`core/settings.ts` 的 `defaultTab`）。集中在这里是为了避免以后加页签时漏改——
 * 漏改的表现是"设置里选得到、面板里没有"这种不对称。
 */

export type PanelTabId =
	| "profile"
	| "composition"
	| "follow"
	| "mutual"
	| "forums"
	| "fans"
	| "posts";

export const PANEL_TABS: ReadonlyArray<{ id: PanelTabId; label: string }> = [
	{ id: "profile", label: "资料" },
	{ id: "composition", label: "成分" },
	{ id: "follow", label: "关注的人" },
	{ id: "mutual", label: "共同关注" },
	{ id: "forums", label: "关注的吧" },
	{ id: "fans", label: "粉丝" },
	{ id: "posts", label: "发帖" },
];

export const DEFAULT_PANEL_TAB: PanelTabId = "profile";

/**
 * 把任意来源的值收敛成合法页签。
 *
 * 存储里的旧值、手改过的导入 JSON、以后删掉的页签名都可能落进来，
 * 落到面板上就是"打开一个空白页签"，所以统一在这里兜底成默认值。
 */
export function normalizePanelTabId(value: unknown): PanelTabId {
	return PANEL_TABS.some((tab) => tab.id === value)
		? (value as PanelTabId)
		: DEFAULT_PANEL_TAB;
}
