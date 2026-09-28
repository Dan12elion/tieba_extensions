/**
 * 轻量日志。
 *
 * 之前的点击日志是 `console.log("...", ref)`——把整个用户对象（含 portrait）
 * 直接倒进控制台。现在统一走这里：按级别过滤、写进一个环形缓冲（诊断面板可以
 * 把最近若干条一起带出来）、用户标识只留脱敏后的短串。
 *
 * 默认级别是 `info`：`debug` 那类（比如"哪个按钮被点开"）平时既不打印、也不进
 * 环形缓冲，免得刷屏。需要排查时把下面的 `threshold` 临时改成 `"debug"` 再构建；
 * 目前没有做成界面开关，因为默认值才是绝大多数时候该有的行为。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const RING_MAX = 200;
const MAX_ARG_CHARS = 300;

let threshold: LogLevel = "info";
const ring: string[] = [];

/** 最近的日志（诊断报告用） */
export function recentLogs(): string[] {
	return ring.slice();
}

export function clearLogs(): void {
	ring.length = 0;
}

/** 只留头尾，中间的字符省掉；凭据类内容不会进日志，这里只是别让日志被长串撑爆 */
function mask(value: string): string {
	if (value.length <= 8) return value;
	return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

function format(value: unknown): string {
	let text: string;
	if (typeof value === "string") text = value;
	else if (value instanceof Error) text = `${value.name}: ${value.message}`;
	else if (value === undefined) text = "undefined";
	else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	if (text === undefined) text = String(value);
	return text.length > MAX_ARG_CHARS ? `${text.slice(0, MAX_ARG_CHARS)}…` : text;
}

function emit(level: LogLevel, args: unknown[]): void {
	if (ORDER[level] < ORDER[threshold]) return;
	const body = args.map(format).join(" ");
	ring.push(`[${new Date().toISOString()}] ${level}: ${body}`);
	if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
	const out = `[eztb] ${body}`;
	if (level === "error") console.error(out);
	else if (level === "warn") console.warn(out);
	else console.log(out);
}

export const log = {
	debug: (...args: unknown[]) => emit("debug", args),
	info: (...args: unknown[]) => emit("info", args),
	warn: (...args: unknown[]) => emit("warn", args),
	error: (...args: unknown[]) => emit("error", args),
};

/**
 * 把用户标识压成一行短串。
 *
 * 日志里要能对上"查的是谁"，但不该出现完整的 portrait / uid，所以这里做脱敏。
 */
export function describeUser(
	user:
		| {
				userId?: number | null;
				uid?: string | null;
				un?: string | null;
				portrait?: string | null;
		  }
		| null
		| undefined,
): string {
	if (!user) return "未识别";
	const parts: string[] = [];
	if (user.userId) parts.push(`id=${user.userId}`);
	if (user.uid) parts.push(`uid=${mask(String(user.uid))}`);
	if (user.un) parts.push(`un=${user.un}`);
	if (user.portrait) parts.push(`portrait=${mask(String(user.portrait))}`);
	return parts.join(" ") || "无标识";
}
