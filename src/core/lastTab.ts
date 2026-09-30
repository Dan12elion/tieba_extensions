/**
 * 记住上一次看过的页签（设置里可开，默认关）。
 *
 * 为什么单独存一个键、不塞进设置里：
 *   1. 这是**界面状态**，不是配置——塞进设置会让「导出设置」多带一个
 *      跟别人无关的字段，也会让导入时把对方的浏览习惯带过来；
 *   2. `settings.ts` 的存储键与结构版本都动不得（HANDOFF §3.3），
 *      新开一个键比往那份结构里加东西安全。
 * 读失败一律当作"没有记录"，退回设置里的「默认打开页签」。
 */

import { type PanelTabId, normalizePanelTabId } from "./panelTabs.ts";

const LAST_TAB_KEY = "tbEztbToolboxLastTabV1";

export function readLastTab(): PanelTabId | null {
	try {
		const stored = GM_getValue<unknown>(LAST_TAB_KEY, "");
		if (typeof stored !== "string" || !stored) return null;
		return normalizePanelTabId(stored);
	} catch {
		return null;
	}
}

export function writeLastTab(id: PanelTabId): void {
	try {
		GM_setValue(LAST_TAB_KEY, id);
	} catch {
		// 记不住只是少一个便利功能，不打扰用户
	}
}
