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
import { buildNotice, collectEmbeddedDeps } from "./scripts/deps-info.mjs";

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
const NAME = process.env.EZTB_NAME ?? "贴吧 eztb 工具箱";
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
	"在贴吧页面上给每个用户名加一个「查询」按钮，点开查看该用户的资料 / 关注的人 / 关注的吧 / 粉丝 / 发帖（只读）；还可以配置关键词规则（关注的吧与发帖内容），让命中的用户在用户名旁被标注出来。数据由脚本内置的 SDK 直连贴吧接口获取，不经过任何第三方服务；使用前需要自己粘贴 BDUSS。";

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
	// 「校验 BDUSS」要问贴吧自己的「我是谁」端点（/f/user/json_userinfo）。
	// 大多数情况下它与页面同源、不需要跨域授权，但显式声明后，
	// 在非同源页面（测试页、快照页）上也能正常工作。
	metaLine("connect", "tieba.baidu.com"),
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
 * 产物末尾的第三方代码说明。构建时由 scripts/deps-info.mjs 从磁盘上的
 * package.json 与 git 生成（旧版本是手写常量，来源 URL 与许可都写错过）。
 */
let NOTICE = "";

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

	// 内嵌依赖的版本 / 许可 / 提交号：从磁盘上的 package.json 与 git 读出，
	// 并和仓库里的 sdk.lock.json 比对。对不上就停下——产物里写的"内嵌的是哪一版"
	// 必须是能被验证的，而不是靠人记得更新注释。
	const deps = collectEmbeddedDeps({ projectRoot: __dirname, eztbRoot: EZTB_ROOT });
	if (deps.problems.length) {
		console.error("内嵌依赖自检未通过，已停止构建：");
		for (const problem of deps.problems) {
			console.error(`  - ${problem}`);
		}
		console.error(
			"确认上游更新没问题后，更新 sdk.lock.json，再重新构建（并复跑 verify）。",
		);
		process.exit(1);
	}
	NOTICE = buildNotice(deps);

	const options = {
		entryPoints: [path.join(__dirname, "src/main.ts")],
		bundle: true,
		format: "iife",
		platform: "browser",
		target: ["es2020"],
		// 显式固定工作目录：esbuild 给每个模块加的那行 `// <路径>` 注释是按它算的，
		// 不固定的话同一份源码在不同 cwd 下会构建出不同的产物（见 stabilizeModuleComments）。
		absWorkingDir: __dirname,
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
		// 把版本号编译进产物：诊断报告要写出"这份报告是哪个版本给的"，
		// 否则用户报障时我们连他装的是哪一版都不知道（元数据在运行期读不到，
		// 拿它得申请 GM_info 权限，不值得）。
		define: {
			__EZTB_VERSION__: JSON.stringify(pkg.version),
		},
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
	fs.writeFileSync(
		OUT_FILE,
		`${META}\n${HEADER}\n${stabilizeModuleComments(code)}\n${NOTICE}`,
		"utf8",
	);
	return Buffer.byteLength(code, "utf8");
}

/**
 * 把 esbuild 的 `// <路径>` 模块注释换成与机器无关的写法。
 *
 * 为什么必须做：这行注释按 `absWorkingDir` 算相对路径，落在它**之外**的模块
 * 会写成相对路径，跨盘/跨根路径时甚至写成绝对路径：本机是 `../eztb/node_modules/...`，
 * 工程比上游深一层就是 `../../eztb/...`，CI 里可能是 `/home/runner/work/.../eztb/...`。
 * 于是"同一份源码构建出的产物"在两台机器上逐字符对不上，CI 里那条
 * `git diff --exit-code -- dist`（用来拦"改了源码忘了重建产物"）会永远失败，
 * 而不是真的发现了忘重建。
 *
 * 实测（2026-09-28）：工程与上游同为兄弟目录时产物逐字节相同（sha256 一致）；
 * 把工程挪深一层，产物行数不变、逻辑不变，但有 306 行注释不同——就是下面这两条规则
 * 覆盖的那部分。收敛之后，产物与目录布局无关。
 */
function stabilizeModuleComments(code) {
	const posix = (p) => p.replace(/\\/g, "/");
	return code
		// 上游 SDK：不管前缀是绝对路径还是 ../eztb，都收敛成同一个记号
		// （模块注释在 IIFE 里有缩进，所以不能只用 `^//` 锚定）
		.replace(/^(\s*)\/\/ .*?packages\/sdk\//gm, "$1// <eztb>/packages/sdk/")
		// 内嵌的第三方库（effect / @bufbuild/protobuf / long 等）同理会带上
		// `../eztb/node_modules/` 或绝对前缀，一并收敛（node_modules 以下保留，
		// 这样还能看出具体是哪个文件被打了进来）
		.replace(/^(\s*)\/\/ .*?node_modules\//gm, "$1// <eztb>/node_modules/")
		.split(posix(__dirname))
		.join("<root>")
		.split(posix(EZTB_ROOT))
		.join("<eztb>");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
