# eztb-userscript

在贴吧页面上就地查询用户数据的油猴脚本：点任意用户名旁的 **「查询」**，看这个人的
**资料 / 成分 / 关注的人 / 关注的吧 / 粉丝 / 发帖**。
数据由脚本内置的 tieba.js SDK 直连 `tiebac.baidu.com`，**不经过 eztb.org 或任何其他第三方服务**；
全部只读，不碰 `tbs`、不执行任何写操作。
仓库：<https://github.com/Dan12elion/tieba_extensions>
维护者文档（架构、实测数据、踩过的坑、发布流程）见 [HANDOFF.md](HANDOFF.md)。

## 安装

1. 在 Edge / Chrome 里装 Tampermonkey。
2. 装脚本：打开仓库里的 [`dist/tieba-eztb-toolbox.user.js`](dist/tieba-eztb-toolbox.user.js)
   点下载按钮，再在 Tampermonkey 面板里「添加新脚本」→ 用下载到的内容替换模板 → 保存；
   也可以直接打开 raw 链接（油猴会识别 `.user.js` 并弹安装框）：
   <https://raw.githubusercontent.com/Dan12elion/tieba_extensions/main/dist/tieba-eztb-toolbox.user.js>
3. 首次使用点脚本菜单「eztb：设置 BDUSS / 运行参数」，按提示粘贴 BDUSS。

只需下载上面这一个文件；仓库其余内容是构建脚本、测试与文档，日常使用用不到。

> **已经装了旧脚本 `tieba-eztb-follow.user.js` 的话先卸载它**——它的按钮已失效，还会与本脚本抢页面标记。
>
> 脚本更新后要在油猴里**覆盖**安装，而不是删掉重装：设置存在脚本存储里，
> 删条目会连 BDUSS 与关键词规则一起清掉。

## 功能

| 页签 | 数据来源 | 说明 |
| --- | --- | --- |
| 资料 | `getProfile` | 基础资料、等级、吧龄、发帖数等 |
| 成分 | 关注的吧 + 主题帖 + 回复 | 按关键词规则标注这个人的"成分"，命中的词在原文里高亮 |
| 关注的人 | `getFollow` | **返回的是用户，不是贴吧**；每页 20 条，按需翻页 |
| 关注的吧 | `getLikeForum` → 回退 `getHiddenLikeForum` | 带吧内等级 Lv.N；拿不到等级的可以点「查等级」 |
| 粉丝 | `getFans` | |
| 发帖 | 自建请求（`is_thread` 双 feed） | 拆成 **主题帖 / 回复** 两个子页签，各自翻页；每条标注主题 / 回复 / 楼中楼；顶部有按吧统计的占比饼图 |

面板底部是 **「刷新当前页签」**：重新解析用户并重建当前页签，其它页签的内容保留。

另外两件与界面有关的：

- **设置可以导入导出了**：设置面板里有「导出到文本框 / 复制 / 从文本框导入」。
  导出的内容**不含 BDUSS**，导入时也**不会读取 BDUSS**，所以把规则表发给别人是安全的；
  换电脑或重装脚本之前建议先导出一份（卸载脚本会连规则一起清掉）。
- **深色模式**：界面配色跟随系统的深色偏好（`prefers-color-scheme`）自动切换。
  注意这里跟的是系统设置，不是贴吧自己那个夜间模式开关——两者不一定同步。

### 「发帖」页签

- **按吧统计的饼图**：统计他的发帖都发在哪些吧（条数与占比），最多画 5 个，其余合成「其它 N 个吧」；
  下方「查看全部 N 个吧的占比」可以展开每个吧的条数与占比。
  进页签时主题帖与回复**两路 feed 各取一页**，之后翻页也会跟着更新。
- 图上如果写着「「回复」的数据还在加载，下面的占比还不完整」，那是还没到齐——回复要按吧反查吧名，
  冷启动会比主题帖晚几秒，到齐后提示自动消失；哪一路彻底没取到，图上会写明是哪一路。
- 图例里的「未知贴吧」表示那一行的吧名没解析出来，这类行**照样计入**总数与占比，不会被丢掉。
- **回复正文**：回复与楼中楼会显示他回了什么（以前只有标题）。
- **楼层**：发帖接口不带楼层号，所以每行有一个「查楼层」小按钮——点了才查（每行一个请求），
  查到换成「N楼」，鼠标悬停能看到那一楼的正文；结果会缓存。

> **对方隐藏发帖记录时拿不到内容。** 贴吧允许把发帖记录设为私密，这时两路 feed 都只返回空列表
> （实测 108 个用户里 15 个如此）。脚本没有绕过的办法，但会把这一路直接标成「发帖信息设为私密」，
> 而不是含糊地说"没有公开的主题帖"。

