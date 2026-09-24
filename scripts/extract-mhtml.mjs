/**
 * 把浏览器保存的 .mhtml 快照解码成可加载的 .html，用于离线回归测试。
 *
 * Blink 保存的 MHTML 里正文是 quoted-printable 编码的 UTF-8，
 * 所以要按字节还原，不能直接按字符处理。
 */
import fs from "node:fs";
import path from "node:path";

/** 解码 quoted-printable，返回 Buffer。 */
export function decodeQuotedPrintable(input) {
	const out = [];
	for (let i = 0; i < input.length; i++) {
		const byte = input[i];
		if (byte !== 0x3d /* = */) {
			out.push(byte);
			continue;
		}
		// 软换行 = \r\n 或 = \n 直接丢弃
		if (input[i + 1] === 0x0d && input[i + 2] === 0x0a) {
			i += 2;
			continue;
		}
		if (input[i + 1] === 0x0a) {
			i += 1;
			continue;
		}
		const hex = String.fromCharCode(input[i + 1], input[i + 2]);
		if (/^[0-9a-fA-F]{2}$/.test(hex)) {
			out.push(Number.parseInt(hex, 16));
			i += 2;
			continue;
		}
		out.push(byte);
	}
	return Buffer.from(out);
}

/** 从 MHTML 中取出第一个 text/html 部分并解码。 */
export function extractHtml(filePath) {
	const raw = fs.readFileSync(filePath);
	const text = raw.toString("latin1");

	const boundaryMatch = text.match(/boundary="?([^"\r\n;]+)"?/i);
	if (!boundaryMatch) throw new Error(`${filePath}：找不到 MIME boundary`);
	const boundary = `--${boundaryMatch[1]}`;

	const parts = text.split(boundary);
	for (const part of parts) {
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd < 0) continue;
		const headers = part.slice(0, headerEnd);
		if (!/content-type:\s*text\/html/i.test(headers)) continue;

		const body = part.slice(headerEnd + 4);
		const bodyBuffer = Buffer.from(body, "latin1");
		const decoded = /content-transfer-encoding:\s*quoted-printable/i.test(
			headers,
		)
			? decodeQuotedPrintable(bodyBuffer)
			: bodyBuffer;
		return decoded.toString("utf8");
	}
	throw new Error(`${filePath}：没有找到 text/html 部分`);
}

if (process.argv[1] && process.argv[1].endsWith("extract-mhtml.mjs")) {
	const files = process.argv.slice(2);
	if (!files.length) {
		console.error("用法：node scripts/extract-mhtml.mjs <a.mhtml> [b.mhtml ...]");
		process.exit(1);
	}
	for (const file of files) {
		const html = extractHtml(file);
		const outDir = process.env.EZTB_EXTRACT_OUT ?? path.dirname(file);
		fs.mkdirSync(outDir, { recursive: true });
		const out = path.join(
			outDir,
			`_extract_${path.basename(file, ".mhtml")}.html`,
		);
		fs.writeFileSync(out, html, "utf8");
		console.log(`已解码 ${path.basename(file)} → ${out}（${html.length} 字符）`);
	}
}
