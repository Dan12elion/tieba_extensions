# 改动建议 · 对标同类成熟项目

> 这份文档回答一个问题：**已经做得不错的地方之外，还能抄哪些同类项目的做法。**
> 调研日期 **2026-09-28**，本仓库当时为 `main@94d0137`（v1.7.4）。
>
> 下面每一条都尽量给到"证据在哪"（本仓库的文件行号，或外部 URL）。star 数与最近提交时间
> 是当天实际查到的。**标注「未确认」的不要当成事实用。**
>
> 这是建议清单，不是承诺清单；优先级是我给的判断，可以推翻。

---

## 进度（2026-09-28 · v1.8.1）

这一轮做掉了下面这些；**没做的仍然有效，下次可以接着挑**。

| 状态 | 条目 |
|---|---|
| ✅ | §0 更正 SDK 的来源与许可（它其实是 submodule + ISC，不是"未声明"） |
| ✅ | §2.1 CI（离线三项 + 产物同步校验；真机三套走手动触发）。上游按锁文件里的提交检出，产物已做成机器无关 |
| ✅ | §2.2 `sdk.lock.json`（锁 SDK 与上游检出两层）+ NOTICE 改为构建时生成 |
| ✅ | §2.4 `@description` 文案（"eztb 按钮" → "「查询」按钮"） |
| ✅ | §3.2 抽 `core/kvCache.ts`，五份缓存收一份，存盘失败不再静默 |
| ✅ | §3.3 设置加版本/迁移 + 导入导出（BDUSS 永不进导出、永不从导入读取） |
| ✅ | §3.4 `closeOpenDialog()` 的漏监听 + `role="dialog"` / 焦点陷阱 / 还原焦点 |
| ✅ | §3.5 日志：分级 + 环形缓冲 + 用户标识脱敏 |
| ✅ | §4.1 请求取消入口（在飞登记 + 菜单/诊断面板可中断） |
| ✅ | §5 深色模式（133 处硬编码色值换成 CSS 变量）。1.8.1 补完：`postStats.ts` 里拼出来的 SVG 颜色也收进变量，并加了一整遍深色模式的自动化断言 |
| ✅ | §3.5 日志（1.8.1 补完：其余错误路径的裸 `console.warn` 全部改走 `core/log.ts`，否则诊断报告"最近的日志"永远是空的） |
| ⬜ | §2.3 发版流程：`CHANGELOG.md` / git tag / GitHub Release / 版本一致性脚本 |
| ⬜ | §3.1 `userPanel.ts`（1104 行）按页签拆分 |
| ⬜ | §3.6 MutationObserver 批处理、SPA 软导航时重置标记 |
| ⬜ | §4.2 队列的重试 / 退避 / 熔断、`errno` → 人话 |
| ⬜ | §4.3 把"按钮 pointer-events / z-index / 徽章不折行"变成诊断面板里的运行期自检 |
| ⬜ | §4.4 面板内的 BDUSS 获取步骤 + 「校验 BDUSS」 |
| ⬜ | §5 键盘可达性、共同关注、规则生态（文档 + 校验器）、issue 模板 |

> 落地时踩到并修掉的两个坑（详见 `HANDOFF.md` §5 #39 / #40）：CI 直接 clone 上游 `v3` 尖端
> 是错的（尖端指向的 SDK 提交已经和锁文件不一致），得按锁文件里的提交检出；
> 而且 esbuild 的模块路径注释（上游 SDK 与 node_modules 都有）里带着工作目录相关的路径，
> 会让产物**换个目录布局就变**。
>
> **已确认**（2026-09-28）：整条链路在 GitHub Actions 上真跑通了，`main@e3ef7ea` 的 run 全绿——
> 按锁文件的提交 SHA 取上游、`bun install --frozen-lockfile`、构建、
> `git diff --exit-code -- dist` 为空、`verify` 51 项、`keyword-test` 70 项。
> 也就是说产物**在 Linux runner 上也能逐字节重建**，不只是在本机成立。
> 下面这些是本机侧的补充验证，留着说明方法论：把工程换目录布局重建比 sha256、
> 按提交号 `fetch --depth 1`（GitHub 允许按 SHA 取）、被锁的上游提交里 `packages/sdk` 的
> gitlink 正是锁文件记的那个 SDK 提交（两层锁自洽）。
> §2.2 里我原本建议锁**每个源文件的 sha256**，实际落地用的是「版本 + 许可 + 提交号（SDK 与上游检出各一个）」——
> 提交号已经能唯一定位源码，逐文件 sha256 只是在同一提交号被篡改时才多一层，代价却是每次上游更新都要重算一遍清单，不值。