### 「关注的吧」：等级与「检测签到号」

> **已知限制**：吧内等级只能按**用户名**查询，而且只覆盖一部分吧。隐藏了关注贴吧的用户，
> 脚本只能从资料接口恢复出**吧名**；如果对方连用户名都没有（页面显示「贴吧用户_xxxx」），
> 那他的吧内等级**一个都拿不到**——面板会写明"该用户没有设置用户名，吧内等级无法查询"。
>
> **补救办法**：没等级的行右边有「查等级」按钮，点了才去他**在这个吧的帖子**里读
> （帖子接口的 `userList` 带着每个人在该吧的等级）。读到就缓存，读不到会说明原因。

**「检测签到号」**点了才取数（主题帖与回复各一页），按吧统计他最近在哪儿发言，
标出「吧内等级 ≥ 门槛、最近这批帖子里该吧 0 条发言」的吧，并给每行补「近期发言 N 条」。
结论里会写明判定条件与样本大小——样本只有最近一页，**不能理解成"他从来不发言"**；
门槛在设置里（默认 6）。请求成本：回复数据不含吧名（只有 ID），第一次点通常是十几个请求，
之后吧名进缓存就只剩 2 个；所有请求都受限速约束（见「关键设计」）。

## 成分检测（关键词标注）

参考 B 站"成分检测器"：配好规则后，脚本在后台逐个检查页面上出现的用户，
命中就在用户名旁挂一个彩色标记，点标记直接看命中了哪条规则、命中了什么。

规则在设置面板里逐行写：

```
# 以 # 开头是注释
🎮原神 | 原神,芙宁娜,米哈游 | 原神吧,米哈游吧 | 原神怎么你了
🎁抽奖 | 互动抽奖,转发本条动态
⚠️某个名单 | | | | 1234567890
🛒带货 | | | | | 拼多多,淘宝
```

字段是 `名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单 | 发帖所在吧关键词`，
后四段可省略，关键词用逗号分隔（**不按空格切**，参考脚本里就有「互动抽奖 #原神」这种带空格的词）。

- **发帖**关键词打在主题帖与回复的「标题 + 正文摘要」上（各取第 1 页，每页 60 条）；
  **吧**关键词打在关注的吧名上。
- **隐藏了关注贴吧的用户也算数**：主接口拿不到时，脚本会从资料接口自带的「关注贴吧」字段与
  等级分组里恢复一部分吧名参与判定；面板会写明"其中 N 个来自隐藏关注贴吧的恢复"。
  恢复出的列表可能不完整，这是贴吧自身的限制。
- 最后一段「**发帖所在吧**关键词」打在他**实际发过帖**的吧名上——与"关注了哪些吧"是两回事
  （很多人关注一堆吧却不说话）。这一段是新加的，所以放在最后，老规则（5 段）不用改。
- **排除关键词**命中就整条不算，用来压住"只是玩梗/讨论"这类误伤。
- 证据分强弱：名单、关注的吧、**主题帖**算强证据；**回复与楼中楼**只算弱证据，
  界面会标"证据较弱，可能是误判"，标记也淡一些。
- 同一用户同一条规则命中多处会合并成一个标记，不会重复刷屏。

请求成本与开关：

- **规则表为空时一个请求都不发**（默认状态，装上不会打扰任何人）。
- 每个用户最多 3 个请求（关注的吧 + 主题帖 + 回复）；设置里可限制**每页最多检测多少人**（默认 20），
  超出的不再排队；同一用户在缓存有效期内只查一次（默认 3 天，改规则会让缓存自动失效）。
- 请求受那条串行限速队列约束，与手动查询共用同一个间隔设置（吧名反查是唯一的例外，见下）。

脚本菜单里还有：**「eztb：清空成分缓存」**、**「eztb：重新检测本页用户」**，
以及 **「eztb：诊断当前页面」**（列出 URL、各扫描器选择器的命中数、已注入按钮数、
页面上用户主页链接的 class 统计、在飞请求数、存储写入失败记录与最近的日志；
面板里另有「中断在飞请求」按钮——遇到「某类页面不出按钮」时把这个报告发出来即可定位）。

还有 **「eztb：中断当前所有在飞请求」**：请求失控（比如误设了很小的间隔、正在批量检测）
时可以一键停下，不用关页面。

> 术语对照（容易搞错，已踩过坑）：上游网页的 `/follow` 是「关注列表 / 共关注 N 人」，对应 `getFollow`；
> 「关注的吧」是 `/likeforum`，对应 `getLikeForum`。两者不是同一个接口。

