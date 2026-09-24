/**
 * 把 tieba.js（eztb 的 SDK）打包进单个油猴脚本。
 *
 * 做法：不改动 SDK 源码，只用 esbuild 的解析钩子把 4 个 Node 专属依赖
 * 替换成本工程里的浏览器实现，然后把产物内联进 .user.js。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
	createShimPlugin,
	DEFAULT_EZTB_ROOT,
} from "./scripts/shims-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** eztb 仓库根目录，可用环境变量覆盖 */
const EZTB_ROOT = process.env.EZTB_ROOT ?? DEFAULT_EZTB_ROOT;

const OUT_DIR = path.join(__dirname, "dist");
/**
 * 默认产出**未压缩**的版本：油猴编辑器里能正常换行缩进，贴吧用户/Greasy Fork
 * 审核也能读懂。要小体积时再加 `--minify`，那条路径写的是另一个文件名，
 * 不会覆盖可读版。
 */
const MINIFY = process.argv.includes("--minify");
const OUT_FILE = path.join(
	OUT_DIR,
	MINIFY ? "tieba-eztb-toolbox.min.user.js" : "tieba-eztb-toolbox.user.js",
);

const pkg = JSON.parse(
	fs.readFileSync(path.join(__dirname, "package.json"), "utf8"),
);

/**
 * 元数据块。按 Greasy Fork 的元信息字段要求生成
 * （https://greasyfork.org/zh-CN/help/meta-keys）：
 *   - @name / @description 是必填项，且"名称和描述必须标好语言"，所以各给一份 :zh-CN
 *   - @namespace + @name 是脚本的唯一标识，改任意一个都会让已装用户收到"换了个脚本"的警告，
 *     所以这里可以覆盖但要稳定：用 EZTB_NAMESPACE 指定成你自己的主页/GitHub 之类
 *   - 至少一个 @match；不要加不提供功能的站点
 *   - @license 用 SPDX 标识符
 *   - @updateURL/@downloadURL 不要自己写，Greasy Fork 会改成它自己的地址
 */
const NAME = process.env.EZTB_NAME ?? "贴吧 eztb 工具箱（本地直连版）";
/**
 * 下面三个默认值是**本仓库**（github.com/Dan12elion/tieba_extensions）的身份。
 * fork / 二次分发的人请用环境变量覆盖，别把新脚本挂在这个 namespace 下：
 *   EZTB_NAMESPACE / EZTB_AUTHOR / EZTB_SUPPORT_URL
 */
const NAMESPACE =
	process.env.EZTB_NAMESPACE ??
	"https://github.com/Dan12elion/tieba_extensions";
const AUTHOR = process.env.EZTB_AUTHOR ?? "Dan12elion";
const SUPPORT_URL =
	process.env.EZTB_SUPPORT_URL ??
	"https://github.com/Dan12elion/tieba_extensions/issues";
const DESCRIPTION =
	process.env.EZTB_DESCRIPTION ??
	"在贴吧页面上给每个用户名加一个 eztb 按钮，点开查看该用户的资料 / 关注的人 / 关注的吧 / 粉丝 / 发帖（只读）；还可以配置关键词规则（关注的吧与发帖内容），让命中的用户在用户名旁被标注出来。数据由脚本内置的 SDK 直连贴吧接口获取，不经过任何第三方服务；使用前需要自己粘贴 BDUSS。";

/** 键名最长的 @description:zh-CN 是 18 字符，留一列空格，值从第 20 列开始 */
const metaLine = (key, value) => `// @${key.padEnd(20)}${value}`;

const META = `// ==UserScript==
${[
	metaLine("name", NAME),
	metaLine("name:zh-CN", NAME),
	...(AUTHOR ? [metaLine("author", AUTHOR)] : []),
	metaLine("namespace", NAMESPACE),
	metaLine("version", pkg.version),
	metaLine("description", DESCRIPTION),
	metaLine("description:zh-CN", DESCRIPTION),
	metaLine("match", "*://tieba.baidu.com/*"),
	metaLine("match", "*://*.tieba.baidu.com/*"),
	metaLine("run-at", "document-idle"),
	metaLine("grant", "GM_xmlhttpRequest"),
	metaLine("grant", "GM_getValue"),
	metaLine("grant", "GM_setValue"),
	metaLine("grant", "GM_registerMenuCommand"),
	metaLine("connect", "tiebac.baidu.com"),
	metaLine("compatible", "chrome"),
	metaLine("compatible", "edge"),
	metaLine("incompatible", "firefox"),
	metaLine("license", "MIT"),
	...(SUPPORT_URL ? [metaLine("supportURL", SUPPORT_URL)] : []),
].join("\n")}
// ==/UserScript==
`;

