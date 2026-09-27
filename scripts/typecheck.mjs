/**
 * 类型检查：`tsc --noEmit`。
 *
 * 本工程刻意不重复安装依赖（见 README 的「构建」一节），TypeScript 也从上游 eztb 的
 * node_modules 借——和构建、测试用的是同一个 `EZTB_ROOT`（见 scripts/shims-plugin.mjs）。
 *
 * 配置在项目根目录的 `tsconfig.json`：它里面的 `paths` 必须与 `shims-plugin.mjs` 的别名
 * 一一对应（`tieba.js` / `tieba.js/generated/*` / `eztb-internal/*` / `effect`）。
 * 这也是为什么值得单独跑一次：esbuild 只做解析不做类型检查，别名写错时产物照样能打出来。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_EZTB_ROOT } from "./shims-plugin.mjs";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const eztbRoot = process.env.EZTB_ROOT ?? DEFAULT_EZTB_ROOT;
const tsc = path.join(eztbRoot, "node_modules/typescript/bin/tsc");

if (!fs.existsSync(tsc)) {
	console.error(
		`找不到 TypeScript：${tsc}\n` +
			"请确认上游 eztb 仓库已装好依赖，或用 EZTB_ROOT 指向装了 typescript 的目录。",
	);
	process.exit(1);
}

const result = spawnSync(
	process.execPath,
	[tsc, "-p", path.join(projectRoot, "tsconfig.json"), "--noEmit"],
	{ cwd: projectRoot, stdio: "inherit" },
);
if (result.status === 0) console.log("类型检查通过。");
process.exit(result.status ?? 1);
