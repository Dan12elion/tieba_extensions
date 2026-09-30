/**
 * 「校验 BDUSS」：调一次**需要登录**的只读端点，看这份凭据到底能不能用。
 *
 * 为什么需要它：BDUSS 失效（改密码、退出登录、太久没用）之后，脚本的表现是
 * 「查询失败但说不清为什么」，用户只能猜。这里给一个明确的结论 + 校验时间。
 *
 * 为什么是 `/f/user/json_userinfo`：它是贴吧自己的「我是谁」接口，
 * 未登录时返回字面量 `null`（2026-09-30 实测：不带 Cookie、带 `BDUSS=x`
 * 两种情况都返回 `null`），登录时返回账号信息，且是纯 GET。
 * 试过的其它端点都不能用来判断凭据：`getFollow` / `getFans` / `getLikeForum` /
 * `getProfile` **在凭据无效时照样返回数据**（它们匿名也读得到），
 * `/i/sys/user_json` 更是无论登录与否都返回一个 `tbs`。这些实测记录在
 * `dist/.verify/bduss-probe*.mjs` 里（探针脚本，不进仓库）。
 *
 * 一个必须如实说明的限制：**凭据要放在 `Cookie` 头里**，而部分脚本管理器会把
 * 脚本设置的 `Cookie` 头剥掉（改用浏览器自己的 cookie）。所以这里先发两次探针：
 *   1. 完全不带头 → 浏览器现在登录着吗？
 *   2. 带一个故意写坏的 BDUSS → 这个头到底有没有被发出去？
 * 据此再决定第三次（真正的校验）该怎么解读，并把不确定性写进给用户的话里。
 * 「凭据有效」这条正例**只有用户自己拿真 BDUSS 才能验证**（见 HANDOFF §9.2 的 V4）。
 */

import { gmRequest } from "./gmhttp.ts";
import { requestQueue } from "./queue.ts";

export const BDUSS_PROBE_URL = "https://tieba.baidu.com/f/user/json_userinfo";

/** 故意写坏的凭据：用来判断 Cookie 头有没有被真的发出去 */
const INVALID_PROBE = "eztb-invalid-probe";

export type BdussCheckStatus = "ok" | "invalid" | "unknown" | "empty" | "error";

export interface BdussCheckResult {
	status: BdussCheckStatus;
	/** 给用户看的一句话结论 */
	message: string;
	/** 认出来的账号名（能认出来时才有） */
	account?: string;
	checkedAt: number;
}

interface WhoAmI {
	loggedIn: boolean;
	account?: string;
}

/** 从「我是谁」的返回里挑出账号名；字段名不止一种叫法，都试一遍 */
function pickAccountName(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const record = payload as Record<string, unknown>;
	const containers = [
		record,
		record.data,
		record.user,
		record.userinfo,
	] as Array<Record<string, unknown> | undefined>;
	for (const container of containers) {
		if (!container || typeof container !== "object") continue;
		for (const key of ["user_name", "username", "name_show", "name"]) {
			const value = container[key];
			if (typeof value === "string" && value.trim()) return value.trim();
		}
	}
	return undefined;
}

/**
 * 问一次「我是谁」。
 *
 * `bduss === null` 表示**不带** Cookie 头（用浏览器自己的登录状态）。
 */
async function whoAmI(bduss: string | null): Promise<WhoAmI> {
	const response = await requestQueue.run(() =>
		gmRequest({
			method: "GET",
			url: BDUSS_PROBE_URL,
			headers: {
				...(bduss ? { Cookie: `BDUSS=${bduss}` } : {}),
				Referer: "https://tieba.baidu.com/",
			},
			responseType: "text",
			timeout: 15_000,
		}),
	);

	const raw = response.response;
	const text = (
		typeof raw === "string"
			? raw
			: raw === undefined || raw === null
				? ""
				: String(raw)
	).trim();
	// 未登录时这个端点就是字面量 null（实测）
	if (!text || text === "null") return { loggedIn: false };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { loggedIn: false };
	}
	if (!parsed || typeof parsed !== "object") return { loggedIn: false };
	return { loggedIn: true, account: pickAccountName(parsed) };
}

/**
 * 校验一份 BDUSS。
 *
 * 这个函数**刻意不走熔断**：它本来就是"出问题的时候拿来用的"工具，
 * 被熔断挡住反而帮不上忙。三次请求仍然过限速队列。
 */
export async function checkBduss(bduss: string): Promise<BdussCheckResult> {
	const value = bduss.trim();
	const checkedAt = Date.now();
	if (!value) {
		return {
			status: "empty",
			message: "还没有填 BDUSS，先粘贴凭据再校验。",
			checkedAt,
		};
	}

	let browser: WhoAmI;
	let probe: WhoAmI;
	try {
		// 探针 1：不带 Cookie 头 —— 浏览器自己登录着吗？
		browser = await whoAmI(null);
		// 探针 2：带一个故意写坏的凭据 —— 我们设的 Cookie 头有没有生效？
		probe = await whoAmI(INVALID_PROBE);
	} catch (error) {
		return {
			status: "error",
			message: `校验没能完成：${error instanceof Error ? error.message : String(error)}`,
			checkedAt,
		};
	}

	// 坏凭据居然也被认下来了 ⇒ 我们设的 Cookie 头被剥掉了，用的是浏览器的登录状态
	const headerIgnored = probe.loggedIn;

	let real: WhoAmI;
	try {
		real = await whoAmI(value);
	} catch (error) {
		return {
			status: "error",
			message: `校验没能完成：${error instanceof Error ? error.message : String(error)}`,
			checkedAt,
		};
	}

	if (real.loggedIn && !headerIgnored) {
		return {
			status: "ok",
			account: real.account,
			message: `校验通过：这份 BDUSS 当前有效${real.account ? `（账号「${real.account}」）` : ""}。`,
			checkedAt,
		};
	}

	if (headerIgnored) {
		const browserName = browser.account ? `「${browser.account}」` : "（没认出来是谁）";
		return {
			status: "unknown",
			account: browser.account,
			message:
				`无法确认你粘贴的这份 BDUSS：这个脚本管理器不接受脚本设置的 Cookie 头，` +
				`请求用的是浏览器自己的登录状态（当前登录${browserName}）。` +
				`请改用能直接查询的方式确认（比如随便点一个用户的「查询」，能出数据就说明凭据没问题）。`,
			checkedAt,
		};
	}

	if (browser.loggedIn) {
		// 浏览器登录着、坏凭据被拒、真凭据也被拒：那就是这份凭据的问题
		return {
			status: "invalid",
			message:
				"校验没通过：贴吧没有认下这份 BDUSS（无效或已过期）。" +
				"请重新复制一次；注意别把前后的空格或不相关的 cookie 一起粘进来。",
			checkedAt,
		};
	}

	// 浏览器没登录、Cookie 头是否生效无法确认：把两种可能都说清楚，不硬下结论
	return {
		status: "invalid",
		message:
			"校验没通过：这个端点没有把凭据认下来。" +
			"可能是这份 BDUSS 无效/已过期，也可能是脚本管理器没有发送脚本设置的 Cookie 头、且浏览器当前未登录贴吧。" +
			"两种情况下查询都会失败，建议先按 F12 → Application → Cookies 重新复制一份。",
		checkedAt,
	};
}
