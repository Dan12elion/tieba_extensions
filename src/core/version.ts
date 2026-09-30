/**
 * 脚本版本号。
 *
 * 由 `build.mjs` 在打包时把 `package.json` 的 version 编译进来
 * （`define: { __EZTB_VERSION__: ... }`）。这样诊断报告里能写出
 * "这份报告是哪个版本给的"——元数据里的 `@version` 在运行期读不到，
 * 要读它得申请 `GM_info` 权限，为一个字符串不值得。
 *
 * 测试（keyword-test / live-test / click-test）打包源码时没有这个 define，
 * 所以这里用 `typeof` 兜底成 "dev"（`typeof 未声明变量` 不会抛错）。
 */

export const SCRIPT_VERSION: string =
	typeof __EZTB_VERSION__ === "string" && __EZTB_VERSION__
		? __EZTB_VERSION__
		: "dev";
