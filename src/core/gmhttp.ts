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

export function gmRequest(options: GmHttpOptions): Promise<GMXhrResponse> {
	return new Promise((resolve, reject) => {
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
			GM_xmlhttpRequest({
				method: options.method ?? "GET",
				url: options.url,
				headers: options.headers,
				data: options.data ?? undefined,
				responseType: options.responseType ?? "text",
				timeout: options.timeout ?? DEFAULT_TIMEOUT,
				onload: (response) => resolve(response),
				onerror: () =>
					reject(new GmHttpError("network", "网络错误：无法连接贴吧接口")),
				ontimeout: () =>
					reject(new GmHttpError("timeout", "请求超时，请稍后重试")),
				onabort: () => reject(new GmHttpError("abort", "请求已取消")),
			});
		} catch (error) {
			reject(
				new GmHttpError(
					"unavailable",
					`发起请求失败：${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	});
}
