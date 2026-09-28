/** GM_xmlhttpRequest 的 Promise 封装。 */

export interface GmHttpOptions {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	data?: string | FormData | Blob | null;
	responseType?: "text" | "json" | "arraybuffer" | "blob";
	timeout?: number;
}

export class GmHttpError extends Error {
	readonly kind: "network" | "timeout" | "abort" | "unavailable";

	constructor(kind: GmHttpError["kind"], message: string) {
		super(message);
		this.name = "GmHttpError";
		this.kind = kind;
	}
}

export const DEFAULT_TIMEOUT = 30_000;

export interface GmRequestHandle {
	promise: Promise<GMXhrResponse>;
	/** 取消这次请求（SDK 侧会收到 GmHttpError("abort")） */
	abort(): void;
}

/**
 * 正在飞的请求。
 *
 * 以前 `gmRequest` 把 `GM_xmlhttpRequest` 的返回值（也就是 `{ abort() }`）
 * 丢掉了，于是没有任何取消入口。现在统一登记在这里，菜单里可以直接中断，
 * 排查"风控了、赶紧停下"时用得上。
 */
const inFlight = new Set<{ abort(): void }>();

export function inFlightCount(): number {
	return inFlight.size;
}

/** 中断当前所有在飞请求，返回中断了几个。 */
export function abortAllInFlight(): number {
	const count = inFlight.size;
	for (const handle of Array.from(inFlight)) {
		try {
			handle.abort();
		} catch {
			/* 已经结束的请求再 abort 会抛，忽略 */
		}
	}
	inFlight.clear();
	return count;
}

export function gmRequestHandle(options: GmHttpOptions): GmRequestHandle {
	let handle: { abort(): void } | null = null;
	let settled = false;
	const done = () => {
		settled = true;
		if (handle) inFlight.delete(handle);
	};

	const promise = new Promise<GMXhrResponse>((resolve, reject) => {
		if (typeof GM_xmlhttpRequest !== "function") {
			reject(
				new GmHttpError(
					"unavailable",
					"当前环境不支持 GM_xmlhttpRequest，请检查脚本管理器",
				),
			);
			return;
		}

		try {
			handle = GM_xmlhttpRequest({
				method: options.method ?? "GET",
				url: options.url,
				headers: options.headers,
				data: options.data ?? undefined,
				responseType: options.responseType ?? "text",
				timeout: options.timeout ?? DEFAULT_TIMEOUT,
				onload: (response) => {
					done();
					resolve(response);
				},
				onerror: () => {
					done();
					reject(new GmHttpError("network", "网络错误：无法连接贴吧接口"));
				},
				ontimeout: () => {
					done();
					reject(new GmHttpError("timeout", "请求超时，请稍后重试"));
				},
				onabort: () => {
					done();
					reject(new GmHttpError("abort", "请求已取消"));
				},
			});
			if (handle && !settled) inFlight.add(handle);
		} catch (error) {
			done();
			reject(
				new GmHttpError(
					"unavailable",
					`发起请求失败：${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	});

	return {
		promise,
		abort: () => {
			if (settled) return;
			try {
				handle?.abort();
			} catch {
				/* 同上 */
			}
			done();
		},
	};
}

export function gmRequest(options: GmHttpOptions): Promise<GMXhrResponse> {
	return gmRequestHandle(options).promise;
}
