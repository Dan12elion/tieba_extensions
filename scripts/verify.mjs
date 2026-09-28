/**
 * 自动校验：
 *   V5  浏览器版 MD5 与 Node 原生 MD5 逐字符一致
 *   V5  浏览器版 packRequest 签名与 Node 版逐字符一致
 *   V3  产物存在、以油猴元数据块开头、没有残留的 Node 依赖
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createShimPlugin, DEFAULT_EZTB_ROOT } from "./shims-plugin.mjs";
import { collectEmbeddedDeps } from "./deps-info.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const eztbRoot = process.env.EZTB_ROOT ?? DEFAULT_EZTB_ROOT;

/** 可用 EZTB_BUNDLE 指向别的产物（例如压缩版）做反向验证 */
const bundlePath =
	process.env.EZTB_BUNDLE ??
	path.join(projectRoot, "dist/tieba-eztb-toolbox.user.js");

const require = createRequire(import.meta.url);
const esbuild = require(path.join(eztbRoot, "node_modules/esbuild"));

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

const MD5_SAMPLES = [
	"",
	"a",
	"abc",
	"message digest",
	"12345678901234567890123456789012345678901234567890123456789012345678901234567890",
	"uid=5482451341page=1",
	"tiebaclient!!!",
	"测试吧",
	"昵称·带符号 & 空格",
	"BDUSS=abcdefghijklmnopqrstuvwxyz0123456789",
];

const PACK_CASES = [
	{ uid: "5482451341", page: "1" },
	{ kw: "测试吧", pn: "2", ie: "utf-8" },
	{ friend_uid: "0", page_no: "1", page_size: "400" },
	{ uid: "1", pn: "1", tbs: "abcdef0123456789" },
	{ un: "tb.1.21833ce7.3TP6snFkrIeal86OXomTxA", ie: "utf-8" },
	{ word: "百度", pn: "3" },
];

async function bundle(entry, outFile) {
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: ["es2020"],
		outfile: outFile,
		nodePaths: [path.join(eztbRoot, "node_modules")],
		plugins: [createShimPlugin({ projectRoot, eztbRoot })],
		logLevel: "silent",
	});
}

/** 用 Node 原生 crypto 复刻一份 packRequest，作为对照真值。 */
function nodePackRequest(data, bduss) {
	const params = new URLSearchParams(data);
	if (!params.has("BDUSS")) params.append("BDUSS", bduss);
	if (!params.has("_client_version")) {
		params.append("_client_version", "12.57.4.2");
	}
	if (!params.has("pn")) params.append("pn", params.get("page") || "1");
	params.delete("page");
	params.sort();
	const joined = Array.from(params.entries())
		.map((entry) => entry.join("="))
		.join("");
	const sign = createHash("md5")
		.update(`${joined}tiebaclient!!!`)
		.digest("hex")
		.toUpperCase();
	params.append("sign", sign);
	return Array.from(params.entries())
		.map((entry) => entry.join("="))
		.join("&");
}

async function verifySignatures() {
	console.log("V5 · 签名实现比对");
	const outDir = path.join(projectRoot, "dist/.verify");
	fs.mkdirSync(outDir, { recursive: true });

	const md5Out = path.join(outDir, "md5.browser.mjs");
	await bundle(path.join(projectRoot, "src/shims/md5.ts"), md5Out);
	const { md5Hex } = await import(pathToFileURL(md5Out).href);

	for (const sample of MD5_SAMPLES) {
		const expected = createHash("md5").update(sample).digest("hex");
		const actual = md5Hex(sample);
		check(
			`md5(${JSON.stringify(sample.slice(0, 20))})`,
			actual === expected,
			`${actual} != ${expected}`,
		);
	}

	const authOut = path.join(outDir, "auth.browser.mjs");
	await bundle(path.join(eztbRoot, "packages/sdk/src/core/auth.ts"), authOut);
	const { packRequest } = await import(pathToFileURL(authOut).href);

	const bduss = "TEST_BDUSS_0123456789";
	for (const [index, params] of PACK_CASES.entries()) {
		const expected = nodePackRequest(params, bduss);
		const actual = packRequest(params, bduss);
		check(
			`packRequest #${index + 1} (${Object.keys(params).join(",")})`,
			actual === expected,
			`\n      浏览器: ${actual}\n      Node  : ${expected}`,
		);
	}
}

