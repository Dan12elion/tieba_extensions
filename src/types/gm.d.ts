/** 油猴（Tampermonkey / Violentmonkey）API 声明，只声明本脚本用到的部分。 */

interface GMXhrResponse {
	status: number;
	statusText: string;
	responseHeaders: string;
	response: unknown;
	finalUrl?: string;
}

interface GMXhrDetails {
	method?: string;
	url: string;
	headers?: Record<string, string>;
	data?: string | FormData | Blob | null;
	responseType?: "text" | "json" | "arraybuffer" | "blob";
	timeout?: number;
	onload?: (response: GMXhrResponse) => void;
	onerror?: (response: unknown) => void;
	ontimeout?: (response: unknown) => void;
	onabort?: (response: unknown) => void;
}

declare function GM_xmlhttpRequest(details: GMXhrDetails): { abort(): void };

declare function GM_getValue<T = unknown>(key: string, defaultValue?: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_registerMenuCommand(
	name: string,
	fn: () => void,
	accessKey?: string,
): number;