---

## 0. 先更正一个事实：SDK 的许可不是「未声明」

这条比其他所有建议都优先，因为它直接决定能不能上传 Greasy Fork，而**现有文档写错了**。

`../eztb` 的 `.gitmodules` 写着：

```
[submodule "packages/sdk"]
	path = packages/sdk
	url = https://github.com/Dilettante258/tieba.js.git
	branch = v3
```

本机 submodule checkout 是 `338a81eacf4eb326fcb3ffbfa55d46395117a2e9`，而
`../eztb/packages/sdk/package.json` 里明确写着：

```json
"name": "tieba.js", "version": "3.1.3", "license": "ISC", "author": "Dilettante258"
```

所以三处过期了：

| 位置 | 现在写的 | 实际 |
|---|---|---|
| [THIRD-PARTY.md](THIRD-PARTY.md) 第 8 / 15 行 | 「**未声明**」「没有 LICENSE 文件，也没有 license 字段」 | `license: ISC`，版本 3.1.3 |
| [build.mjs](build.mjs) 第 116–117 行（NOTICE 常量） | 来源 `github.com/Dilettante258/tieba-toolbox` | 该 URL 现在 **301 到 `eazy-tieba`**；SDK 的真实仓库是 `Dilettante258/tieba.js` |
| [scripts/verify.mjs](scripts/verify.mjs) 第 218 行 | 断言的正是上面那个旧 URL | 同上 |

**建议**：