function verifyBundle() {
	console.log("V3 · 产物检查");
	const outFile = bundlePath;
	if (!fs.existsSync(outFile)) {
		check("产物存在", false, outFile);
		return;
	}
	const code = fs.readFileSync(outFile, "utf8");
	check("产物存在", true);
	check("以油猴元数据块开头", code.startsWith("// ==UserScript=="));
	check("@connect tiebac.baidu.com 已声明", /^\/\/ @connect\s+tiebac\.baidu\.com$/m.test(code));
	check("不含 eztb.org 域名", !code.includes("eztb.org"));
	check("Buffer 垫片已注入", code.includes("Buffer"));
	for (const forbidden of [
		'require("undici")',
		'from"undici"',
		"node-html-parser",
		'"node:crypto"',
	]) {
		check(`无残留 Node 依赖：${forbidden}`, !code.includes(forbidden));
	}
}

/**
 * V7 · Greasy Fork 的发布要求（https://greasyfork.org/zh-CN/help/code-rules 与 /help/meta-keys）
 * 这些是会被管理员删脚本的硬性条件，钉在测试里，免得以后手滑改回压缩或漏掉元数据。
 */
function verifyGreasyForkRules() {
	console.log("V7 · Greasy Fork 发布要求");
	const outFile = bundlePath;
	if (!fs.existsSync(outFile)) {
		check("产物存在", false, outFile);
		return;
	}
	const code = fs.readFileSync(outFile, "utf8");
	const lines = code.split("\n");
	const bytes = Buffer.byteLength(code, "utf8");
	const maxLine = lines.reduce((max, line) => Math.max(max, line.length), 0);

	// 「代码不得混淆或压缩……必须以非压缩的形式输出，保留空白和变量名」
	check(
		"产物是未压缩的可读形式",
		lines.length > 1000 && maxLine < 2000,
		`行数 ${lines.length} / 最长行 ${maxLine}`,
	);

	// 「脚本大小不能超过 2.0 MB」
	check(
		"体积不超过 2.0 MB",
		bytes <= 2 * 1024 * 1024,
		`${(bytes / 1024 / 1024).toFixed(2)} MB`,
	);

	// 元数据块
	const end = code.indexOf("// ==/UserScript==");
	const meta = (end < 0 ? "" : code.slice(0, end))
		.split("\n")
		.map((line) => line.match(/^\/\/ @([^\s]+)\s+(.+?)\s*$/))
		.filter(Boolean)
		.map((match) => ({ key: match[1], value: match[2] }));
	const keys = meta.map((entry) => entry.key);

	for (const required of [
		"name",
		"description",
		"namespace",
		"version",
		"license",
	]) {
		check(`元数据含必填项 @${required}`, keys.includes(required));
	}
	check(
		"至少一个 @match 或 @include",
		keys.some((key) => key === "match" || key === "include"),
	);
	// 「脚本的名称、描述和其他内容必须标好相应的语言」
	check(
		"名称与描述带语言标记",
		keys.includes("name:zh-CN") && keys.includes("description:zh-CN"),
	);
	check(
		"@license 用的是 SPDX 标识符",
		/^[A-Za-z0-9.+-]+$/.test(meta.find((e) => e.key === "license")?.value ?? ""),
		meta.find((e) => e.key === "license")?.value ?? "(无)",
	);

	/*
	 * 「如果一个库被内嵌入了脚本，那么您必须一并提供库的来源」
	 * 期望值不是写死的字符串，而是从磁盘上真实的 package.json / git 读出来的
	 * ——写死的旧清单里，SDK 的来源 URL 与许可都是错的（见 scripts/deps-info.mjs 的说明）。
	 */
	const deps = collectEmbeddedDeps({ projectRoot, eztbRoot });
	for (const problem of deps.problems) {
		check(`内嵌依赖自检：${problem}`, false);
	}
	for (const source of [deps.sdk.url, ...deps.libs.map((lib) => lib.url)]) {
		check(`内嵌库来源已写明：${source}`, code.includes(source));
	}
	// Greasy Fork 的要求是「来源 + 名称 + 版本」，只写来源不算数。
	// 期望值同样来自磁盘上的 package.json，不是手写的字符串。
	for (const lib of [deps.sdk, ...deps.libs]) {
		check(
			`内嵌库名称与版本已写明：${lib.name} ${lib.version}`,
			code.includes(`${lib.name} ${lib.version}`),
		);
	}
	// ISC 要求随副本附上版权署名；署名取自上游 package.json 的 author（见 deps-info.mjs）
	if (deps.sdk.author) {
		check(
			`内嵌库版权署名已写明：${deps.sdk.author}`,
			code.includes(`Copyright (c) ${deps.sdk.author}`),
		);
	}
	check(
		`内嵌库许可已写明：${deps.sdk.license}`,
		code.includes(deps.sdk.license),
	);
	check(
		"NOTICE 记下了锁定的 SDK 提交号",
		!deps.sdk.commit || code.includes(deps.sdk.commit),
		deps.sdk.commit ?? "(读不到提交号)",
	);
	// 上游 eztb 的检出也要写进产物：只写 SDK 的提交号，说不清"这份产物是在哪份上游上构建的"
	check(`上游 eztb 检出已写明：${deps.eztb.url}`, code.includes(deps.eztb.url));
	check(
		"NOTICE 记下了上游 eztb 的锁定提交号",
		!deps.eztb.commit || code.includes(deps.eztb.commit),
		deps.eztb.commit ?? "(读不到提交号)",
	);
	// 回归保护：旧的 NOTICE 把手写的来源写成了 tieba-toolbox（该仓库已改名）
	check("产物里没有过期的 SDK 来源写法", !code.includes("tieba-toolbox"));

	/*
	 * 深色模式的回归保护。
	 *
	 * 弹窗里的颜色统一走 --tb-eztb-* 变量，变量有两套值（亮/深）。
	 * 但只要有一处是**写死的**颜色（比如饼图底环那个 stroke="#eef0f3"），
	 * 深色模式下就没人能把它换掉——这类颜色没有别处能兜住，所以钉在这里。
	 */
	const hardcodedSvgColors =
		code.match(/(?:stroke|fill)="#[0-9a-fA-F]{3,8}"/g) ?? [];
	check(
		"SVG 颜色都走 CSS 变量（没有写死的 stroke/fill 色值，深色模式才换得掉）",
		hardcodedSvgColors.length === 0,
		hardcodedSvgColors.slice(0, 3).join(" ") || "无",
	);
}

