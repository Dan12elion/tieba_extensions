/**
 * 版本一致性检查。
 *
 * 存在的理由：这个仓库的**产物是提交进仓库的**（README 的 raw 安装链接指着它），
 * 而「同名同版本号用户收不到更新」这条规则以前只写在文档里靠人记
 * （1.7.1 就是因为 1.7.0 推上去后又改过产物才补提的版本，见 HANDOFF §5 #31）。
 * 这里把三处版本号钉在一起：
 *   1. `package.json` 的 version —— 构建时会被抄进产物元数据，是唯一来源；
 *   2. 产物里的 `@version`；
 *   3. `CHANGELOG.md` 的条目。
 * 外加一条提醒：本仓库给自己的 tag 应该是 `v<version>`。
 *
 * 用法：node scripts/version.mjs [--allow-unreleased]
 *   `--allow-unreleased`：还没给当前版本建档时只提醒、不报错（开发过程中用）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const allowUnreleased = process.argv.includes("--allow-unreleased");

let failures = 0;
let warnings = 0;

function check(label, ok, detail = "") {
	if (ok) {
		console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
	} else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

function warn(label) {
	warnings += 1;
	console.log(`  WARN  ${label}`);
}

const pkg = JSON.parse(
	fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const version = String(pkg.version ?? "").trim();
console.log(`版本一致性检查（package.json = ${version}）`);

check("package.json 有 version", /^\d+\.\d+\.\d+$/.test(version), version);

// ── 1. 产物里的 @version ────────────────────────────────────────────────
const bundle = path.join(projectRoot, "dist/tieba-eztb-toolbox.user.js");
if (!fs.existsSync(bundle)) {
	check("产物存在", false, bundle);
} else {
	const code = fs.readFileSync(bundle, "utf8");
	const matched = code.match(/^\/\/ @version\s+(\S+)$/m);
	check(
		"产物的 @version 与 package.json 一致",
		matched?.[1] === version,
		`产物=${matched?.[1] ?? "(没找到)"} package.json=${version}`,
	);
}

// ── 2. CHANGELOG 条目 ──────────────────────────────────────────────────
const changelogPath = path.join(projectRoot, "CHANGELOG.md");
if (!fs.existsSync(changelogPath)) {
	check("CHANGELOG.md 存在", false, changelogPath);
} else {
	const changelog = fs.readFileSync(changelogPath, "utf8");
	const hasCurrent = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(
		changelog,
	);
	const hasUnreleased = /^## \[Unreleased\]/m.test(changelog);
	if (hasCurrent) {
		check(`CHANGELOG 里有 ${version} 的条目`, true);
	} else if (hasUnreleased) {
		if (allowUnreleased) {
			warn(`CHANGELOG 里还没有 ${version} 的条目（当前只有 [Unreleased]，发布时把它改成 [${version}]）`);
		} else {
			check(
				`CHANGELOG 里有 ${version} 的条目`,
				false,
				"把顶部的 [Unreleased] 改成 [版本号] - 日期，或加一节",
			);
		}
	} else {
		check(`CHANGELOG 里有 ${version} 的条目`, false, "既没有该版本、也没有 [Unreleased] 一节");
	}
}

// ── 3. git tag（没有 tag 只提醒：打 tag 是发布动作）──────────────────────
try {
	const tags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
		cwd: projectRoot,
		encoding: "utf8",
	})
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!tags.length) {
		warn(`HEAD 上没有 tag（发布时该打 v${version}）`);
	} else {
		check(
			`HEAD 上的 tag 与版本号一致`,
			tags.includes(`v${version}`),
			`tag=${tags.join(",")} 版本=v${version}`,
		);
	}
} catch {
	warn("读不到 git tag（不在 git 仓库里？）");
}

if (failures) {
	console.error(`\n版本一致性检查失败：${failures} 项。`);
	process.exit(1);
}
console.log(`\n版本一致${warnings ? `（${warnings} 条提醒）` : ""}。`);