/** 产物说明：告诉读者这是构建出来的文件、源码在哪。 */
const HEADER = `// ---------------------------------------------------------------------------
// 本文件是构建产物，请不要直接在这里改代码（下次构建会覆盖）。
// 源码与构建脚本：scripts/ 与 src/ 目录，构建命令 node build.mjs
// 产物里打包了第三方代码，清单与许可见文件末尾的 NOTICE。
// 本脚本只做只读查询，所有数据由脚本直连 tiebac.baidu.com。
// ---------------------------------------------------------------------------
`;

/**
 * 文件末尾的第三方代码说明。
 *
 * 依赖的 dist 里没有 license banner，所以 esbuild 的 legalComments 收集不到东西，
 * 这段是手写的（版本号来自各包的 package.json，改依赖时跟着改）。
 */
const NOTICE = `
/* ===========================================================================
 * NOTICE · 本文件打包进来的第三方代码
 *
 * 这不是 @require 进来的外部脚本，而是构建时打包进来的库（见 src/ 与 build.mjs）。
 * 按 Greasy Fork 的规定，内嵌的库要写明来源、名称与版本：
 *
 *   tieba.js SDK（v3 分支）
 *       来源  https://github.com/Dilettante258/tieba-toolbox  的 packages/sdk
 *       该仓库与 packages/sdk 都没有 LICENSE 文件，也未声明 license 字段；
 *       对外分发（包括上传到脚本站）之前请先向上游确认授权。
 *   effect 3.19.18
 *       许可  MIT                            来源  https://github.com/Effect-TS/effect
 *   @bufbuild/protobuf 2.11.0
 *       许可  Apache-2.0 AND BSD-3-Clause     来源  https://github.com/bufbuild/protobuf-es
 *   long 5.3.2
 *       许可  Apache-2.0                     来源  https://github.com/dcodeIO/long.js
 *
 * 本工程自己的代码按上面的 @license 发布。
 * =========================================================================== */
`;

/** SDK 里 core/http.ts 有一处 Buffer.from()，浏览器下退化为透传即可 */
const BANNER = `/* eslint-disable */
// 全局 Buffer 垫片：整个 SDK 只有 core/http.ts 用了一次 Buffer.from()，
// 浏览器里退化成原样返回即可。
(() => {
	const g = typeof globalThis !== "undefined" ? globalThis : self;
	if (!g.Buffer) {
		g.Buffer = { from: (value) => value };
	}
})();
`;

function loadEsbuild() {
	const require = createRequire(import.meta.url);
	const candidates = [
		path.join(__dirname, "node_modules/esbuild"),
		path.join(EZTB_ROOT, "node_modules/esbuild"),
	];
	for (const candidate of candidates) {
		try {
			return require(candidate);
		} catch {
			/* 继续尝试下一个 */
		}
	}
	throw new Error(
		`找不到 esbuild。请在本工程执行 bun install，或确认 ${EZTB_ROOT}/node_modules/esbuild 存在。`,
	);
}

async function main() {
	const watch = process.argv.includes("--watch");
	const esbuild = loadEsbuild();
	const shimPlugin = createShimPlugin({ projectRoot: __dirname, eztbRoot: EZTB_ROOT });

	const options = {
		entryPoints: [path.join(__dirname, "src/main.ts")],
		bundle: true,
		format: "iife",
		platform: "browser",
		target: ["es2020"],
		// 依赖（effect / @bufbuild/protobuf / long）装在 eztb 仓库里，
		// 本工程刻意不重复安装，交给 esbuild 的 nodePaths 解析。
		nodePaths: [path.join(EZTB_ROOT, "node_modules")],
		// 默认不压缩：产物要在油猴编辑器里读、要过 Greasy Fork 的人工审核。
		// 想压成一行用 `node build.mjs --minify`（写到另一个文件名）。
		minify: MINIFY,
		charset: "utf8",
		// 默认（eof）会把第三方许可注释收在文件末尾，对外分发时需要它们
		legalComments: "eof",
		write: false,
		banner: { js: BANNER },
		plugins: [shimPlugin],
		logLevel: "info",
	};

	if (watch) {
		const context = await esbuild.context({
			...options,
			plugins: [
				shimPlugin,
				{
					name: "emit-userscript",
					setup(build) {
						build.onEnd(async (result) => {
							if (result.errors.length) return;
							writeOutput(result.outputFiles[0].text);
						});
					},
				},
			],
		});
		await context.watch();
		console.log("watch 模式已启动");
		return;
	}

	const result = await esbuild.build(options);
	const code = result.outputFiles[0].text;
	const bytes = writeOutput(code);
	console.log(
		`已生成 ${path.relative(__dirname, OUT_FILE)}（${MINIFY ? "压缩版" : "可读版"}，${(bytes / 1024).toFixed(1)} KB）`,
	);
}

function writeOutput(code) {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(OUT_FILE, `${META}\n${HEADER}\n${code}\n${NOTICE}`, "utf8");
	return Buffer.byteLength(code, "utf8");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
