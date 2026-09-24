/**
 * `node:crypto` 的浏览器替身。
 *
 * tieba.js 只用它做一件事：给请求参数算 MD5 签名
 * （`core/auth.ts` → `createHash("md5").update(str).digest("hex").toUpperCase()`）。
 * 因此这里只需要实现 "md5" + "hex" 这一条路径。
 */

const SHIFT = new Uint8Array([
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
	9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
	16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
	15, 21,
]);

const TABLE = (() => {
	const table = new Uint32Array(64);
	for (let i = 0; i < 64; i++) {
		table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
	}
	return table;
})();

function md5Bytes(message: Uint8Array): Uint8Array {
	const withPaddingStart = message.length + 1;
	const totalLength = ((withPaddingStart + 8 + 63) >> 6) << 6;
	const buffer = new Uint8Array(totalLength);
	buffer.set(message);
	buffer[message.length] = 0x80;

	const bitLength = message.length * 8;
	const view = new DataView(buffer.buffer);
	view.setUint32(totalLength - 8, bitLength >>> 0, true);
	view.setUint32(totalLength - 4, Math.floor(bitLength / 4294967296), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;
	const chunk = new Uint32Array(16);

	for (let offset = 0; offset < totalLength; offset += 64) {
		for (let i = 0; i < 16; i++) {
			chunk[i] = view.getUint32(offset + i * 4, true);
		}

		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;

		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}

			const sum = (f + a + TABLE[i] + chunk[g]) | 0;
			const rotate = SHIFT[i];
			a = d;
			d = c;
			c = b;
			b = (b + ((sum << rotate) | (sum >>> (32 - rotate)))) | 0;
		}

		a0 = (a0 + a) | 0;
		b0 = (b0 + b) | 0;
		c0 = (c0 + c) | 0;
		d0 = (d0 + d) | 0;
	}

	const digest = new Uint8Array(16);
	const digestView = new DataView(digest.buffer);
	digestView.setUint32(0, a0 >>> 0, true);
	digestView.setUint32(4, b0 >>> 0, true);
	digestView.setUint32(8, c0 >>> 0, true);
	digestView.setUint32(12, d0 >>> 0, true);
	return digest;
}

const HEX = "0123456789abcdef";

export function md5Hex(input: string): string {
	const digest = md5Bytes(new TextEncoder().encode(input));
	let out = "";
	for (const byte of digest) {
		out += HEX[byte >> 4] + HEX[byte & 0x0f];
	}
	return out;
}

export interface HashLike {
	update(data: string): HashLike;
	digest(encoding?: string): string;
}

export function createHash(algorithm: string): HashLike {
	if (algorithm.toLowerCase() !== "md5") {
		throw new Error(`浏览器版 tieba.js 只支持 md5，收到：${algorithm}`);
	}
	let buffer = "";
	const hash: HashLike = {
		update(data: string) {
			buffer += data;
			return hash;
		},
		digest(encoding = "hex") {
			if (encoding !== "hex") {
				throw new Error(`浏览器版 tieba.js 只支持 hex 摘要，收到：${encoding}`);
			}
			return md5Hex(buffer);
		},
	};
	return hash;
}

export default { createHash };