/**
 * V8 · 源码卫生：错误提示不许绕过 core/log.ts。
 *
 * 「诊断当前页面」把日志环形缓冲的最后 20 条贴进报告，用户复制出来就能看出哪里出错。
 * 但只要有一条错误走的是裸 `console.warn`，它就进不了那个环——报告里只剩「已加载」，
 * 真正出事的那句偏偏不在。这条按源码文件扫，改坏了立刻红。
 */
function verifySourceHygiene() {
	console.log("V8 · 源码卫生");
	const srcRoot = path.join(projectRoot, "src");
	const sourceFiles = fs
		.readdirSync(srcRoot, { recursive: true })
		.map((entry) => String(entry).replace(/\\/g, "/"))
		.filter((entry) => entry.endsWith(".ts") && entry !== "core/log.ts");
	const offenders = sourceFiles.filter((entry) =>
		/(?:^|[^.\w])console\.(?:warn|error)\s*\(/.test(
			fs.readFileSync(path.join(srcRoot, entry), "utf8"),
		),
	);
	check(
		"错误提示统一走 core/log.ts（源码里没有绕过它的 console.warn/error）",
		offenders.length === 0,
		offenders.join(" ") || `扫了 ${sourceFiles.length} 个文件`,
	);
}

async function main() {
	await verifySignatures();
	verifyBundle();
	verifyGreasyForkRules();
	verifySourceHygiene();
	console.log(failures === 0 ? "\n全部通过。" : `\n${failures} 项未通过。`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
