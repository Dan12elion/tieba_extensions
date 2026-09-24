/** tieba.js 客户端的初始化与再初始化。 */

import { TiebaClient, initClient } from "tieba.js";
import { getSettings, hasBduss } from "./settings.ts";

let initializedBduss: string | null = null;

export class BdussMissingError extends Error {
	constructor() {
		super("尚未设置 BDUSS，请先在脚本菜单里填写");
		this.name = "BdussMissingError";
	}
}

/** 确保 SDK 单例与当前设置里的 BDUSS 一致；BDUSS 变化时自动重建。 */
export function ensureClient(): void {
	if (!hasBduss()) throw new BdussMissingError();
	const trimmed = getSettings().bduss.trim();
	if (trimmed === initializedBduss) return;
	initClient(new TiebaClient({ bduss: trimmed }));
	initializedBduss = trimmed;
}

/** BDUSS 被改动后强制重建客户端。 */
export function invalidateClient(): void {
	initializedBduss = null;
}
