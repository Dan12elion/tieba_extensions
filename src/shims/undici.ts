/**
 * `undici` 的浏览器替身。
 *
 * SDK 只用它发三种请求：
 *   1. GET 取 JSON
 *   2. POST application/x-www-form-urlencoded
 *   3. POST multipart（protobuf，字段名 data、文件名 file）
 * 这里统一用 GM_xmlhttpRequest 实现，绕开 CORS 与混合内容限制。
 */
import { DEFAULT_TIMEOUT, gmRequest } from "../core/gmhttp.ts";
import { withRequestPolicy } from "../core/netPolicy.ts";

export type Dispatcher = unknown;

/** 连接池在浏览器里没有意义，保留构造签名即可。 */
export class Agent {
	constructor(_options?: unknown) {}
}

export const FormData = globalThis.FormData;

/**
 * SDK 的 BASE_URL 写死为 `http://tiebac.baidu.com`（core/http.ts）。
 * 从贴吧的 HTTPS 页面发起明文请求会受浏览器的混合内容策略影响，
 * 而该域名本身支持 HTTPS（SDK 自己的 getPanel 就用的 https，
 * 旧版脚本直连 https://tiebac.baidu.com/c/u/user/profile 也已长期可用）。
 * 因此在传输层统一升级协议，避免去改 SDK 源码。
 */
function upgradeToHttps(url: string): string {
	return url.replace(
		/^http:\/\/tiebac\.baidu\.com/i,
		"https://tiebac.baidu.com",
	);
}

interface RequestOptions {
	method?: string;
	headers?: Record<string, string> | Headers;
	body?: string | FormData | Blob | null;
	dispatcher?: unknown;
}

interface ResponseBody {
	json(): Promise<unknown>;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	dump(): Promise<void>;
}

interface RequestResult {
	statusCode: number;
	statusText: string;
	body: ResponseBody;
}

function normalizeHeaders(
	headers: RequestOptions["headers"],
): Record<string, string> | undefined {
	if (!headers) return undefined;
	if (typeof Headers !== "undefined" && headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	return headers as Record<string, string>;
}

/**
 * 与 undici.request 同签名的实现。
 * 一律以 arraybuffer 收包，再按调用方需要解码，避免多次网络请求。
 */
export async function request(
	url: string | URL,
	options: RequestOptions = {},
): Promise<RequestResult> {
	/*
	 * 所有 SDK 的 HTTP 都从这里出去，所以重试与熔断挂在**这一层**：
	 * 调用方（各取数模块）不用各自实现一遍，也不会漏掉某条路径。
	 * 重试仍在调用方给的那个限速名额里（调用方用 requestQueue 包住整次 SDK 调用），
	 * 退避时间比默认间隔长，所以不会变成"绕过限速的密集请求"。
	 */
	const target = upgradeToHttps(String(url));
	const response = await withRequestPolicy(
		() =>
			gmRequest({
				method: options.method ?? "GET",
				url: target,
				headers: normalizeHeaders(options.headers),
				data: (options.body ?? null) as string | FormData | Blob | null,
				responseType: "arraybuffer",
				timeout: DEFAULT_TIMEOUT,
			}),
		`请求 ${target}`,
	);

	const raw = response.response;
	const buffer =
		raw instanceof ArrayBuffer
			? raw
			: raw instanceof Uint8Array
				? (raw.buffer.slice(
						raw.byteOffset,
						raw.byteOffset + raw.byteLength,
					) as ArrayBuffer)
				: new ArrayBuffer(0);

	const decode = () => new TextDecoder("utf-8").decode(buffer);

	return {
		statusCode: response.status,
		statusText: response.statusText ?? "",
		body: {
			json: async () => JSON.parse(decode()),
			arrayBuffer: async () => buffer,
			text: async () => decode(),
			dump: async () => {},
		},
	};
}
