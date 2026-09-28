/**
 * 收集「打包进产物的第三方代码」的真实信息，并用 sdk.lock.json 卡住版本。
 *
 * 以前产物末尾的 NOTICE 是一段手写的常量：来源 URL 会过期（写的是
 * `tieba-toolbox`，那个仓库后来改名了）、SDK 版本号会过期、license 甚至写错过
 * （写的是"未声明"，实际 `package.json` 里写着 ISC）。
 *
 * 现在一律从磁盘上真实存在的文件里读：
 *   - SDK 的 name / version / license / repository ← packages/sdk/package.json
 *   - SDK 的提交号                                ← git rev-parse HEAD
 *   - 其余三个库的版本与许可                      ← node_modules/<pkg>/package.json
 * 并且和仓库里的 sdk.lock.json 比对，对不上就让构建失败——这样"内嵌的是哪一版"
 * 在产物里是能被验证的，而不是靠人记得更新注释。
 *
 * 锁的两层：`sdk` 段锁内嵌的 SDK，`eztb` 段锁**构建它的那一份上游检出**。
 * 只锁 SDK 是不够的：CI 要 clone 上游才能构建，而 v3 分支的尖端会移动
 * （它的 packages/sdk 指针也跟着移动），拿尖端构建出的产物与仓库里提交的
 * 那份对不上，`git diff --exit-code -- dist` 就会误报"忘了重建产物"。
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** 除 SDK 外内嵌的库：目录名（也是 NOTICE 里的显示名）与来源仓库 */
const EMBEDDED_LIBS = [
	{ dir: "effect", name: "effect", url: "https://github.com/Effect-TS/effect" },
	{
		dir: "@bufbuild/protobuf",
		name: "@bufbuild/protobuf",
		url: "https://github.com/bufbuild/protobuf-es",
	},
	{ dir: "long", name: "long", url: "https://github.com/dcodeIO/long.js" },
];

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

