/**
 * `node-html-parser` 的浏览器替身。
 *
 * SDK 里只有 `api/forum.ts` 的 getForumMembers 用它解析吧务成员页（GBK HTML）。
 * 用原生 DOMParser 实现，只需覆盖它实际用到的几个接口。
 *
 * 注意：浏览器里 `<script>` 的 innerText 恒为空，而 forum.ts 恰恰靠
 * script.innerText 取内嵌 JSON，所以这里统一映射到 textContent。
 */

class ShimElement {
	constructor(private readonly el: Element) {}

	get attributes(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const attr of Array.from(this.el.attributes)) {
			out[attr.name] = attr.value;
		}
		return out;
	}

	get innerText(): string {
		return this.el.textContent ?? "";
	}

	get textContent(): string {
		return this.el.textContent ?? "";
	}

	getAttribute(name: string): string | null {
		return this.el.getAttribute(name);
	}

	querySelector(selector: string): ShimElement | null {
		const found = this.el.querySelector(selector);
		return found ? new ShimElement(found) : null;
	}

	querySelectorAll(selector: string): ShimElement[] {
		return Array.from(this.el.querySelectorAll(selector)).map(
			(el) => new ShimElement(el),
		);
	}
}

function parse(html: string): ShimElement {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return new ShimElement(doc.documentElement);
}

export default { parse };
export { parse };