## 关键设计（改之前先读）

细节与踩坑记录在 [HANDOFF.md](HANDOFF.md) 的 §3 与 §5，这里只列最容易被"顺手改回去"的几条：

- **不经过任何第三方服务**：SDK 编译进单文件，所有请求只打 `tiebac.baidu.com`，协议统一升级为 HTTPS。
- **串行限速**：请求经 `SerialQueue` 排队，默认间隔 400ms，分页由脚本逐页驱动，
  不用 SDK 内部的并发 `ALL` 拉取。唯一例外是「按吧反查吧名」（回复接口只给 ID）：它最多 3 个并发、
  间隔取"你设的间隔 ÷ 3"与 150ms 的较大者（默认约 6 个/秒，设置调大时自动放宽）。
- **凭据本地化**：BDUSS 只存在油猴存储里，不上传任何地方。
- **按钮必须 `pointer-events:auto !important`**：新版贴吧把操作按钮放在 `.btn-wrapper` 里，
  该容器常态是 `pointer-events:none`，不覆盖就会「看得见、点不动」。
- **按钮的 z-index 只能是 5**：抬 z-index 会让它盖住本该盖住它的页面弹层。
- **点击走 document 捕获阶段的事件委托**：页面在冒泡阶段可能吞掉点击。
- **列表行的标题/副标题必须是块级**：`overflow:hidden` + `text-overflow:ellipsis` 对 inline 元素无效。
- **每个页签（以及「发帖」下的两个子页签）各自一个容器**，切换只切显隐；
  共用容器 + "已初始化"集合会导致切回被提前 return、异步回调覆盖当前内容。
- **成分标记容器必须 `nowrap`**：新版头部行高度写死 40px，标记折行会压住正文。
- **主题帖与回复是两个 feed**（`is_thread` 切换）、**楼层号要额外查一次**、
  **手动构造 protobuf 必须走 `fromPartial`** —— 原因都在 HANDOFF 的 §4。

## 合规提醒