1. 来源改成 `Dilettante258/tieba.js` + 版本号 + commit SHA（见 §2.2）。
2. NOTICE 从手写常量改为**构建时自动生成**：读 `../eztb/packages/sdk/package.json` 取
   name/version/license，读 `git -C ../eztb/packages/sdk rev-parse HEAD` 取 SHA。
   大工程是这么干的（[Bilibili-Evolved 的 `dev-tools/inject-metadata`](https://github.com/the1812/Bilibili-Evolved/tree/master/dev-tools)）。
3. 剩下唯一真正的合规缺口：**ISC 要求随副本附带许可文本**，而 `tieba.js` 仓库里没有 `LICENSE`
   文件（只有 `package.json` 里的声明）。值得给上游提个 issue 要一份，或至少在 NOTICE 里写明
   「依 `package.json` 声明为 ISC」。这一步做完，「上传 GF 卡在授权」基本解除。

---

## 1. 同类项目对照

star 数为 2026-09-28 实测（GitHub API 限流后改用仓库页面）。

| 项目 | star | 最近提交 | 做什么 | 值得抄的点 |
|---|---|---|---|---|
| [the1812/Bilibili-Evolved](https://github.com/the1812/Bilibili-Evolved) | 30,599 | 活跃 | 大型油猴脚本工程 | 组件注册表、`core/observer.ts` 的批处理与 SPA 导航处理、`core/local-storage.ts` 的分片存储、设置系统的分层与迁移、`dev-tools/pr-check` 的 PR 门禁 |
| [lumina37/aiotieba](https://github.com/lumina37/aiotieba) | 685 | 活跃 | Python 贴吧接口合集 | 最成熟的贴吧协议层：错误码语义表、重试/退避策略、接口能力的交叉验证 |
| [shitianshiwa/baidu-tieba-userscript](https://github.com/shitianshiwa/baidu-tieba-userscript) | 352 | 2019 至今 | 贴吧油猴脚本合集 | 每个小脚本一个目录 + 各自 README + 历史更新记录 + issue 模板；长期维护选择器的组织方式 |
| [0xb1aded/Tieba-Remix](https://github.com/0xb1aded/Tieba-Remix) | 349 | 活跃 | 贴吧网页端重塑（油猴 + Vue） | 多安装渠道并列（GF / GitHub / Gitee）并在 README 里写明差异；[`.github/workflows/`](https://github.com/0xb1aded/Tieba-Remix/tree/master/.github/workflows) 的 lint/format/build CI |
| [Dilettante258/eazy-tieba](https://github.com/Dilettante258/eazy-tieba) | 188 | 2026-08-27 | 上游 eztb（本项目的 SDK 来源） | 它是本项目要替代的东西；注意它**没有 LICENSE**，内嵌它要谨慎 |
| [trychen/bilibili-comment-checker](https://github.com/trychen/bilibili-comment-checker) | 73 | — | 「成分检测」油猴脚本 | 与「成分」页签同类：规则格式文档、开箱即用的规则生态 |
| [klxf/BilibiliUserChecker](https://github.com/klxf/BilibiliUserChecker) | 68 | — | 「一键查成分」 | 单一动作的入口设计，比多页签更容易被接受 |
| [Dilettante258/tieba.js](https://github.com/Dilettante258/tieba.js) | 7 | 活跃 | 本仓库内嵌的 SDK 本体 | `license: ISC`，v3 = 3.1.3 |

> **结论速览**：本项目的**验证密度已经高于同类脚本一个档次**（5 套测试 316 条断言 + 变异测试 +
> 反向验证，上面这些贴吧脚本都没有）。真正落后的是三块：**工程化（CI / 发版 / 依赖可追溯）**、
> **架构收口（几个大文件 + 五份复制的缓存）**，以及几处**用户能感知的功能**。

---

## 2. 工程化：性价比最高的三件

### 2.1 加 CI（P0）

仓库现在**没有 `.github/`**，`HANDOFF.md` §10 那套「改完跑六项 → 提版本号 → push」全靠人记。
踩坑 #31 那次事故（变异测试的临时行被别人 `git add -A` 带上 `main`）正是手工流程会漏的证据。

建议 `.github/workflows/ci.yml`：

| 任务 | 内容 | 为什么 |
|---|---|---|
| 门禁（push / PR） | `typecheck` + `verify` + `keyword-test` | 三项纯离线、秒级，不需要网络、Edge 或快照 |
| 门禁 | **产物同步校验**：重新 `node build.mjs` 后 `git diff --exit-code dist/` | 把「改了源码忘了重建产物」钉死。产物必须提交是本项目的特例（README 的 raw 链接指着它），所以对应做法是校验一致，而不是禁止提交 |
| 手动触发 | `live-test` / `click-test` / `page-test` | 依赖网络、Edge、页面快照，别进 PR 门禁 |

两个落地细节：

- **CI 里没有「同级 `../eztb`」**。`build.mjs` 的 `EZTB_ROOT` 就是为这种情况准备的：
  把上游取到别处、再用 `EZTB_ROOT` 指过去即可。（这也是为什么**不要**把默认路径写死成绝对路径——现有做法是对的。）
  **但取证方式有讲究**：不要 clone `v3` 的尖端、也不要指望 `submodules: recursive` 能拿到对的那一版
  ——上游一动，子模块指针就跟着动，产物会对不上仓库里提交的那份。正确做法是按 `sdk.lock.json`
  记的提交检出（见 §2.2 与 `HANDOFF.md` §5 #39）。
- **产物必须机器无关**：esbuild 会给每个模块写一行 `// <路径>` 注释，路径按工作目录算相对值，
  上游 SDK 落在工作目录之外时会被写成**绝对路径**——于是"同一份源码"在 CI 与本机构建出的产物
  逐字符不同，上面那条 `git diff --exit-code -- dist` 就永远红。`build.mjs` 现在把这类注释
  收敛成固定记号（`HANDOFF.md` §5 #40）。**写"重建后必须没有 diff"的 CI 之前，先确认构建是确定性的。**
- **lint/format 可以零安装**：上游 `../eztb/node_modules/@biomejs/…/biome.exe` 已经在了，
  `biome.json` 是 tab + 双引号，与本仓库现有风格一致。

### 2.2 锁住 SDK 版本（P0）

现在 `dist/` 里**没有任何信息说明内嵌的是哪个 commit 的 SDK**。上游 `v3` 一动，同一份源码
构建出来的产物就变，而 `verify.mjs` 的签名比对是自证的（它比的是"自己构建的两份"）。

建议加 `sdk.lock.json`：`{ name, version, commit, sha256: { "src/index.ts": "...", ... } }`，
构建时校验，不一致就报错；CI 里跑；并把 `commit` 写进产物末尾的 NOTICE。
核许可时这个痛点是实打实遇到的——不锁的话，连"内嵌的是哪一版"都说不清。

### 2.3 发版与更新通道（P1）

- **补 `CHANGELOG.md` + git tag + GitHub Release**（Release 附上 `dist/*.user.js`）。
  现在版本历史只存在 `HANDOFF.md` 的 §9 和 `git log` 里。
- **加一个 `scripts/version.mjs`**，保证 `package.json`、产物 `@version`、git tag 三者一致。
  踩坑 #31 / 版本号规则（"只要 `dist/` 变了就必提 `@version`"）说明这里容易漏。
- **更新通道要说清楚**。元数据里**故意不写** `@updateURL` / `@downloadURL`（为了满足 Greasy Fork），
  但 README 目前主推的是 **raw.githubusercontent 安装**。这两件事凑在一起，用户是否自动收到更新
  取决于油猴对"安装 URL"的推断，**不可靠且没写进文档**。
  建议明确二选一：以 Greasy Fork 为主渠道（它自带更新机制）、raw 链接作为备用并在 README 里写明
  「从这里装的不会自动更新，升级请覆盖安装」。参考 [Tieba-Remix 的 README](https://github.com/0xb1aded/Tieba-Remix) 把多渠道差异并列写出来。

### 2.4 @description 与按钮文案不一致（P1，一行改动）

产物元数据里写的是「给每个用户名加一个 **eztb 按钮**」，而按钮上的字是 **「查询」**
（`main.ts` 的 `button.textContent`）。1.7.3 / 1.7.4 两版都在统一术语，`@description` 是
Greasy Fork 上用户第一眼看到的东西，漏了它。

---

## 3. 架构收口

### 3.1 `userPanel.ts` 1104 行（P1）

5 个页签的渲染 + 分页挂载 + 楼层绑定 + 成分渲染全在一个文件里，是全仓库最大的文件
（第二名 `core/userPost.ts` 371 行）。建议按页签拆成
`features/panel/{profile,composition,follows,fans,forums,posts}.ts`，各自导出
`render(body, identity)`，主文件只留编排。方向是**拆文件，不必上框架**——
Bilibili-Evolved 用组件注册表，Tieba-Remix 用 Vue，那是因为后者要重做整个页面。

### 3.2 五份复制粘贴的缓存模块（P1）

`core/cached.ts`、`compositionCache.ts`、`forumActivity.ts`、`forumLevel.ts`、`replyFloor.ts`
各自实现了一遍 `loadDisk` / 内存 Map / TTL / trim / `GM_setValue`（每个都有 3 处
`GM_getValue` / `GM_setValue` 调用）。抽一个工厂 `core/kvCache.ts`（`{ key, ttl, max, version }`）
能顺带修两个真问题：

- **`GM_setValue` 失败被 `try/catch` 静默吞掉**（`settings.ts` 里还写了注释"存储失败时至少内存里生效"），
  用户以为缓存/设置生效了，其实没有，且界面上没有任何提示；
- **整张表 JSON 塞进单个 value**，条数一多会撞油猴的存储配额。应分片 + 超限降级。
  Bilibili-Evolved 的 `src/core/local-storage.ts` 是现成参考。

### 3.3 设置没有版本、没有迁移、没有导入导出（P1）

`settings.ts` 的 key 是 `tbEztbToolboxSettingsV1`，但**没有 `schemaVersion` 字段、没有
`migrate()`**，读取就是 `{ ...DEFAULT, ...stored }`。`HANDOFF.md` §8 自己承认：「删条目会连
BDUSS 与关键词规则一起清掉」。

建议：

- 存储里加 `schemaVersion` + 一个迁移函数（老结构 → 新结构），以后加字段/改结构才有落脚点；
- 设置面板加 **「导出 / 导入设置 JSON」**（一键复制到剪贴板 / 粘贴回来）。
  用户的规则表是自己一条条写的，丢了很痛——这是投入最小、用户感知最强的改动之一。

### 3.4 `closeOpenDialog()` 是真 bug（P1）

[src/ui/modal.ts](src/ui/modal.ts) 第 133 行：

```ts
export function closeOpenDialog(): void {
	document.querySelector(".tb-eztb-mask")?.remove();
}
```

它只把 DOM 摘掉，**不走 `close()`**。而 `close()` 才负责 `document.removeEventListener("keydown", …, true)`
和 `options.onClose?.()`。`openDialog()` 一进来就调 `closeOpenDialog()`，所以
「面板 → 点设置」这条路会留下一个永不摘除的捕获阶段 keydown 监听器。

现在没人传 `onClose`，所以症状还只是监听器泄漏；但只要有人用 `onClose` 做清理（停请求、清定时器），
它立刻变成真 bug。改法：把 `close` 存进元素属性或 WeakMap，由 `closeOpenDialog()` 调用它。
顺手补上无障碍：`role="dialog"` + `aria-modal="true"` + 焦点陷阱 + 关闭后把焦点还给触发按钮
（现在只有 Escape 关闭，见 `modal.ts` 第 78–87 行）。

### 3.5 `console.log` 把用户对象打进控制台（P2）

[src/main.ts](src/main.ts) 第 75 行：`console.log("[eztb] 按钮被点击，正在打开面板", ref)`
——`ref` 里有 portrait / uid。建议统一 logger（级别 + 环形缓冲 + 脱敏），
诊断报告附最近 N 条日志，菜单里给「复制调试信息」。

### 3.6 MutationObserver 无批处理（P2）

[src/page/scanner.ts](src/page/scanner.ts) 第 98 行起：对每个 `addedNodes` 立刻全量
`querySelectorAll`，没有批处理。贴吧页面滚动时节点成批插入，建议按 rAF 合批；
另外在 SPA 软导航（`pushState` / `popstate`）时重置 `data-tb-eztb-toolbox-done` 标记。
参考 [Bilibili-Evolved 的 `src/core/observer.ts`](https://github.com/the1812/Bilibili-Evolved/blob/master/src/core/observer.ts)。

---

## 4. 请求层可靠性

### 4.1 请求无法取消（P1）

[src/core/gmhttp.ts](src/core/gmhttp.ts) 第 37 行的 `GM_xmlhttpRequest({...})` **丢弃了返回值**，
而那个返回值正是 `{ abort() }`（`types/gm.d.ts` 第 24 行声明了它）。后果：关掉面板之后，
在飞的请求还在跑，回调还在往已经摘掉的 DOM 上写。补一个 `AbortController` 语义的入口，
面板 `close` 时统一取消。

### 4.2 队列没有重试 / 退避 / 熔断（P1）

`core/queue.ts` 的 `SerialQueue` 只做「串行 + 固定间隔」，没有重试。目前只有吧名反查
（`userPost.ts`）自己重试了一次。建议：

- **只对 network / timeout 重试 1~2 次**，指数退避；业务 `errno`（比如实测见过的 300000）不重试；
- 连续失败熔断并在界面上提示，而不是让用户看着转圈；
- `errno` → 人话的映射表。可以用 [aiotieba](https://github.com/lumina37/aiotieba) 的错误语义
  交叉核对（它把贴吧的内部错误统一过一层）。

### 4.3 把「不变量」变成运行期自检（P2）

踩坑 #1/#3/#14 那些"必须成立"的约束（按钮 `pointer-events: auto`、`z-index: 5`、
徽章容器不折行）现在只写在文档和测试里。建议诊断面板直接**在真页面上断言它们**并给出结论，
用户报「按钮点不动」时报告里就自带答案。

### 4.4 BDUSS 体验（P2）

帮助链接指向第三方站点 `bduss.nest.moe`，与"不经过任何第三方服务"的定位有点反差。
建议面板内直接写「开发者工具里怎么复制 BDUSS」的步骤，再加一个 **「校验 BDUSS」** 按钮
（调一次需要鉴权的接口，显示校验时间与结果）——顺便把 `PLAN.md` 里一直挂着的 V4 验掉。

---

## 5. 用户能感知的功能

| 建议 | 为什么 | 参考 |
|---|---|---|
| **深色模式** | `ui/styles.ts` 里有 **133 处**硬编码色值（只有徽章那 3 处用了 CSS 变量）。贴吧有夜间模式，同类脚本把夜间适配当标配 | Tieba-Remix、hoothin 的贴吧优化 |
| **键盘可达性** | Tab 聚焦、Enter 打开、焦点恢复、记住上次页签 | Bilibili-Evolved |
| **共同关注 / 交集** | 用自己 UID 与对方关注列表求交集，纯只读，不违反 D5。这是 B 站"成分检测器"系脚本的核心卖点（73★ / 68★ 那两个） | bilibili-comment-checker |
| **规则生态** | 导入/导出 + 行号级解析报错 + `docs/rules.md` + 设置里的"规则测试器"。六段格式已经踩过"空格不能切"的坑，最缺的就是**文档**和**校验器** | BilibiliUserChecker |
| **issue 模板** | bug 模板直接要求贴「诊断当前页面」的报告，能省一半沟通 | baidu-tieba-userscript |
| **误判免责措辞进 README** | 界面上已经有"证据较弱，可能是误判"，但 README 没写。这类工具容易被用来挂人 | — |

---

## 6. 不建议做

- **不要为了体积拆 `@require` 或代码分割**。单文件（约 1.0 MB / 31,724 行）是这个项目最大的
  可靠性优势，Greasy Fork 也要求可读代码，2.0 MB 上限还远。
- **不要引入 Vue / React**。Tieba-Remix 用 Vue 是因为它要重做整个页面；本项目只需要拆文件。
- **不要在 CI 落地之前继续扩大改动面**。
- **不要碰写操作 / `tbs`**（D5），不要做导出、吧内分析、DB 统计。

---

## 7. 如果只做三件事

| 优先 | 做什么 | 为什么 | 量级 |
|---|---|---|---|
| 1 | 更正 SDK 来源与许可 + 加 `sdk.lock.json` + NOTICE 自动生成 | 直接决定能否上传 GF，顺手把构建变可复现 | 半天 |
| 2 | 加 `.github/workflows/ci.yml`（离线三项 + 产物同步校验） | 把 §10 的手工流程变成机器保证 | 半天 |
| 3 | 抽 `core/kvCache.ts` + 设置加迁移与导入导出 | 五份重复代码收一份；解决"重装丢 BDUSS 与规则" | 一天 |

---

## 8. 出处

**外部**

- <https://github.com/the1812/Bilibili-Evolved>（30,599★）
- <https://github.com/lumina37/aiotieba>（685★）
- <https://github.com/shitianshiwa/baidu-tieba-userscript>（352★）
- <https://github.com/0xb1aded/Tieba-Remix>（349★）
- <https://github.com/Dilettante258/eazy-tieba>（188★）
- <https://github.com/trychen/bilibili-comment-checker>（73★）
- <https://github.com/klxf/BilibiliUserChecker>（68★）
- <https://github.com/Dilettante258/tieba.js>（7★，`license: ISC`，v3.1.3）

**本仓库**

- `../eztb/.gitmodules`（submodule 指向 `Dilettante258/tieba.js`，branch `v3`）
- `../eztb/packages/sdk/package.json`（`"license": "ISC"`，3.1.3）
- `../eztb` 的 `git submodule status`（`packages/sdk` = `338a81e`）
- [THIRD-PARTY.md](THIRD-PARTY.md) 第 8、15 行 · [build.mjs](build.mjs) 第 116–117 行 ·
  [scripts/verify.mjs](scripts/verify.mjs) 第 218 行
- [src/ui/modal.ts](src/ui/modal.ts) 第 78–87、133 行 · [src/main.ts](src/main.ts) 第 75 行 ·
  [src/core/gmhttp.ts](src/core/gmhttp.ts) 第 37 行 · [src/page/scanner.ts](src/page/scanner.ts) 第 98 行 ·
  [src/core/settings.ts](src/core/settings.ts) 第 3 行 · [src/core/queue.ts](src/core/queue.ts)

**未确认**

- Bilibili-Evolved 的 `core/local-storage.ts` 与 `core/observer.ts` 的具体实现细节：
  只按仓库路径引用了它的做法，**没有逐行读过**。
- 本项目 CI 在 GitHub 上能否顺利拿到上游 SDK（submodule 是公开仓库，理论上可以）：
  **没有实跑过**。
