/**
 * 共享的 esbuild 解析策略：把 SDK 依赖的 Node 专属模块换成浏览器实现。
 * build.mjs 与 scripts/verify.mjs 都用它，保证「打包的」和「验证的」是同一套规则。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 上游 eztb 仓库的位置。
 *
 * 默认取**与本项目同级的 `../eztb`**（本工程刻意不重复安装依赖，直接用上游的
 * node_modules 与 packages/sdk），可用 `EZTB_ROOT` 环境变量覆盖。
 */
export const DEFAULT_EZTB_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"eztb",
);

export function resolveSdkEntry(eztbRoot) {
	const fromSource = path.join(eztbRoot, "packages/sdk/src/index.ts");
	if (fs.existsSync(fromSource)) return fromSource;
	return path.join(eztbRoot, "packages/sdk/dist/index.js");
}

export function createReplacementMap({ projectRoot, eztbRoot, extra }) {
	const base = new Map([
		["undici", path.join(projectRoot, "src/shims/undici.ts")],
		["node:crypto", path.join(projectRoot, "src/shims/md5.ts")],
		["crypto", path.join(projectRoot, "src/shims/md5.ts")],
		["node-html-parser", path.join(projectRoot, "src/shims/html.ts")],
		["tieba.js", resolveSdkEntry(eztbRoot)],
		// SDK 没有暴露 UserPost 的编解码器：取「主题帖」必须用 is_thread=1，
		// 而 is_thread 只有通过编解码器才能传进去，所以直接引用生成的代码。
		[
			"tieba.js/generated/UserPostReqIdl",
			path.join(eztbRoot, "packages/sdk/src/generated/UserPostReqIdl.ts"),
		],
		[
			"tieba.js/generated/UserPostResIdl",
			path.join(eztbRoot, "packages/sdk/src/generated/UserPostResIdl.ts"),
		],
	]);
	// 探查脚本用：直接引用 SDK 内部的生成代码，生产打包不会用到
	for (const [key, value] of extra ?? []) {
		base.set(key, value);
	}
	return base;
}

export function createShimPlugin(options) {
	const replacements = createReplacementMap(options);
	return {
		name: "eztb-node-shims",
		setup(build) {
			build.onResolve({ filter: /.*/ }, (args) => {
				const target = replacements.get(args.path);
				return target ? { path: target } : null;
			});
		},
	};
}