- BDUSS 等同于账号登录凭据，请勿分享或粘贴到不可信的网站。
- 请保持默认的请求间隔，不要用它做批量抓取或任何自动化写操作。
- 许可见 [LICENSE](LICENSE)（本工程自己的代码，MIT）与 [THIRD-PARTY.md](THIRD-PARTY.md)（内嵌的第三方代码）。
- 内嵌的 `packages/sdk` 是上游仓库里的 **git submodule**，指向
  [Dilettante258/tieba.js](https://github.com/Dilettante258/tieba.js)；它的 `package.json` 声明
  `license: ISC`（`v3` 分支当前是 3.1.3）。版本与提交号锁在 [`sdk.lock.json`](sdk.lock.json) 里，
  构建时会和磁盘上的实际值核对，对不上会直接停下来。
  上游仓库暂时没有 `LICENSE` 文件，产物末尾的 NOTICE 里按 ISC 模板补了一份许可文本。
- 另外内嵌三个许可明确的库：effect（MIT）、@bufbuild/protobuf（Apache-2.0 AND BSD-3-Clause）、long（Apache-2.0）。

## 与旧脚本的关系

基线脚本（早期那个点按钮后用 iframe 内嵌 `https://www.eztb.org/follow` 的版本）不在本仓库里。
本工程保留它验证过的部分（新旧版 DOM 适配、UID 解析、按钮注入、缓存策略），把数据来源换成脚本内置的 SDK——
不再让别人的服务器每点一次就交付一整套前端资源。

## 发布到 Greasy Fork

已按它的规则逐条核对（[code-rules](https://greasyfork.org/zh-CN/help/code-rules)、
[meta-keys](https://greasyfork.org/zh-CN/help/meta-keys)），并写成了 `verify.mjs` 的
**V7 · Greasy Fork 发布要求** 一组断言：

| 要求 | 本工程的做法 |
| --- | --- |
| 不得混淆或压缩，要保留空白与变量名 | 默认构建就是未压缩可读版（约 2.9 万行，最长行不到 2000 字符） |
| 脚本 ≤ 2.0 MB | 约 1.0 MB |
| `@name`、`@description` 必填 | 都有，且各带一份 `:zh-CN` 语言标记 |
| 至少一个 `@match`/`@include`，且只匹配自己提供功能的站点 | 两个 `*://…tieba.baidu.com/*` |
| `@license` 用 SPDX 标识符 | `MIT` |
| 内嵌的库必须写明来源、名称与版本 | 产物末尾 NOTICE 逐条列出（tieba.js SDK / effect / @bufbuild/protobuf / long） |
| 不要自己写 `@updateURL` / `@downloadURL` | 没写，交给 Greasy Fork 自动改写 |
| 主要功能必须在站内代码里实现 | 全部打包进单文件，不使用 `@require` 远程加载 |

上传前还需要你确认两件事：**元数据里的标识是你自己的**（fork 的话用 `EZTB_NAMESPACE` /
`EZTB_AUTHOR` 覆盖后重新构建；默认值指向本仓库），以及**你确实有权分发 tieba.js SDK**（见上面的合规提醒）。

> 为什么不用 `@require` 加载库？SDK 有 4 个 Node 依赖（`undici`、`node:crypto`、`node-html-parser`、`Buffer`）
> 需要在构建时替换成浏览器实现，直接 `@require` 原版跑不起来。

### 持续集成

`.github/workflows/ci.yml` 在每次 push / PR 上跑**离线三项 + 产物同步校验**：
`typecheck` → `build` → `git diff --exit-code -- dist` → `verify` → `keyword-test`。
本项目的产物是提交进仓库的（README 的 raw 链接指着它），所以这里校验的是
**产物和源码一致**——改了源码忘了重建会被直接拦住。

`live-test` / `click-test` / `page-test` 依赖真实接口与无头浏览器，放在同一个 workflow 的
`workflow_dispatch` 里手动触发，不进 PR 门禁。

> 这套 CI **写好后还没在 GitHub 上实际跑过**。它需要 clone 上游 eztb（含 submodule）
> 并 `bun install` 一次——本机开发不需要装 bun，但 CI 里 esbuild / typescript / effect
> 都得从上游装出来。第一次跑起来可能要调。

## 目录结构

```
eztb-userscript/
├─ build.mjs              # esbuild 打包 + 拼接油猴元数据
├─ tsconfig.json          # 类型检查配置（paths 与 shims-plugin.mjs 的别名对齐）
├─ package.json           # 版本号：产物元数据里的 @version 就是它
├─ sdk.lock.json          # 内嵌 SDK 锁定的版本 / 许可 / 提交号（构建时核对）
├─ HANDOFF.md / PLAN.md   # 交接文档 / 立项时的清单（历史）
├─ IMPROVEMENTS.md        # 对标同类项目的改动建议与进度
├─ .github/workflows/     # CI（离线三项 + 产物同步校验）
├─ scripts/
│  ├─ shims-plugin.mjs    # Node → 浏览器 的解析替换规则（打包与校验共用）
│  ├─ deps-info.mjs       # 读内嵌依赖的版本 / 许可 / 提交号，生成产物 NOTICE
│  ├─ typecheck.mjs       # tsc --noEmit（借上游的 typescript）
│  ├─ verify.mjs          # MD5 签名逐字符比对 + 产物检查 + Greasy Fork 要求
│  ├─ keyword-test.mjs    # 纯逻辑离线测试（规则 / 饼图 / 判定）
│  ├─ live-test.mjs       # 真实接口链路测试
│  ├─ click-test.mjs      # 无头浏览器 + 本地代理的交互测试
│  ├─ page-test.mjs       # 真实页面快照回归
│  └─ fetch-sample-css.mjs / extract-mhtml.mjs / probe-user.mjs  # 一次性排查工具
├─ src/
│  ├─ main.ts             # 入口：注入样式、挂按钮、注册菜单
│  ├─ core/               # 设置、限速队列、缓存、身份解析、关注的吧、发帖、成分规则
│  ├─ shims/              # 4 个 Node 依赖的浏览器替身
│  ├─ page/               # 新旧版贴吧 DOM 适配、扫描、成分徽章
│  ├─ ui/                 # 样式与通用弹窗
│  └─ features/           # 用户面板、设置面板、成分检测调度
└─ dist/
   └─ tieba-eztb-toolbox.user.js
```

## 构建

本工程**刻意不重复安装依赖**：esbuild、`effect`、`@bufbuild/protobuf`、`long`、typescript
都从上游 eztb 仓库的 `node_modules` 借。默认取同级的 `../eztb`，可用 `EZTB_ROOT` 指向别处。

```powershell
$env:EZTB_ROOT = "<上游 eztb 仓库的路径>"   # 可选，默认 ../eztb
node build.mjs               # 可读版（默认，约 1.0 MB）
node build.mjs --minify      # 压缩版，另存 dist/tieba-eztb-toolbox.min.user.js（不要传 Greasy Fork）
node scripts/typecheck.mjs   # 类型检查
node scripts/verify.mjs
```

默认不压缩是有意为之：Greasy Fork 要求提交未压缩代码，油猴编辑器里也只有未压缩版能正常换行阅读。

构建时会读 `packages/sdk/package.json` 与 `git rev-parse HEAD`，和仓库里的
`sdk.lock.json` 比对，并把结果写进产物末尾的 NOTICE。**对不上就直接停下**，
提示你先确认上游改了什么、再更新锁文件——上游 `v3` 一动，产物就变了，
这条是唯一能证明"产物里内嵌的是哪一版"的东西。

元数据里与"你是谁"有关的部分可用环境变量覆盖，不用改代码：

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `EZTB_NAME` | `@name`（同时生成 `@name:zh-CN`） | 贴吧 eztb 工具箱 |
| `EZTB_NAMESPACE` | `@namespace`，与 `@name` 一起构成脚本唯一标识 | `https://github.com/Dan12elion/tieba_extensions` |
| `EZTB_AUTHOR` | `@author`，留空则不输出该行 | `Dan12elion` |
| `EZTB_SUPPORT_URL` | `@supportURL`，留空则不输出该行 | 本仓库的 issues |

> `@namespace` 一旦发布就不要改，否则已安装的用户会被当成装了另一个脚本。

## 自动校验

五套测试脚本加一次类型检查，都不需要 BDUSS：

| 命令 | 验证内容 |
| --- | --- |
| `node scripts/typecheck.mjs` | 类型检查（`tsc --noEmit`）。别名解析、接口参数形状、字段确实存在——esbuild 只打包不检查，所以这条单列 |
| `node scripts/verify.mjs` | 浏览器版 MD5 / `packRequest` 与 Node 版逐字符一致；产物无残留 Node 依赖、不含 eztb.org；内嵌依赖自检（SDK 与上游检出的版本/许可/提交号都要对上 `sdk.lock.json`）；以及 Greasy Fork 的发布要求（44 项） |
| `node scripts/keyword-test.mjs` | 成分规则解析、匹配、排除词、证据强弱、高亮转义，发帖占比/饼图几何、「查看全部吧」列表、签到号判定与发帖行副标题（70 项，纯离线） |
| `node scripts/live-test.mjs` | 打真实贴吧接口（匿名 proto 端点）：签名、protobuf、multipart、HTTPS 升级、翻页、真实数据跑关键词、隐藏关注贴吧的恢复、"点了才查"的等级与楼层（都与直接调接口交叉验证）、隐藏发帖的不变量、回复页吧名反查的缓存与去重（33 项） |
| `node scripts/click-test.mjs` | 无头 Edge/Chrome：按钮注入、命中测试（`elementFromPoint`）、面板渲染、子页签独立翻页、成分标记、「查等级」/「检测签到号」、菜单命令、诊断面板的开关、弹窗焦点陷阱、占比饼图、回复正文与「查楼层」、隐藏发帖说辞（151 项） |
| `node scripts/page-test.mjs` | 真实页面快照回归：按钮注入、新版头部行排版、按钮与正文不重叠（每份快照跑正常宽度与 420px 窄容器两遍）。**项数取决于本机有几份快照**，不是固定值 |

> page-test 的快照放在仓库的 `dist/.samples/`（已 gitignore；同级的 `../test0` 也会找）。
> 找不到快照的用例会显示"跳过"并注明，不会假装通过。
> 只有 **MHTML** 快照会丢外部 CSS（它只存内联样式），那种快照要先跑
> `node scripts/fetch-sample-css.mjs` 把样式抓下来，否则布局类断言会失真；
> 浏览器另存的「网页，完整」快照自带 `<标题>_files/`，不需要这一步。

另外几个一次性工具：`node scripts/probe-user.mjs <portrait/ID> [吧名]` 打某个用户在四个接口下的原始返回
（回答"为什么这个字段拿不到"），`node scripts/extract-mhtml.mjs <a.mhtml>` 把 MHTML 解码成可加载的 HTML，
`$env:EZTB_PROBE=1; node scripts/live-test.mjs` 打印原始 feed 结构与 `is_thread` 对比。

**尚未验证**（需要真实浏览器 + 有效 BDUSS）：带 BDUSS 的鉴权接口（关注吧 / 粉丝 / 发帖）、
真实贴吧页面上的按钮注入与自愈。这两条只能由使用者自己在浏览器里确认。

## 开发说明与致谢

本仓库的代码、测试与文档由作者 **Dan12elion** 与 AI 助手协作完成（模型 DeepSeek，
工具 Codex 桌面版在本机执行构建与测试）。AI 是协作工具而不是作者：每一步改动都由作者确认后才提交，
[LICENSE](LICENSE) 里的版权人也只写作者本人，AI 生成的内容不单独主张版权。