/** 读 submodule 当前的提交号；拿不到（比如不是 git 检出）返回 null */
function readGitCommit(dir) {
	try {
		return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

/** package.json 的 author 允许写成字符串或 `{ name }` 对象，统一取成字符串 */
function readAuthor(pkg) {
	const raw = pkg?.author;
	if (typeof raw === "string" && raw.trim()) return raw.trim();
	if (raw && typeof raw === "object" && typeof raw.name === "string") {
		return raw.name.trim() || null;
	}
	return null;
}

/**
 * @returns {{
 *   sdk: { name: string, version: string, license: string, url: string, commit: string|null },
 *   eztb: { url: string, branch: string, commit: string|null },
 *   libs: Array<{ name: string, version: string, license: string, url: string }>,
 *   lock: object|null,
 *   problems: string[],
 * }}
 */
export function collectEmbeddedDeps({ projectRoot, eztbRoot }) {
	const problems = [];
	const sdkDir = path.join(eztbRoot, "packages", "sdk");
	const lockPath = path.join(projectRoot, "sdk.lock.json");

	const lock = readJson(lockPath);
	if (!lock) problems.push(`读不到或解析不了 ${lockPath}`);
	const lockSdk = lock?.sdk ?? null;
	const lockEztb = lock?.eztb ?? null;
	if (lock && !lockSdk) {
		problems.push("sdk.lock.json 里没有 sdk 段（记内嵌 SDK 的版本 / 许可 / 提交号）");
	}
	if (lock && !lockEztb) {
		problems.push("sdk.lock.json 里没有 eztb 段（记构建时用的那份上游检出）");
	}

	const sdkPkg = readJson(path.join(sdkDir, "package.json"));
	if (!sdkPkg) problems.push(`读不到 ${path.join(sdkDir, "package.json")}`);

	const sdk = {
		name: sdkPkg?.name ?? "tieba.js",
		version: sdkPkg?.version ?? "(未知)",
		license: sdkPkg?.license ?? "(未声明)",
		url: lockSdk?.repository ?? sdkPkg?.repository?.url ?? "(未知)",
		commit: readGitCommit(sdkDir),
		author: readAuthor(sdkPkg),
	};

	// 上游 eztb 的检出本身也要锁：CI 按它检出上游，本地构建也应当是同一份
	const eztb = {
		url: lockEztb?.repository ?? "(未知)",
		branch: lockEztb?.branch ?? "(未知)",
		commit: readGitCommit(eztbRoot),
	};

	if (lockSdk) {
		if (lockSdk.version && lockSdk.version !== sdk.version) {
			problems.push(
				`sdk.lock.json 的 sdk.version 是 ${lockSdk.version}，实际 packages/sdk 是 ${sdk.version}`,
			);
		}
		if (lockSdk.commit && sdk.commit && lockSdk.commit !== sdk.commit) {
			problems.push(
				`sdk.lock.json 的 sdk.commit 是 ${lockSdk.commit.slice(0, 7)}，实际是 ${sdk.commit.slice(0, 7)}` +
					"（上游更新过？确认没问题后更新 sdk.lock.json 并复跑 verify）",
			);
		}
		if (lockSdk.license && sdk.license && lockSdk.license !== sdk.license) {
			problems.push(
				`sdk.lock.json 的 sdk.license 是 ${lockSdk.license}，实际是 ${sdk.license}`,
			);
		}
		if (!lockSdk.commit) {
			problems.push("sdk.lock.json 的 sdk.commit 缺失，锁定不了内嵌的是哪一版");
		}
	} else if (!sdk.commit) {
		problems.push("既没有 sdk.lock.json，也读不到 SDK 的提交号");
	}

	if (lockEztb) {
		if (lockEztb.commit && eztb.commit && lockEztb.commit !== eztb.commit) {
			problems.push(
				`sdk.lock.json 的 eztb.commit 是 ${lockEztb.commit.slice(0, 7)}，实际检出是 ${eztb.commit.slice(0, 7)}` +
					"（上游更新过？确认没问题后更新 sdk.lock.json、重新构建产物，CI 也按这个提交检出上游）",
			);
		}
		if (!lockEztb.commit) {
			problems.push(
				"sdk.lock.json 的 eztb.commit 缺失：CI 没法检出同一份上游，产物也就复现不出来",
			);
		}
	}

	const libs = [];
	for (const lib of EMBEDDED_LIBS) {
		const pkg = readJson(
			path.join(eztbRoot, "node_modules", lib.dir, "package.json"),
		);
		if (!pkg) {
			problems.push(`读不到内嵌库 ${lib.dir} 的 package.json`);
			continue;
		}
		libs.push({
			name: lib.name,
			version: pkg.version ?? "(未知)",
			license: pkg.license ?? "(未声明)",
			url: lib.url,
		});
	}

	return { sdk, eztb, libs, lock, problems };
}

/** ISC 要求随副本附带许可文本；上游没有 LICENSE 文件，这里按 package.json 的声明补一份 */
function iscNotice(sdk) {
	const holder =
		sdk.author ?? "(版权人未在 package.json 的 author 字段声明，需向上游确认)";
	return [
		" *       依上游 package.json 的 license 字段声明为 ISC。该仓库暂未附带 LICENSE 文件，",
		` *       这里按 ISC 模板补一份（版权人取自 package.json 的 author：${holder}）：`,
		" *",
		` *         Copyright (c) ${holder}`,
		" *         Permission to use, copy, modify, and/or distribute this software for any",
		" *         purpose with or without fee is hereby granted, provided that the above",
		" *         copyright notice and this permission notice appear in all copies.",
		" *         THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES",
		" *         WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF",
		" *         MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR",
		" *         ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES",
		" *         WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN",
		" *         ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF",
		" *         OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.",
		" *",
		" *       建议仍向上游要一份正式 LICENSE 文件。",
	];
}

/** 生成产物末尾的 NOTICE 文本 */
export function buildNotice({ sdk, eztb, libs }) {
	const lines = [
		"/* ===========================================================================",
		" * NOTICE · 本文件打包进来的第三方代码",
		" *",
		" * 这不是 @require 进来的外部脚本，而是构建时打包进来的库（见 src/ 与 build.mjs）。",
		" * 按 Greasy Fork 的规定，内嵌的库要写明来源、名称与版本。",
		" * 下面这份清单由 scripts/deps-info.mjs 在构建时从磁盘上的 package.json 与 git 读出，",
		" * 不是手写的，所以不会随着上游更新而失真。",
		" *",
		` *   ${sdk.name} ${sdk.version} · 许可 ${sdk.license}`,
		` *       来源  ${sdk.url}`,
		` *       锁定提交  ${sdk.commit ?? "(未知，不是 git 检出)"}`,
		...iscNotice(sdk),
	];
	if (eztb?.commit != null || eztb?.url) {
		lines.push(
			` *   上游 eztb ${eztb.branch ?? ""} · 构建时用的那一份检出（见 sdk.lock.json）`,
			` *       来源  ${eztb.url}`,
			` *       锁定提交  ${eztb.commit ?? "(未知，不是 git 检出)"}`,
		);
	}
	for (const lib of libs) {
		lines.push(` *   ${lib.name} ${lib.version} · 许可 ${lib.license}`);
		lines.push(` *       来源  ${lib.url}`);
	}
	lines.push(" *");
	lines.push(" * 本工程自己的代码按上面的 @license 发布。");
	lines.push(" * =========================================================================== */", "");
	return lines.join("\n");
}
