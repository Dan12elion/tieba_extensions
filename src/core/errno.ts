/**
 * 贴吧业务错误码 → 人话。
 *
 * 为什么要有这个模块：SDK 抛的业务错误，`message` 长这样——
 * `Tieba API error 300000: `——直接摆到面板上等于没说。
 *
 * **这里刻意只做「原样呈现 + 结构化留位」，不猜含义。**
 * 错误码的含义属于「外部事实」，手写一张表就等于把没核实的猜测钉进用户界面
 * （HANDOFF §5 #37 就是这么把错误的许可信息钉成了测试断言）。
 * 2026-09-30 查过 aiotieba 的异常文档（<https://aiotieba.cc/ref/exception/>），
 * 那里只讲异常类型、不含 errno 对照表，所以目前**没有可引用的权威对照表**。
 *
 * 于是规则是：
 *   1. 只有「在哪次实测里见过」的码才写进 `KNOWN_ERRNO`，注释里写明出处；
 *   2. 没见过的码原样显示 code 与贴吧自己的 errmsg，并标明「未收录」；
 *   3. 每次遇到未收录的码，往内存里记一条（`recentUnknownErrno()`），
 *      诊断报告会带出来——用户把这行报上来，我们就能凭证据把码补进表里。
 */

export interface ErrnoNote {
	/** 给用户看的一句话说明 */
	hint: string;
	/** 这条结论的出处（实测记录）。没有出处的码不许进这张表。 */
	observed: string;
}

/**
 * 已实测过的错误码。
 *
 * 只放有实测记录的：贴吧的错误码没有公开文档，凭感觉写等于骗用户。
 */
export const KNOWN_ERRNO: Record<number, ErrnoNote> = {
	300000: {
		hint: "贴吧这次没有把数据交出来；同一个请求重试有时能成功",
		observed: "HANDOFF §5 #18 / #26：实测出现在取某个用户的发帖记录时（同一 uid 有时正常、有时回 300000）",
	},
};

/** 未收录的错误码只留在内存里，最多记这么多条 */
const UNKNOWN_MAX = 20;
const unknownErrno: string[] = [];

/** 记一条「没见过的错误码」，诊断报告会连同出处一起带出来 */
export function recordUnknownErrno(
	code: number | string,
	msg: string | undefined,
	where: string,
): void {
	const line = `${new Date().toISOString()} ${where} → errno=${code}${msg ? ` errmsg=${JSON.stringify(msg)}` : ""}`;
	unknownErrno.push(line);
	if (unknownErrno.length > UNKNOWN_MAX) {
		unknownErrno.splice(0, unknownErrno.length - UNKNOWN_MAX);
	}
}

export function recentUnknownErrno(): string[] {
	return unknownErrno.slice();
}

export function clearUnknownErrno(): void {
	unknownErrno.length = 0;
}

/**
 * 把业务错误码排成一句话。
 *
 * 纯函数：不记日志、不写缓冲（要那个副作用就用 `describeRequestError`）。
 */
export function formatServerError(
	code: number | string,
	msg?: string | null,
): string {
	const numeric = Number(code);
	const note = Number.isFinite(numeric) ? KNOWN_ERRNO[numeric] : undefined;
	const tail = msg && String(msg).trim() ? `：${String(msg).trim()}` : "（贴吧没有给出说明文字）";
	if (note) return `贴吧接口返回错误 ${code}${tail} —— ${note.hint}`;
	return `贴吧接口返回错误 ${code}${tail}（未收录的错误码，已记进诊断日志）`;
}

/** 业务错误：带 `code` 的（SDK 的 TiebaServerError 就是这个形状）。 */
function asServerError(error: unknown): { code: number; msg: string } | null {
	if (!error || typeof error !== "object") return null;
	const code = (error as { code?: unknown }).code;
	if (typeof code !== "number" || !Number.isFinite(code)) return null;
	const msg = (error as { msg?: unknown }).msg;
	return { code, msg: typeof msg === "string" ? msg : "" };
}

/**
 * 把任何取数失败翻成一句能给用户看的话。
 *
 * `where` 只用于记录未收录错误码时的出处（比如「发帖」页签 / 校验 BDUSS）。
 * 刻意不 import SDK：这个模块要能单独打包进离线测试。
 */
export function describeRequestError(error: unknown, where = "请求"): string {
	const serverError = asServerError(error);
	if (serverError) {
		if (!(serverError.code in KNOWN_ERRNO)) {
			recordUnknownErrno(serverError.code, serverError.msg, where);
		}
		return formatServerError(serverError.code, serverError.msg);
	}

	const kind = (error as { kind?: unknown } | null)?.kind;
	if (kind === "timeout") {
		return "请求超时：贴吧接口 30 秒内没有回应（网络慢或被限流，稍后再试）";
	}
	if (kind === "network") {
		return "网络错误：连不上贴吧接口（检查网络或代理，必要时重新登录贴吧）";
	}
	if (kind === "abort") return "请求已取消";
	if (kind === "unavailable") {
		return error instanceof Error
			? error.message
			: "当前环境不支持 GM_xmlhttpRequest，请检查脚本管理器";
	}

	if (error instanceof Error) return error.message;
	if (error === undefined || error === null) return "未知错误";
	return String(error);
}
