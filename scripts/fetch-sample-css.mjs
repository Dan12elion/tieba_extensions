// 把快照（.mhtml）里引用的样式表抓到本地缓存，供 page-test 喂回页面。
//
// 为什么需要：MHTML 只带页面 *内联* 的 <style>，外部 CSS 只是链接；而新版贴吧的
// 布局规则（.head-line 是 flex、.image-text .user-info 固定 40px 高）都在外部 CSS 里。
// 少了它们，快照渲染出来的几何是假的——"成分标记压住正文"这种问题就是这么漏掉的。
//
// 用法：node scripts/fetch-sample-css.mjs
//      $env:EZTB_SAMPLE_DIR / $env:EZTB_CSS_DIR 可覆盖默认路径
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHtml } from "./extract-mhtml.mjs";

const SAMPLE_DIR =
	process.env.EZTB_SAMPLE_DIR ??
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test0");
const OUT_DIR = process.env.EZTB_CSS_DIR ?? path.join(SAMPLE_DIR, "_css_cache");
/** 与 page-test 一致：项目里的 dist/.samples 也扫一遍 */
const SAMPLE_DIRS = [
	SAMPLE_DIR,
	path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"dist/.samples",
	),
];

const samples = SAMPLE_DIRS.flatMap((dir) =>
	fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((name) => name.toLowerCase().endsWith(".mhtml"))
				.map((name) => path.join(dir, name))
		: [],
);
if (!samples.length) {
	console.error(`这些目录下都没有 .mhtml 快照：${SAMPLE_DIRS.join(" / ")}`);
	process.exit(1);
}

const urls = new Set();
for (const file of samples) {
	let html = "";
	try {
		html = extractHtml(file);
	} catch (error) {
		console.warn(`跳过 ${path.basename(file)}：${error.message}`);
		continue;
	}
	for (const match of html.matchAll(/https?:\/\/[^"'\s>]+\.css[^"'\s>]*/g)) {
		// 只认"路径最后一段就是 .css"的地址，避免把奇奇怪怪的长串当成样式表
		const name = path.basename(match[0].split("?")[0]);
		if (/\.css$/i.test(name)) urls.add(match[0]);
	}
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`快照 ${samples.length} 份，引用样式表 ${urls.size} 个 → ${OUT_DIR}`);

let ok = 0;
let failed = 0;
for (const url of urls) {
	const file = path.join(OUT_DIR, path.basename(url.split("?")[0]));
	if (fs.existsSync(file)) {
		ok += 1;
		continue;
	}
	try {
		const response = await fetch(url, {
			headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
		ok += 1;
		console.log(`  已缓存 ${path.basename(file)}`);
	} catch (error) {
		failed += 1;
		console.warn(`  抓取失败 ${url}：${error?.message ?? error}`);
	}
}

console.log(
	failed
		? `完成：${ok} 个可用、${failed} 个失败（失败的那些在测试里会退回原地址）`
		: `完成：${ok} 个样式表已就绪`,
);
