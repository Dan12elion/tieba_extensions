/** 通用小工具。 */

export function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function cleanText(el: Element | null): string {
	return el?.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
}

/** 贴吧的 user_name 字段可能是 URL 编码，且可能是 GBK。 */
export function decodeUserName(value: string | null | undefined): string {
	const str = String(value ?? "").trim();
	if (!str || !/%[0-9A-F]{2}/i.test(str)) return str;
	try {
		return decodeURIComponent(str);
	} catch {
		try {
			const decoder = new TextDecoder("gbk");
			return str.replace(/(?:%[0-9A-F]{2})+/gi, (segment) =>
				decoder.decode(
					new Uint8Array(
						segment
							.slice(1)
							.split("%")
							.map((hex) => Number.parseInt(hex, 16)),
					),
				),
			);
		} catch {
			return str;
		}
	}
}

export function stripPortraitQuery(portrait: string | null | undefined): string {
	return String(portrait ?? "").split("?")[0];
}

export function portraitUrl(portrait: string): string {
	const clean = stripPortraitQuery(portrait);
	if (!clean) return "";
	return `https://gss0.bdstatic.com/6LZ1dD3d1sgCo2Kml5_Y_D3/sys/portrait/item/${clean}`;
}

export function formatTimestamp(
	unixSeconds: number | string | undefined,
): string {
	const value = Number(unixSeconds);
	if (!Number.isFinite(value) || value <= 0) return "";
	const date = new Date(value * 1000);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function forumUrl(name: string): string {
	return `https://tieba.baidu.com/f?kw=${encodeURIComponent(name)}`;
}

export function threadUrl(threadId: string | number): string {
	return `https://tieba.baidu.com/p/${threadId}`;
}

export function userHomeUrl(portrait: string | undefined): string {
	const clean = stripPortraitQuery(portrait);
	return clean
		? `https://tieba.baidu.com/home/main?id=${encodeURIComponent(clean)}`
		: "";
}

export function toNumber(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
