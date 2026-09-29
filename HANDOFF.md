# eztb-userscript 项目交接文档

> 新对话继续这个项目时，读完这份就能恢复全部上下文。
> 最后更新 2026-09-30 · 当前版本 **1.8.2**
> 仓库（公开）：<https://github.com/Dan12elion/tieba_extensions>
> 用户装的那条对应 `dist/tieba-eztb-toolbox.user.js`

---

## 1. 项目目标与已确认的决策

**做什么**：油猴脚本，在贴吧页面给每个用户名挂一个「查询」按钮，点开看这个人的只读数据
（资料 / 成分 / 关注的人 / 关注的吧 / 粉丝 / 发帖）。

**为什么**：旧实现把 `https://www.eztb.org/follow` 用 iframe 嵌进页面——每点一次就让别人的服务器
交付一整套前端资源。

**最终方案（C）**：把 eztb 的 SDK（tieba.js）直接编译进脚本，数据由脚本直连
`tiebac.baidu.com`，不经任何第三方服务、不需要本地进程。
未采用的 A（exe 提供本地前端、脚本 iframe 指向 `127.0.0.1`）与 B（exe 只提供本地 API）：
一个仍要背整个 SPA，一个要常驻进程，对一个按钮都太重。

| 编号 | 决策 |
|---|---|
| D1 | 独立工程目录，与上游 eztb 并列，命名上标记归属 |
| D2 | 只考虑 Edge / Chrome，不承诺 Firefox |
| D3 | BDUSS 由用户手动粘贴，存 `GM_setValue`；设置里给获取 BDUSS 的辅助网址 |
| D4 | "方便做的"只读功能全部纳入 |
| D5 | 不做任何写操作（不碰 tbs），不做导出 / 吧内分析 / DB |
| D6 | 不修改 `packages/sdk` 源码 |
| D7 | 「成分」是只读功能：规则表为空时零请求；开启后受"每页人数上限 + 缓存 + 串行限速"约束 |

产物元数据的 `@namespace` / `@author` / `@supportURL` 默认指向本仓库（`build.mjs` 里的默认值）；
fork 出去的人要用 `EZTB_NAMESPACE` / `EZTB_AUTHOR` 换成自己的。

---

## 2. 目录与相关路径

| 路径 | 说明 |
|---|---|
| 本仓库 | 本工程（独立目录，不在上游仓库里） |
| 上游 eztb 仓库（默认同级 `../eztb`） | monorepo：`apps/web`、`apps/api`、`packages/sdk`；构建与测试从它借依赖 |
| 快照目录（默认同级 `../test0`） | 真实页面快照（.mhtml）与旧脚本；page-test 会在这里找样本 |
| 本仓库 `dist/.samples/` | 另一个快照投放点（gitignore）；page-test 两处都找 |

本机路径一律写成"同级目录 + 环境变量覆盖"，仓库里不出现 `E:\Codexpj\…` 或用户名；
快照与 CSS 缓存不进仓库。

```
eztb-userscript/
├─ build.mjs                    # esbuild 打包 + 拼接油猴元数据
├─ tsconfig.json                # 类型检查配置（paths 与 shims-plugin 的别名必须一致）
├─ package.json                 # 版本号：产物元数据的 @version 从这里来
├─ README.md                    # 用户向文档（安装、功能、构建）
├─ PLAN.md                      # 立项时的改造/验证清单（已归档）
├─ HANDOFF.md                   # 本文件
├─ IMPROVEMENTS.md              # 对标同类项目的改动建议（含进度）
├─ LICENSE                      # MIT（只覆盖本工程代码）
├─ THIRD-PARTY.md               # 内嵌的第三方代码与授权状态（★ 1.8.0 更正过）
├─ sdk.lock.json                # 锁内嵌 SDK + 构建它的那份上游 eztb 检出（提交号，构建时核对）
├─ .github/workflows/ci.yml     # CI：离线三项 + 产物同步校验（★ 1.8.0 新增）
├─ .gitattributes               # 统一 LF（产物会被直接安装/上传）
├─ .gitignore                   # 忽略 node_modules、dist/.verify、dist/.samples
├─ scripts/
│  ├─ shims-plugin.mjs          # Node→浏览器 的解析替换规则（打包与测试共用）
│  ├─ deps-info.mjs             # 读内嵌依赖的版本/许可/提交号，生成产物 NOTICE
│  ├─ typecheck.mjs             # tsc --noEmit（别名、参数形状、字段是否存在）
│  ├─ verify.mjs                # 签名逐字符比对 + 产物检查
│  ├─ keyword-test.mjs          # 成分规则 / 饼图 / 判定的纯离线测试
│  ├─ live-test.mjs             # 真实接口测试（EZTB_PROBE=1 开探查）
│  ├─ click-test.mjs            # 无头浏览器 + 本地代理的交互测试
│  ├─ page-test.mjs             # 真实页面快照回归
│  ├─ fetch-sample-css.mjs      # 抓 MHTML 快照引用的外部 CSS
│  ├─ probe-user.mjs            # 单用户原始数据探查
│  └─ extract-mhtml.mjs         # MHTML 解码工具
├─ src/
│  ├─ main.ts                   # 入口：注入样式、挂按钮、注册菜单、点击委托
│  ├─ core/                     # ★ 设置、SDK、身份、取数、规则与缓存
│  ├─ shims/                    # 4 个 Node 依赖的浏览器替身 + 测试入口
│  ├─ page/                     # 新旧版 DOM 适配、扫描、成分徽章
│  ├─ ui/                       # 全部 CSS、通用弹窗外壳
│  ├─ features/                 # 用户面板、设置面板、成分调度、诊断
│  └─ types/                    # GM_* API 的类型声明
└─ dist/
   ├─ tieba-eztb-toolbox.user.js      # 产物：未压缩可读版（约 1.0 MB）
   ├─ tieba-eztb-toolbox.min.user.js  # 只有 node build.mjs --minify 才生成
   ├─ .verify/                        # 测试中间产物（gitignore）
   └─ .samples/                       # 随手放进来的页面快照（gitignore）
```

`core/` 里几个值得先看的模块：`userPost.ts`（双 feed 取数）、`userForums.ts`（关注的吧 + 隐藏回退）、
`forumLevel.ts` / `replyFloor.ts` / `forumActivity.ts`（三个"点了才查"）、`composition*.ts`（成分）、
`postStats.ts` / `activityRule.ts`（纯逻辑，离线可测）、
`kvCache.ts`（五个缓存的公共工厂，★ 1.8.0 新增）、`settings.ts`（含结构迁移与导入导出）、
`log.ts`（分级日志 + 脱敏）、`gmhttp.ts`（请求 + 在飞登记/取消）。

---

## 3. 架构要点

### 3.1 四个 Node 依赖的浏览器替身（不改 SDK 源码）

构建时用 esbuild 的解析钩子（`scripts/shims-plugin.mjs`）替换，上游更新后重新打包即可：

| SDK 依赖 | 替身 | 关键点 |
|---|---|---|
| `undici` | `src/shims/undici.ts` | 同签名 `request()`，底层走 `GM_xmlhttpRequest`；并**把 `http://tiebac.baidu.com` 升级为 https** |
| `node:crypto` | `src/shims/md5.ts` | 只实现 `md5 + hex`，行为与 Node 逐字符一致（verify 有断言） |
| `node-html-parser` | `src/shims/html.ts` | 用原生 `DOMParser`；`innerText` 映射到 `textContent`（`<script>` 的 innerText 在浏览器恒为空） |
| `Buffer` | `build.mjs` 的 banner | 全 SDK 只有 `core/http.ts` 一处 `Buffer.from`，垫成透传 |

SDK 没有暴露 `UserPost` 的编解码器，取主题帖要用 `is_thread=1`，所以构建时还要按别名引入
`tieba.js/generated/UserPostReqIdl` 与 `UserPostResIdl`。别名同时写进 `tsconfig.json` 的 `paths`
（`scripts/typecheck.mjs` 靠它做类型检查），两边必须一起改。

### 3.2 运行时

- **串行限速**：正文请求（两个 feed、关注/粉丝、贴吧资料…）都经 `SerialQueue`，默认间隔 400ms，
  分页由脚本逐页驱动，**不使用 SDK 内部的并发 `ALL` 拉取**。
- **唯一的例外是"按吧反查吧名"**（回复 feed 只给 forumId）：几十字节的小 GET，排队会让整页回复晚好几秒
  （见 §5 #29）。它绕开队列，最多 3 个在飞、间隔取 `max(150ms, 用户设置 ÷ 3)`，默认约 6 个/秒，
  设置调大时自动放宽。设置面板里写明了这条例外；改之前先读 §5 #29 与 `core/userPost.ts`。
- **凭据本地化**：BDUSS 只存油猴存储；支持整段粘贴 `BDUSS=xxx` 自动提取。
- **每个页签一个独立容器**（`.tb-eztb-pane`），切换只切显隐，内容保留、不重复请求；
  「发帖」页签内部再拆两个子容器（`.tb-eztb-subpane`）。
- **点击走 document 捕获阶段的事件委托** + WeakMap 关联按钮与用户信息；按钮用 `<button type="button">`。
- **按钮的 z-index 只能是 5**，且必须 `pointer-events:auto !important`（§5 #1/#3）。

### 3.3 1.8.0 新增的几层（改之前先看这里）

| 模块 | 做什么 | 为什么要有它 |
|---|---|---|
| `core/kvCache.ts` | 五个缓存（资料 / 成分 / 吧内等级 / 楼层 / 签到检测）共用的工厂：内存 Map + 磁盘 Record + TTL + 按 ts 淘汰 + 存盘 | 以前五份复制粘贴；**存盘失败五处都被 `try/catch` 静默吞掉**，用户以为缓存住了其实没有 |
| `core/log.ts` | 分级日志（默认 `info`）+ 200 条环形缓冲 + `describeUser()` 脱敏 | 以前点击日志是 `console.log("…", ref)`，把整个用户对象倒进控制台 |
| `core/settings.ts` | `schemaVersion` + 迁移表 + `normalizeSettings()` + 导入导出 | 以前读设置是 `{ ...DEFAULT, ...stored }`，没有版本、没有迁移、未知键会一直留在存储里 |
| `ui/modal.ts` | 弹窗关闭统一走 `close()` | `closeOpenDialog()` 以前只 `remove()` DOM，**监听器不摘、`onClose` 不触发**（§5 #35） |
| `core/gmhttp.ts` | 记录在飞请求（`inFlightCount()` / `abortAllInFlight()`） | 以前 `GM_xmlhttpRequest` 的返回值（就是 `{ abort() }`）被丢掉，没有任何取消入口 |
| `scripts/deps-info.mjs` + `sdk.lock.json` | 构建时读 SDK 的版本/许可/提交号，生成 NOTICE，并与锁文件核对；`sdk.lock.json` 里的 `eztb` 段还锁住**上游检出本身**（CI 按它检出上游） | 以前 NOTICE 是手写常量，**来源 URL 与许可都写错**（§5 #37）；只锁 SDK 的提交号、不锁上游检出，CI 就复现不出同一份产物（§5 #39） |
| `build.mjs` 的 `stabilizeModuleComments()` | 把 esbuild 的 `// <路径>` 模块注释收敛成 `<eztb>/packages/sdk/...` 与 `src/...` | 那些注释里会带**机器相关的绝对路径**，产物换台机器就变，CI 的「重建后 `git diff` 必须为空」会永远红（§5 #40） |

几条**已经想清楚、不要"顺手改回去"**的决定：

- **不在面板关闭时 `abortAllInFlight()`。** 关掉面板后在飞的那几个请求会把结果写进
  资料/发帖缓存，下次打开同一用户是白拿的；而且一刀切中止会连带打断后台正在跑的
  成分检测（它不受面板管辖）。取消入口做成手动命令，原因见 `core/gmhttp.ts` 的注释。
- **`kvCache` 的磁盘格式就是条目本身**（带 `ts`），没有另加一层信封，所以 1.7.x 写下的
  缓存 1.8.0 仍然读得出来。要改这个形状就得同时写迁移。
- **存储键名 `tbEztbToolboxSettingsV1` 里的 `V1` 不要改**：改键名等于把已装用户的
  BDUSS 与规则表全部孤儿化。结构版本另用 `schemaVersion` 字段记。
- **深色模式跟的是 `prefers-color-scheme`（系统偏好），不是贴吧自己的夜间模式开关。**
  后者是页面内的一个 class，跟系统偏好不一定同步，猜错反而更难看。
  配色只有两处来源：`ui/styles.ts` 的 `--tb-eztb-*` 变量，以及**在 TS 里拼出来的 SVG**
  （§5 #42 就是漏了后者）。两处都要改，`click-test` 的深色那一遍会盯着。

---

## 4. 关键数据模型（全部来自实测）

### 4.1 接口语义对照

| 页签 | 接口 | 返回的是 | 依据 |
|---|---|---|---|
| 关注的人 | `getFollow`（`/c/u/follow/followList`） | **用户** | 上游 `follow.tsx` 写的是"共关注 N 人" |
| 关注的吧 | `getLikeForum`（`/c/f/forum/like`） | **贴吧**，带 `level_id` | 上游 `likeforum.tsx` 标题就是"关注的吧" |
| 粉丝 | `getFans` | 用户 | |

> 这两个接口曾经被用反过（标签写"关注吧"却拉关注的人），改的时候留神。

### 4.2 吧内等级只有三个来源

1. `getLikeForum` —— 用户隐藏关注贴吧时返回空。
2. `panel.honor.grade` —— **只能按"用户名"查**，且只覆盖一部分吧。
3. `pb/page` 的 `userList[].levelId` —— 他在**该吧**的等级（§5 #17），"点了才查"走的就是这条。

`getHiddenLikeForum` 的形式是 `{ grade: { 吧内等级: { forum_list: [吧名] } }, plain: [吧名] }`，
**等级在 `grade` 的键上**（上游 `likeforum.tsx` 的 `HiddenForums` 就是按 `[level, {forum_list}]` 渲染的）；
只取 `forum_list` 会把等级全丢掉。

由此有两种客观缺失，界面上分别说明（`userForums.ts` 的 `NO_USERNAME_NOTE` / `NO_LEVEL_NOTE`），
**不要当成 bug 去"修"**：

1. 没有用户名的账号（页面显示「贴吧用户_xxxx」，`user.name === ""`）拿不到任何等级——
   实测把用户名 / 贴吧号 / 内部 ID / portrait 四种标识符都喂给 panel，`honor.grade` 全是空的。
2. 有用户名也只列一部分吧；剩下的能从 `profile.user.likeForum` 拿到**吧名**
   （`User_LikeForumInfo` 只有 forumName + forumId，没有等级）。

**第三条路 `core/forumLevel.ts`**（「关注的吧」里没等级的行带「查等级」按钮）：
每个吧最多 1 次取帖 + 3 次 `pb/page`；候选帖优先取他自己的主题帖（他必在 1 楼、必在第 1 页），
没有才退而取他回复过的帖；结果写进 `tbEztbToolboxForumLevelV1`，设置里有「清空吧内等级缓存」。
交叉验证：面板有等级的用户，这条路读出来与面板一致（7 = 7）。

### 4.3 主题帖与回复是两个独立 feed

`UserPostReqIdl` 的 `is_thread` 字段 SDK 从未使用：

| 请求 | 内容 | 原始 title |
|---|---|---|
| `is_thread=0`（SDK 默认） | 该用户**回复别人的帖** | 一律带「回复：」前缀（SDK 会抹掉） |
| `is_thread=1` | 该用户**自己开的主题帖** | 无前缀 |

两个 feed 形状也不同：主题帖没有 `content[]`，正文在 `first_post_content[]`，`forum_name` 直接给出
（不需要 `getForumName` 反查），`processUserPosts()` 对它返回 **0 条**；回复的正文在 `content[]`，
`affiliated`（`postType === "1"`）标记楼中楼。

所以 `core/userPost.ts` 自己构造请求（`loadTopicRows` / `loadReplyRows`），每条打标签
**主题 / 回复 / 楼中楼**；`loadPostPage` 只留给探查脚本，面板不再调它。

**每页 60 条**（实测 uid `3408054413` 第 1、2 页各 60 条且内容不同；只有 19 条主题帖的用户第 2 页直接为空）。
**判断"有没有下一页"不能只看页大小，要按返回 0 条判定**，`mountPagedList` 就是这么做的。

面板里**不合并两条 feed**：合并后页码对不上、跨页时间倒序只能近似。所以「发帖」是
**主题帖 / 回复**两个子页签，各自从第 1 页开始、各点各的「加载更多」。

### 4.4 成分规则与判定强度（思路来自 B 站成分检测器）

规则一行一条，写在设置面板里：

```
名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单 | 发帖所在吧关键词
```

| 判定 | 说明 |
|---|---|
| 分隔符 | 字段用 `|`，关键词用逗号（中英文都行）。**不按空格切**——参考脚本里就有「互动抽奖 #原神」这种带空格的词 |
| 发帖匹配 | 打在该用户主题帖/回复的「标题 + 正文摘要」上（各取第 1 页） |
| 吧匹配 | 打在他关注的吧名上（`getLikeForum`，隐藏时回退 `getHiddenLikeForum`） |
| 发帖所在吧 | 打在他**实际发过帖**的吧名上（规则文本第 6 段，1.5.0 新增）。与"关注的吧"是两回事；放最后一段是为了不动老规则（5 段）的列序，末尾多写一个 `|` 也不会被误读 |
| 证据强弱 | 名单 / 关注的吧 / **主题帖** = 强证据；**回复、楼中楼** = 弱证据（界面标"可能是误判"，标记也淡一些） |
| 排除词 | 命中则整条证据作废（对应参考脚本的 keywordsReverse），用来压住玩梗误伤 |
| 合并 | 同一条规则的多条证据合成一个命中，不会刷屏 |
| 缓存 | 结果带规则指纹（`hashRules`），改规则自动失效；默认 3 天过期 |

### 4.5 楼层号只能额外换一次

发帖 feed 的 `PostInfoList` 有 forumId / threadId / postId / createTime / title / content[]，
**没有 `floor`**（那是 `/c/f/pb/page`、`/c/f/pb/floor` 那侧 `Post` 的字段）。所以要：

```
getComments({tid, pid})  →  /c/f/pb/floor?cmd=303002  →  data.post.floor
```

实测（2026-09-27）对两种行都成立：**普通回复** pid 就是那一楼自己的帖子 ID（`floor=3`）；
**楼中楼** pid 是楼中楼那条，`floor` 是**它所在的那一楼**（实测 2），同一次返回的 `data.post.content`
正好用来说明"回的是哪一楼"。

**pid 必须取正文级 `UserPost.cid`，不能取记录级 `PostInfoList.postId`**：一条记录可以带多条正文
（他在同一个帖子里连发几楼），记录级 pid 是这几行共用的，拿去查楼层会让同一帖的每一行都查回同一层。
实测抽样 24 个用户 187 条记录里有 32 条（17.1%）是这种"一记录多正文"（uid 874540992 第 1 页：一条记录含
3 条正文，记录级 pid 是 112 楼，而第二、三条正文在 111 楼等位置）。live-test 有断言：同一帖两行必须查到**各自**的楼层。

一条回复一个请求，所以做成**点了才查**（`core/replyFloor.ts`），缓存在 `tbEztbToolboxReplyFloorV1`。

### 4.6 隐藏发帖记录：`hidePost` 是唯一信号

用户把发帖记录设为私密时，**两路 feed 都返回 `hidePost=1`、`maskType=3`、`postList` 为空**；
正常用户是 `hidePost=0`、`maskType=1`。实测抽样 108 个真实用户：15 个隐藏、93 个正常，
两者完全对应，**没有一个反例**（说了隐藏还给内容的）。

结论：被隐藏的帖子拿不到（服务端根本不返回），但可以把"对方隐藏了"和"对方没有公开的帖子"区分开。
live-test 有断言 `hidePost=1 的返回里列表必为空`。

> `hidePost` 是 protobuf 的 `uint32`（字段号 2），`{data:{hidePost:1}}` 的字节是 `12 02 10 01`。
> click-test 用它把某个用户的 userpost 响应顶掉，从而**不依赖真实账号的隐私设置**来验证这条路径。

---

## 5. 踩过的坑

重写时别重蹈。编号被别处引用，**只增不改**。

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 按钮看得见、点不动 | 新版 `.btn-wrapper` 是 `pointer-events:none`，子元素继承后无法命中 | 按钮加 `pointer-events:auto !important` |
| 2 | 点了完全没反应 | `<a href="javascript:void(0)">` 被油猴沙箱拦截 | 改用 `<button type="button">` |
| 3 | 按钮浮在本该遮住它的图层之上 | 我为修 #1 把 z-index 提到 `2e9` | z-index 只能是 **5**（与基线一致）；#1 的真正解法是 pointer-events |
| 4 | 列表内容错位 | 标题/副标题是 `<span>`（inline），`overflow+ellipsis` 对行内元素无效 | `.tb-eztb-row-main` 用纵向 flex；标题/副标题 `display:block` |
| 5 | 切回访问过的页签不生效、内容错乱 | 所有页签共用一个容器 + 记"已初始化"集合：切回被提前 return；上一个页签的异步回调会覆盖当前内容 | 每页签独立容器，切换只切显隐 |
| 6 | **旧版贴吧页面完全没有按钮** | 与旧脚本共用标记属性 `data-tb-eztb-done`，旧脚本先跑把元素标记完，本脚本全跳过 | 改用 `data-tb-eztb-toolbox-done`；检测到旧脚本按钮时提示卸载 |
| 7 | 发帖列表全显示"未知贴吧" | `getUserPost(id, page, false)` 跳过了吧名解析 | 传 `true`（或走新的 `userPost.ts`） |
| 8 | 手写 protobuf 请求抛 `Cannot convert undefined to a BigInt` | 生成的 `encode` 用 `字段 !== 默认值` 判断写入，传部分对象时缺失的 int64 变成 `undefined` | 必须走 `fromPartial` 补全默认值 |
| 9 | 旧脚本按钮点不动 | 它的 `javascript:` href 被油猴剥掉，anchor 无 href | 卸载旧脚本（本脚本会提示） |
| 10 | MHTML 快照里找不到脚本样式 | **MHTML 保存会丢掉 `<style>`** | 别把"没有样式"当成脚本没运行的证据 |
| 11 | 浏览器报 `Invalid regular expression: missing /`，位置指不出来 | 内联脚本写在 Node 模板字符串里，`/\n/g` 的 `\n` 被 Node 提前换成真换行，正则被截断 | 浏览器看到的那份要写 `\\n`；click-test / page-test 现在先把页面内联脚本过一遍 `new Function` 做语法自检。同类还有正则转义：`/Lv\.\d+/` 会变成 `/Lv.d+/`，断言静默失效——能不用转义就别用，必须用时写双份 |
| 12 | 设置面板打包后出现 3000+ 字符的超长行，踩到"未压缩"检查 | esbuild 重排 AST 时会把一整条 `a + b + c` 拼串压成一行 | 改成 `parts.push(...)` 逐行拼（语句不会被合并），最长行回到几百字符 |
| 13 | 成分标记的命中测试失败，但元素明明在 | 上一步打开的面板遮罩是 `z-index:2147483647` 的全屏 fixed 层，`elementFromPoint` 只能拿到遮罩 | 断言前先关面板 |
| 14 | 新版页面上成分标记"轻微"压住正文 | 新版头部行写死 40px（`.image-text .user-info{height:40px}`），而标记容器当时 `flex-wrap:wrap`，命中 2~3 条就折行，实测溢出 12.5~13px | `.tb-eztb-badges` 改 `nowrap` + `min-width:0` + `overflow:hidden`，`.btn-wrapper` 加 `:has()` 收缩规则；JS 按 `.head-spacer` 剩余宽度决定显示几个标记，放不下退成 `+N`，再放不下退成一个圆点 |
| 15 | 想复现 #14，快照里却量出"没有重叠"，差点得出"不存在这个问题" | MHTML 只存**内联** `<style>`，外部 CSS 只剩链接；而 `.head-line{display:flex}`、`.image-text .user-info{height:40px}` 全在外部 `pb.*.css` | 新增 `scripts/fetch-sample-css.mjs` 把快照引用的 CSS 抓到 `../test0/_css_cache`，page-test 用本地路由 `/css/<name>` 喂回去 |
| 16 | Node 里调 `getPosts` 报 `Cannot read properties of undefined (reading '0')`，一个请求都没发 | 签名是 `getPosts(tid, page, options)`，我按 `getPosts({tid, page, rn})` 调，`page` 变 undefined 走进了多页分支的 `page[0]` | 看签名再调；"本地就炸且没发请求"的错优先怀疑参数形状 |
| 17 | 以为从帖子页读不到"某人在某吧的等级" | `pb/page` 的楼层 `author` 是空的，数据在同级 `userList[]` 里（按 `authorId` 对应） | 读 `userList`，`levelId` 就是该吧等级（§4.2 第三条路） |
| 18 | "楼中楼被标记为 sub""needForumName 能解析吧名"两条断言无故失败 | **样本问题**：它们拿"某个吧第一页的前几个作者"当样本，而那几个人恰好没发帖 / 没有楼中楼 | 扩样本：多取两个吧的作者，在名单里**找符合条件的那个**，别赌第一个；单个用户取数失败要 `try/catch` 跳过（有个 id 会回 `errno 300000`） |
| 19 | click-test 里"隐藏了发帖记录"的桩一次都没命中 | 请求体里找 user id 用了 ASCII 字符串，但 proto 里 **`userId` 是 int64，走 varint 编码** | 按 varint 字节匹配（`varintBytes(uid)`）。另外 protobuf 请求是 **multipart/form-data**（字段名 `data`、filename `file`），不是裸二进制 |
| 20 | 断言"点查楼层后换成 N楼"报失败，但功能正常 | 我读的是 `floorBtn.parentNode`，而 `button.replaceWith(span)` 之后原按钮的 `parentNode` 变 null | 点击前先记住所在行（`closest('.tb-eztb-row')`），断言去行里找；"等 `!isConnected`"本身在替换那一刻就成立，不能当"被重建"的证据 |
| 21 | 新加的「检测签到号」按钮复用 `.tb-eztb-levelbtn`，老断言点错按钮 | 测试按类名找「查等级」按钮（`querySelectorAll('.tb-eztb-levelbtn')[0]`），新按钮排在前面 | 每种小按钮用自己的类名（`tb-eztb-levelbtn` / `tb-eztb-floorbtn` / `tb-eztb-minibtn`），样式用逗号选择器共享 |
| 22 | 「查楼层」对同一帖里的多行回复显示同一个楼层 | 行上的 pid 取了记录级 `PostInfoList.postId`，而一条记录可以带多条正文 | 改取正文级 `UserPost.cid`（见 §4.5）。实测 187 条记录里 32 条多正文（17.1%）；live-test 加了"同帖两行各查各的楼层" |
| 23 | 「检测签到号」实际发 11 个请求，代码与文档都以为只有 2 个 | 回复 feed 不返回吧名，要按 forumId 反查；而 SDK 自己的 names 缓存**每次 `Effect.runPromise` 都重建**（模块级存的是 Effect 而不是解析后的 Cache） | 在 `core/userPost.ts` 加跨调用的吧名缓存（`forumNames`，上限 500）。实测同页第二条回复的请求数 11 → 2；live-test 有"第二次不再重复反查" |
| 24 | 用户报「查询按钮有时部分遮挡楼层正文」 | 回复行的正文块 `.comment-content` 会往上顶到头部行（`.head-line.user-info`，写死 40px）的下半部分：实测行 247\~287、正文从 y=271 开始，而按钮垂直居中占 255\~279 | 这类行（`.head-line:has(+ .comment-content)`）把按钮/标记贴到行顶（`align-self:flex-start`）。修复后逐行复查 0/23。判据不能看包围盒相交（会把同行的空槽也算上），要看"**把按钮藏起来再取同一个点**"命中的是谁；脚本自己的 CSS 写了 `visibility:visible !important`，所以探针要用 `style.setProperty(..., 'important')` 才藏得掉 |
| 25 | page-test 加载「网页，完整」快照时**所有外部 CSS 404**，页面又变回无样式 | 我把 HTML 里的 `<标题>_files/` 改写成 `/files/`，`./<标题>_files/x.css` 于是变成 `.//files/x.css`，浏览器按"协议相对 URL"解析 | 不再改写 HTML，按原目录名提供文件（`/<标题>_files/…`）；剥掉快照里的页面脚本（`xxx.js.下载` 离线取不到，残留内联脚本会抛 `_typeof is not defined`，把"无 JS 错误"断言染红）。修好后 pb.css 1765 条规则真的生效，异常行数立刻从 1 涨到 20——才看见 #24 |
| 26 | 「发帖」页签初次点进时，饼图**有时**只统计主题帖 | 回复行的吧名靠 `getForumName` 反查，失败时 `forumName` 是空串，而按吧统计把**空吧名直接 continue**，回复条数整批消失。之所以"有时"，是因为反查偶发失败（另有一次某 uid 的 userpost 直接回 `errno 300000`，那一路连行都没有） | ① 空吧名归到常量 `UNKNOWN_FORUM`（「未知贴吧」），**统计口径必须一条不少**；② 反查失败重试一次（失败结果带 5 分钟过期）；③ 分页列表加 `onError`，某一路取数失败会把提示写在**饼图旁边**（原来只显示在被隐藏的子页签里） |
| 27 | 「其它 N 个吧」占比很大时，看不出是哪些吧 | 饼图按设计只画前 5 个 | `buildForumListHtml`：底部一个「查看全部 N 个吧的占比」按钮，展开后每个吧一行（吧名 + 横条 + 条数 + 占比，按条数排序）。展开状态存在面板闭包里，因为 `updatePie` 每次都重建 innerHTML |
| 28 | click-test 里"饼图"那批断言（含"饼图条数 = 已加载行数"）**一条都没进结果**，却被当成"测过了" | ① 等待写在 `until(..., 30 秒)` 的超时回调里，而全局兜底 `finish()` 先执行，超时后新加的断言已经随结果发走；② 判据里的 `\d` 被 Node 吃掉一层变成 `/(d+)/`，永远匹配不上（#11 的同类） | 等待挪到主链上（上限 12 秒、超时如实报出来），判据改成直接和两路子页签的行数比对，并补一条**同步**断言（点开「发帖」的瞬间必须看到"数据还在加载"）。教训：**断言数量增加不等于覆盖增加**，写完要确认它真的跑了 |
| 29 | 「初次点进时饼图有时只统计主题帖」的**时序**成因 | 回复那一页要按吧反查，而反查当时排在 400ms 的串行队列里：实测 uid 3408054413 主题帖 511ms 到、回复 **8577ms** 才到（`dist/.verify/pierace.mjs`）。这 8 秒里饼图只有主题帖，看起来却像完整结果 | ① 图上写明「「回复」的数据还在加载，下面的占比还不完整」；② 从**主题帖 feed 白捡** id→吧名（实测回复页 12 个唯一吧里能白捡 8 个，零请求，`dist/.verify/harvest-value.mjs`）；③ 反查改有界并发（§3.2）。实测回复 8577ms → 1824ms、窗口 8066ms → 1285ms、请求 11 → 5。两个 feed 的正文请求仍严格串行 |
| 30 | 「吧名缓存第二次不再请求」这条断言一直通过，其实**什么都没测** | 同一进程里前面已经取过那个用户的回复页，`forumNames` 是热的，量出来"第一次 +0、第二次 +0"，两边相等，断言恒真 | 打断言前先 `clearForumNameCache()`，并断言"第一次 > 0 **且** 第二次 == 0"，只写"两次相等"不够 |
| 31 | 一个**变异测试用的临时行**被别人的提交带上了 `main` | 做反向验证时在 `rememberForumNames` 顶部临时插了 `return items; // ★变异测试用`，而协调方那两分钟里正好 `git add -A` 提交推送 → 那个提交把"白捡吧名"整个关掉（src 与 dist 都提前返回），回复那一路退回每吧 400ms 串行反查，只是被"数据还在加载"的提示盖住 | 立刻撤掉并重建产物（`4946ef3`），并核对用户装的 raw 产物里 `rememberForumNames` 是先 harvest 再返回。教训：**变异测试的改动不要在工作区里久留，尤其别跨越并发提交的窗口**——要么在仓库副本里做，要么改完立刻还原并 `git status` 确认干净 |
| 32 | 复查揪出两处：① 某一路"第一页成功、翻后页失败"时仍写「饼图里缺这一路」，可前面几页的条数明明算进去了；② 面板与「成分 / 签到号检测」同时取同一页回复时，吧名反查各发一遍（实测 9 个吧发了 15 次） | ① `buildPieNotes` 没有"这一路有没有已经加载出来的行"这个信息；② `resolveForumNames` 的 `wanted` 是开头算一次的，轮到某个 id 时另一条路径可能已经把它取回来了——**in-flight 去重挡得住"同时在飞"，挡不住"已经写进缓存、只是不在我的 wanted 快照里"** | ① `PieFeedState.hasRows`：取到过行就改说「后续页没取到（饼图只统计到已经加载出来的那部分）」；② 反查加按 id 去重的 in-flight 表，并在**取数前**与**等完限速名额后**各回看一次缓存。实测两路并发 15 次 → 9 次（正好等于该页唯一吧数）；live-test 加了自归一断言（不去重会是唯一吧数的两倍） |
| 33 | 提交信息与内容不符 | `3b183b2` 的信息是 `docs: 把子代理提到的两个小遗留记进「可以继续做的事」`，实际同时带了 #32 的**代码修复**（`postStats.ts` / `userPost.ts` / `userPanel.ts`）、两份测试的改动与重建的产物。看 `git log --oneline` 会以为那一版只动了文档 | 把 §9.2 里那两条（同一提交已经修掉的"遗留"）移走、在 §9.1 补记归属；以后 `docs:` 只提交文档，动代码或产物写 `feat:` / `fix:` |
| 34 | 仓库里其实**没有可用的类型检查**：`tsc --noEmit` 报 100+ 个错 | 根 `tsconfig.json` 只有 `baseUrl` 和一条指向 `../eztb/packages/sdk/dist/index.d.ts` 的 `paths`——那个 `dist` 根本不存在（SDK 从**源码**消费）；而 src 里的相对导入带 `.ts` 后缀，又用了 `tieba.js` / `tieba.js/generated/*` / `eztb-internal/*` / `effect` 这些构建期别名，`tsc` 一个都解析不到。能跑的配置此前只存在于被 gitignore 的 `dist/.verify/tsconfig.check.json` 里 | 把配置并进根 `tsconfig.json`（`allowImportingTsExtensions` + 与 `shims-plugin.mjs` 对齐的 `paths`，注释里写明要一起改），新增 `scripts/typecheck.mjs`（从上游借 typescript，缺了会报出路径），并写进测试清单 |
| 47 | 面板刚打开、页面还在「正在解析用户信息…」时点别的页签，解析完仍然停在默认页签——用户看到的是"点了没反应、内容一直是加载中" | 页签点击的绑定写在 `resolveIdentity()` **之后**：解析这段时间里根本没有监听器。而页签按钮此时已经能点，因为 `openDialog` 自己绑了一份点击（只负责高亮）——于是出现"按钮高亮切了、内容没切" | 点击**立刻**绑定（`requestedTab` 记下最后点过的页签），解析完成按 `switchTab(requestedTab, identity)` 渲染。click-test 阶段 9 用**同步点击**复现（网络回调必然晚于当前这一帧，所以点击一定发生在解析中）；反向验证：把 `requestedTab` 换回 `initialTab` → 该断言必红（实测"可见页签=profile"） |
| 35 | 从面板底部点「设置」之后，旧面板的捕获阶段 keydown 监听器永远留在 document 上，`onClose` 也从不触发 | `closeOpenDialog()`（`ui/modal.ts`）只做了 `document.querySelector(".tb-eztb-mask")?.remove()`，而摘监听器/触发回调/还焦点都在 `close()` 里；`openDialog()` 一进来就调 `closeOpenDialog()`，正好走这条路 | 把当前弹窗的 `close` 存在模块级 `activeClose` 上，`closeOpenDialog()` 改成调它（再兜底 remove 一次）。1.8.0 顺带补了 `role="dialog"` / `aria-modal` / 焦点陷阱 / 关闭后把焦点还给打开它的按钮。**今天没有可见症状**（没人传 `onClose`），但只要有人用 `onClose` 做清理就会变成真 bug |
| 36 | 「明明查过了，重开面板还是重新请求」——因为缓存根本没写进去 | 五个缓存模块各自 `try { GM_setValue(...) } catch { /* 忽略存储失败 */ }`，写失败是静默的。另外整张表 JSON 塞进单个 value，条数一多会撞油猴的存储配额 | 抽 `core/kvCache.ts`：统一实现 + 把失败记进 `getStorageIssues()`（诊断面板会显示）+ 失败时砍掉一半重试一次。**以后新增缓存一律用它，不要再抄第六份** |
| 37 | 产物 NOTICE 里 SDK 的来源是 `Dilettante258/tieba-toolbox`，许可写的是"未声明"，`verify.mjs` 还把这两条**断言**了 | 来源 URL 手写、仓库后来改名成 `eazy-tieba`；而 `packages/sdk` 其实是 **submodule**（指向 `Dilettante258/tieba.js`），它的 `package.json` 里明确写着 `license: ISC`。"没有 license 字段"这个结论从来没核对过 | NOTICE 改成构建时由 `scripts/deps-info.mjs` 从磁盘上的 `package.json` + `git rev-parse HEAD` 生成；加 `sdk.lock.json` 锁版本，构建对不上就失败；`verify.mjs` 的期望值也从同一份数据算出来。**教训：断言里写死的外部事实要有出处，否则等于把错误钉成了测试** |
| 38 | 给缓存条目加了一个**必填**字段之后，`userPanel.ts` 一行没改却冒出 20+ 个「Property 'x' does not exist on type '{}'」 | `renderProfile` 里是 `const profile = identity.profile ?? {}`。原来 `CachedProfile` 属性全可选，`{}` 可赋给它，TS 的联合类型收敛把它化简掉了；`ts` 一旦变成必填，`{}` 不再可赋给 `CachedProfile`，联合就退化成 `{}`，取任何字段都报错 | 给面板侧单独一个 `ProfileData = Omit<CachedProfile, "ts">`（属性全可选），`Identity.profile` 用它。**给"存进缓存的数据"加必填字段时，留意有没有地方在用 `?? {}` 兜空** |
| 39 | CI 里「重建后 `git diff --exit-code -- dist` 必须为空」从第一天起就会红，而原因**不是**"忘了重建产物" | 工作流 clone 的是上游 `v3` 的**尖端**，而 `sdk.lock.json` 锁的是某个具体提交：v3 一直在动（2026-09-28 实测尖端 `8ca0637c` 的 `packages/sdk` 已经是 `db48716f`，不是被锁的 `338a81e`），拿尖端构建出来的产物自然与仓库里提交的那份不同 | 工作流改成按 `sdk.lock.json` 的 `eztb.commit` 检出上游（`fetch --depth 1 origin <sha>` → `checkout --detach` → `submodule update --init --recursive`），`sdk.lock.json` 也新增 `eztb` 段锁住上游检出。**只锁 SDK 不够**——被锁的 SDK 提交要靠某个确定的上游提交带出来（本机模拟过整条链路：fetch-by-sha、子模块落到 `338a81e`、两个不同位置的上游构建出同一份产物） |
| 40 | 同一份源码在两台机器上构建出的产物**逐字符不同**，CI 的产物同步校验永远过不了 | esbuild 给每个模块加一行 `// <路径>` 注释，路径按 `absWorkingDir` 算相对值；落在它之外的模块（上游 `packages/sdk/**` 与 `node_modules/**`）就会带上相对甚至绝对前缀——本机是 `../eztb/...`，工程深一层是 `../../eztb/...`，跨盘时是 `E:/...`，CI 里是 `/home/runner/work/.../eztb/...`。实测：只差这些注释行，代码逻辑完全一致 | `build.mjs` 显式 `absWorkingDir: __dirname`，写文件前用 `stabilizeModuleComments()` 把两类注释分别收敛成 `<eztb>/packages/sdk/...` 与 `<eztb>/node_modules/...`（node_modules 以下保留，还能看出哪个文件被打进来）。**两条规则缺一不可**：只收敛 SDK 的话，换目录布局仍有 306 行注释不同；补上 node_modules 那条之后，实测「工程与上游同级」和「工程比上游深一层」两种布局的产物 sha256 完全相同（`72E3CC74…`） |
| 41 | 弹窗焦点陷阱看着生效，**反向 Tab** 却会退到遮罩后面的页面元素上（正向 Tab 看不出来） | `openDialog()` 打开时把焦点放在弹窗容器本身（`tabIndex = -1`），而判定"焦点在不在弹窗里"用的是 `dialogEl.contains(document.activeElement)`——容器自己是 true，于是 `Shift+Tab` 不满足回卷条件，浏览器默认行为就把焦点交给了遮罩后面页面里的可聚焦元素。正向 Tab 碰巧因为 DOM 顺序（容器后面紧跟着第一个按钮）看起来是对的 | 判定改成"当前焦点是不是**可聚焦项列表**里的一个"：容器自己、禁用项、隐藏项一律算"在外面"，两种方向都回卷。补了 6 条无头浏览器断言，用 `dispatchEvent()` 的返回值判断有没有被 `preventDefault`（返回 false = 拦下了），所以这几条在旧写法上会红 |
| 42 | 深色模式下饼图的"空数据底环"是一圈刺眼的亮灰 | 1.8.0 把 `styles.ts` 的硬编码色值全换成了变量，但**颜色不止在 CSS 里**：饼图那段 SVG 是在 `core/postStats.ts` 里拼字符串生成的，底环写死 `stroke="#eef0f3"`。CSS 变量换不掉它——写死的 SVG 颜色没有任何地方能兜住 | 底环改成 `<circle class="tb-eztb-pie-track">` + `--tb-eztb-pie-track`（亮 `#eef0f3` / 深 `#343a41`）。`verify.mjs` 加一条"产物里没有写死的 `stroke=`/`fill=` 色值"，`click-test.mjs` 加**一整遍深色模式**（见 §6）。**教训：换配色时要把 TS 里拼出来的 HTML/SVG 也扫一遍** |
| 43 | 诊断报告里那句"最近的日志（最多 20 条）"几乎永远是空的 | `core/log.ts` 建好了，但只有 `main.ts` 三处在写它；其余错误路径（`scanner.ts`、`compositionScan.ts`、`userPanel.ts`、`settings.ts`、`kvCache.ts`）仍然是裸 `console.warn`。于是用户真正遇到的失败**不进环形缓冲**，报告里只剩"已加载"一行 | 那些 `console.warn` 全部改走 `log.warn`；`verify.mjs` 新增 V8 扫 `src/**`，禁止绕过 `log.ts` 的 `console.warn`/`console.error`（`log.ts` 自己除外）。**诊断面板的价值取决于"出事的地方愿不愿意往环里写"** |
| 44 | 装过更新版本的人退回旧版后，设置里的新字段被静默抹掉 | `migrate()` 的回写条件是 `changed: startVersion !== SETTINGS_SCHEMA_VERSION`：存储里是 v3、脚本是 v2 时，`changed` 也为 true，于是**读一次就把 v3 专有字段写没了**（`normalizeSettings()` 会丢掉未知键）。等用户再升回新版本，那几项设置已经永久丢失 | 改成只在**升级**时回写（`startVersion < SETTINGS_SCHEMA_VERSION`）。未知字段这一版仍然读不出来，但至少不会毁掉磁盘上的数据 |
| 45 | 导入 `{"settings": []}` 会报"导入成功"，实际什么都没导入 | 判空用的是 `typeof holder.settings === "object"`，而数组也是 `"object"`，展开后是空对象，于是合并结果 = 现有设置，却回了 `ok: true` | `settings` 是数组（或不是对象）时明确报错。**导入这种"看起来成功了"的路径宁可直接失败** |
| 46 | 万一 `onClose` 回调抛错，"先关旧的再开新的"这一步会断在半路 | `openDialog()` 一进来就 `closeOpenDialog()`，异常会从 `close()` 里穿出来，新弹窗根本开不了 | `close()` 里把 `onClose` 包进 `try/catch` 记 `log.warn`。关窗这件事必须总能成功 |

### 排查方法论

- 用无头 Edge 抓真实 DOM（curl 会被百度 403 / 安全验证挡住）。
- 用户保存的 `.mhtml` 快照是**最好的证据**：能看出哪个脚本跑过、留下了什么。
- **反向验证**：把修复改回坏的样子，断言必须失败（做过：pointer-events、布局、页签容器、饼图弧长、签到判定、成分第 6 段、楼层 pid、回复正文渲染）。
- **变异测试在仓库副本里做**（§5 #31 的教训），改完立刻还原并 `git status` 确认干净。
- 写完断言要确认它**真的跑了**（#28），也要确认它不是恒真的（#30）。
- 涉及协议或数据模型，先打真实数据：`EZTB_PROBE=1 node scripts/live-test.mjs` 或
  `node scripts/probe-user.mjs <portrait|ID> [吧名]`，不要凭推测改。

---

## 6. 测试设施

**五套测试 + 一次类型检查 + 三个工具**，全部不需要 BDUSS（用假 BDUSS，proto 接口本来就不带它）：

```powershell
cd <本项目目录>
node build.mjs                     # 未压缩可读版（Greasy Fork 要求）
node build.mjs --minify            # 需要小体积时另存 dist/tieba-eztb-toolbox.min.user.js
node scripts/typecheck.mjs         # 类型检查
node scripts/verify.mjs            # 签名比对 + 产物检查 + 内嵌依赖自检 + Greasy Fork 要求 + 源码卫生（51 项）
node scripts/keyword-test.mjs      # 规则 / 饼图 / 签到的纯离线测试（70 项）
node scripts/live-test.mjs         # 真实接口链路（33 项）
node scripts/click-test.mjs        # 无头浏览器 + 真实数据交互（170 项，其中深色模式 16 项）
node scripts/page-test.mjs         # 真实页面快照回归（项数取决于本机有几份快照，见下）

# 也可以直接用 package.json 里的脚本：npm test / npm run test:live 等
# （本机没有 npm，`npm run` 只是给有 npm 的人看的；直接敲上面的命令即可）

node scripts/probe-user.mjs <portrait串|数字ID> [吧名]   # 打原始返回 + 展平后的发帖行
node scripts/extract-mhtml.mjs "某个.mhtml"              # MHTML → 可加载的 HTML
node scripts/fetch-sample-css.mjs                        # 换 MHTML 快照后抓一次外部 CSS
$env:EZTB_PROBE=1; node scripts/live-test.mjs            # 打印原始 feed 结构、is_thread 对比等
```

| 脚本 | 机制 | 能抓到什么 |
|---|---|---|
| `typecheck.mjs` | 用根 `tsconfig.json` 跑 `tsc --noEmit`（typescript 从上游借） | 别名解析、参数形状、字段是否存在（esbuild 不做类型检查） |
| `verify.mjs` | 把 SDK 的 `packRequest` 分别用 Node crypto 与浏览器 shim 跑一遍逐字符比对；另把 Greasy Fork 的硬性要求写成 V7 一组断言；内嵌依赖的版本/许可/提交号与 `sdk.lock.json` 核对 | 签名错误（错了极难排查）、手滑改成压缩版、元数据漏项、NOTICE 与真实依赖脱节 |
| `.github/workflows/ci.yml` | push / PR 上跑 `typecheck` → `build` → `git diff --exit-code -- dist` → `verify` → `keyword-test`；`live`/`click`/`page` 放在 `workflow_dispatch`。上游按 `sdk.lock.json` 的 `eztb.commit` 检出，产物里的路径已收敛成机器无关的写法 | 改了源码忘了重建产物。**2026-09-28 已在 GitHub 上实跑通过**（`main@e3ef7ea`，见 §9.1）：按 SHA 取上游、`bun install --frozen-lockfile`、产物同步校验、verify、keyword-test 全部 success。`browser-suites` 那个 job 仍是 skipped（只在 `workflow_dispatch` 跑），所以真机三套在 CI 上还没验过 |
| `keyword-test.mjs` | 打包真实的 `composition.ts` / `postStats.ts` / `activityRule.ts` 三个纯逻辑模块做断言 | 成分规则、饼图算法、签到判定改坏（离线即可发现） |
| `live-test.mjs` | Node fetch 顶替 GM_xmlhttpRequest，打真实贴吧匿名 proto 接口 | 协议、鉴权、数据模型、翻页、真实数据跑关键词、隐藏关注贴吧的恢复、**"点了才查"的等级与楼层交叉验证** |
| `click-test.mjs` | 本地起同源服务（托管页面 + 转发请求到贴吧 + 收集结果），无头 Edge 注入脚本 + GM 桩做 DOM/布局/交互断言，结果 POST 回 Node。**跑两遍**：亮色那一遍走完整流程，深色那一遍加 `--blink-settings=preferredColorScheme=0`（实测这个值才是深色，1/2 都是亮色）只做配色与对比度 | 注入、命中测试、渲染、排版、页签与子页签翻页、刷新、成分标记、查等级、菜单命令、诊断面板能开合、弹窗焦点陷阱（含反向 Tab，§5 #41）、**深色模式的底色/底环颜色/文字与徽章对比度/无残留白底**（§5 #42） |
| `page-test.mjs` | 读真实快照（「网页，完整」自带 `<标题>_files/` 的 CSS；MHTML 需先抓 CSS），同一份跑正常宽度与 420px 窄容器两遍 | 只有真实页面才暴露的问题（#6 标记撞名、无规则时不注入标记、#14 头部行排版、#24 按钮压正文） |

> **page-test 的断言数不是固定值**：它按找到的快照逐个跑，而快照是 gitignore 的
> （含真实帖子内容）。本机 2026-09-28 有 4 份可用快照，跑出 68 项；旧文档里记的
> "34 项"是当时快照更少时的数字。**看到项数变了先确认快照目录，别急着怀疑测试坏了。**

### 环境依赖

- 已装：Node v24、Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）。
- **没有 `bun`、没有 `npm`**：不要在方案里依赖安装步骤。
- esbuild、`effect`、`@bufbuild/protobuf`、`long`、typescript 都从上游借：
  `../eztb/node_modules`（`EZTB_ROOT` 可覆盖）。
- page-test 的样本：仓库里的 `dist/.samples/`（「网页，完整」那种自带 CSS，不用额外准备）；
  用 MHTML 快照时才需要 `node scripts/fetch-sample-css.mjs`（抓到 `../test0/_css_cache`，见 #15）。

---

## 7. 当前功能

点击任意用户名旁的 **「查询」** 打开面板，六个只读页签：

| 页签 | 内容 |
|---|---|
| 资料 | `getProfile`：贴吧号、用户名、昵称、等级、吧龄、发帖数、粉丝/关注数、IP 属地、会员、吧务、简介 |
| 成分 | 命中的规则、原因（名单 / 关注的吧 / 哪条帖子）、命中的关键词与原文片段（高亮），以及本次扫描统计（含"其中 N 个吧来自隐藏关注贴吧的恢复"） |
| 关注的人 | `getFollow`，分页加载（每页 20） |
| 关注的吧 | `getLikeForum`（带 Lv.N 与称号），空则回退 `getHiddenLikeForum`（等级取自 `grade` 的键）；没等级的行带「查等级」（点了才查，§4.2） |
| 粉丝 | `getFans` |
| 发帖 | 拆成 **主题帖 / 回复** 两个子页签，各自独立翻页；每条标注 **主题 / 回复 / 楼中楼**，回复与楼中楼显示**回复正文**、带「查楼层」（点了才查，§4.5）；页签顶部是**「发帖都发在哪些吧」的占比饼图**，饼图下面可以**只看某个吧** |

其他：

- **发帖饼图**：按**吧**统计（1.6.0 起，用户要求），前 5 个各一段、其余合成「其它 N 个吧」，
  用 SVG `stroke-dasharray` 画（不用 path 弧线：只有一个分类占 100% 时弧线起终点重合会算出 NaN；纯字符串生成、离线可测）。
  进页签时两路 feed 各取一页；吧名没解析出来的行算进「未知贴吧」，**绝不丢条数**；某一路取数失败在饼图旁写明；
  没到齐时写明「还在加载，下面的占比还不完整」（§5 #26/#28/#29）。下方「查看全部 N 个吧的占比」可展开每个吧一行（§5 #27）。
- **「关注的吧」里的「检测签到号」**：点了才取数（两路 feed 各一页），按吧统计他最近在哪儿发言，
  标出「吧内等级 ≥ 门槛、最近这批帖子里该吧 0 条发言」的吧，并给每行补「近期发言 N 条」。
  结论里必须同时写明判定条件与样本大小（`activityRule.ts` 的 `signInSummary`）——样本只有最近一页，
  不能写成"他从来不发言"；门槛在设置里（`signInLevelThreshold`，默认 6）。
- **隐藏发帖记录时说清原因**（§4.6）：不写"没有公开的主题帖"，而是「发帖信息设为私密」。
- 面板底部 **「刷新当前页签」**：重新解析用户 + 重建当前页签，其它页签保留；「发帖」里刷新后回到原来选中的子页签。
- **「发帖」里按吧筛选**：下拉框列的是**他已经发过言的吧**（带条数，1.8.2 新增），选中后两个子页签
  一起只留这个吧的行，旁边写明"筛的是哪个吧、多少条"。实现上只切行的 class（DOM 留着），
  所以翻页新加载的行会被同一套规则筛；**饼图保持全量**（筛成一段没有信息量）。
- **打开面板时默认停在哪个页签可以设置**（1.8.2 新增，默认「资料」）：页签名单在
  `core/panelTabs.ts`，面板、设置面板、设置存储共用这一份；页面上的「成分」标记仍直接开「成分」。
- **页面成分标注**：配好规则后，命中的用户在「查询」旁多一个彩色标记，hover 写原因，点它直接开「成分」页签。
  显示几个由头部行剩余空隙决定（最多 3 个，放不下收成 `+N`、再放不下退成一个圆点），**任何情况下都不折行**（§5 #14）。
- **设置导入 / 导出**（1.8.0）：设置面板底部「导出到文本框 / 复制 / 从文本框导入」。
  导出**不含 BDUSS**，导入**不读 BDUSS**——这条是硬规则，写在 `settings.ts` 的注释里，
  以后改这段代码别破坏它（用户会拿这个文件互相传规则表）。
- **深色模式**（1.8.0）：配色全部走 `--tb-eztb-*` 变量，跟随 `prefers-color-scheme`。
- 脚本菜单：设置 BDUSS / 运行参数、清空用户资料缓存、清空成分缓存、重新检测本页用户、
  诊断当前页面、**中断当前所有在飞请求**（1.8.0）。
- 页面适配：旧版（`.l_post` / `.p_author_name` / `.lzl_cnt > .at`）、新版（`.head-line`）。

---

## 8. 需要用户配合的事

1. **每次改完都要重装脚本**（油猴里覆盖，或用 README 的 raw 链接）。
   注意 1.3.1 起脚本改过名（去掉「（本地直连版）」）：`@name` 变了之后油猴会把新版当成另一个脚本，
   要先删旧条目再装——**但设置存在脚本存储里，换条目会一起清掉**，需要重新粘 BDUSS 与关键词规则。
   所以优先"覆盖"而不是"删了重装"。
2. **必须卸载旧脚本 `tieba-eztb-follow.user.js`**：它的按钮已失效（href 被剥掉），还会与本脚本抢 DOM 标记。
3. 遇到"某类页面不出按钮"，用菜单里的 **「eztb：诊断当前页面」** 复制报告，
   或把该页面另存为 `.mhtml` 放进快照目录（默认同级 `../test0`，或本仓库 `dist/.samples/`）。
4. 要传 Greasy Fork：直接用 `dist/` 那份产物（元数据已指向本仓库）。
   SDK 的授权问题 1.8.0 已经查清（ISC，见 §9.4 与 `THIRD-PARTY.md`），
   原来卡在这里的那条不再是阻塞项；剩下可选的一步是向上游要一份正式 `LICENSE` 文件。

---

## 9. 版本状态

> 按版本倒序。机制细节在 §4、踩坑在 §5，这里只记"做了什么、什么状态"。
> 更完整的逐条记录看 `git log`（仓库已公开）。

### 9.1 已完成

**1.8.2 · 用户提的三件事（切页签丢失 / 发帖按吧筛选 / 默认打开页签）+ 上游锁定更新**

| 事项 | 做法 | 验证 |
|---|---|---|
| 解析中点页签会被丢掉（§5 #47） | 页签点击改成**立刻**绑定，用 `requestedTab` 记下最后点过的页签，解析完按它渲染 | click-test 阶段 9：**同步**点击复现（网络回调必然晚于这一帧）+ 反向验证（把 `requestedTab` 换成 `initialTab` → 该断言必红，实测"可见页签=profile"） |
| 「发帖」加**按吧筛选** | 行上带 `data-forum`（空吧名归「未知贴吧」，与饼图同一口径）；下拉框选项与提示抽成纯逻辑（`buildForumFilterOptionsHtml` / `buildForumFilterHint`）；筛选只切行的 class，所以翻页新加载的行走同一套规则；**饼图保持全量** | keyword-test 6 项（按条数排序 / 还原选中 / 吧名转义 / 两种提示 / 不筛选时空串）+ click-test 7 项（下拉框来自已加载的行、默认「全部吧」、只剩该吧、确实筛掉别的吧、按布局量确认真的不可见、提示带吧名与条数、切回全部恢复） |
| 设置里的**「打开面板时默认停在」** | 新增 `core/panelTabs.ts` 作页签注册表（面板 / 设置 / 存储共用一份）；`settings.defaultTab` 经 `normalizePanelTabId` 兜底，非法值退回「资料」 | keyword-test 3 项（六个页签齐全 / 默认值 / 非法值兜底）+ click-test 2 项（设置里有这一项且六选一、改成「关注的吧」后新开的面板直接停在那） |
| `sdk.lock.json` 更新到当前上游 | 锁里钉的 eztb 提交是 6/11 的旧线，当前 v3 分支已改写：连它记的 `packages/sdk` 子模块提交都取不到了（`upload-pack: not our ref`），本机构建被自检挡住。现在钉当前 v3 顶端（eztb `8ca0637` + sdk `db48716`，正是本机这份干净的检出） | 产物里 SDK 段**逐字节没变**（只有 NOTICE 的提交号那两行变），说明换锁没引入行为差异；CI 按新提交 depth-1 取上游 + 子模块，比取一个已被改写的提交可靠 |

**1.8.1 · 一轮独立审查后的收尾**

1.8.0 之后做的一轮审查（重点是"改动是不是真的修到位了、有没有修出新洞"），
改的都是**看得见的漏**，没有新功能：

| 改动 | 关键点 |
|---|---|
| **深色模式补完** | 饼图空数据底环原本写死在 `core/postStats.ts` 的 SVG 里（§5 #42），改成 CSS 变量；弹窗加 `color-scheme:light dark`，深色下原生滚动条不再发亮 |
| **深色模式进了自动化** | `click-test.mjs` 现在跑**两遍**：第二遍用 `--blink-settings=preferredColorScheme=0` 强制深色，量底色、底环颜色、文字/徽章/按钮对比度，并断言"弹窗里没有残留的纯白底元素"。**改回旧的写死颜色，亮色与深色各有一条断言变红**（反向验证过） |
| **错误提示统一进日志环** | `scanner.ts` / `compositionScan.ts` / `userPanel.ts` / `settings.ts` / `kvCache.ts` 的裸 `console.warn` 全部改走 `core/log.ts`，诊断报告才真的带得出出错信息（§5 #43）；`verify.mjs` 新增 V8 扫源码守住这条 |
| **设置的两个静默坑** | 未来版本的存储在降级时不再被回写覆盖（§5 #44）；导入 `{"settings": []}` 不再谎报成功（§5 #45） |
| **依赖锁定补强** | `sdk.lock.json` 增加 `sdk.author`（ISC 的版权署名出处）；`deps-info` 在 ISC 但拿不到 `author` 时**直接构建失败**；许可不是 ISC 时不再硬套 ISC 模板；`verify.mjs` 增加了"内嵌库名称+版本""版权署名"两类断言（原来只查来源 URL） |
| **关窗不再可能半路断掉** | `onClose` 抛错只记日志，不影响关窗与"关旧的再开新的"（§5 #46） |

改动完的基线（2026-09-28 本机实测）：typecheck 0 错 / verify 51 / keyword-test 70 /
live-test 33 / click-test 170（其中深色模式 16 条）/ page-test 68，全绿。

**同一天推上 `main` 之后，CI 第一次真跑也通过了**（2026-09-28，`main@e3ef7ea` 的 push 触发）：
`离线校验` job 的每一步都是 success——按锁文件的提交 SHA 取上游、`bun install --frozen-lockfile`、
构建、**`git diff --exit-code -- dist` 为空**、`verify` 51 项、`keyword-test` 70 项。
那条"产物与源码同步"为空是关键：它说明产物在 **Linux runner 上也能逐字节重建**，
原先只在本机成立（§5 #39/#40 那两个坑修掉的直接产出）。
`真机测试（手动触发）` job 按设计 skipped——`live`/`click`/`page` 三套在 CI 上**仍未跑过**。

**1.8.0 · 对标同类项目后的一轮工程化 + 几个具体问题**

起点是 `IMPROVEMENTS.md`（对标 Bilibili-Evolved / aiotieba / Tieba-Remix 等做的一轮调研）。
这一版**没有加新查询功能**，动的是工程与体验：

| 改动 | 关键点 |
|---|---|
| **更正 SDK 的许可与来源** | `packages/sdk` 是 submodule → `Dilettante258/tieba.js`，`license: ISC`。THIRD-PARTY.md / NOTICE / verify 断言三处同时改（§5 #37） |
| **`sdk.lock.json` + NOTICE 自动生成** | 构建时从 `package.json` + `git rev-parse HEAD` 读，对不上就**构建失败**；`scripts/deps-info.mjs`。锁分两层：`sdk`（内嵌的 SDK）+ `eztb`（构建它的上游检出，§5 #39） |
| **CI** | `.github/workflows/ci.yml`：离线三项 + `git diff --exit-code -- dist`（产物同步）；真机三套走 `workflow_dispatch`。上游按锁文件里的 `eztb.commit` 检出，不是 v3 尖端 |
| **产物可复现** | `build.mjs` 把 esbuild 的模块路径注释收敛成机器无关的写法（§5 #40）。换机器 / 换目录构建出的产物现在**逐字符相同**，所以"产物同步"这条校验才有意义 |
| **五个缓存收成一个工厂** | `core/kvCache.ts`；顺带修掉"存盘失败被静默吞"（§5 #36）。磁盘格式没变，老缓存仍可读 |
| **设置有了版本与迁移** | `schemaVersion` + `MIGRATIONS` + `normalizeSettings()`；新增导入/导出（BDUSS 永不进导出文件、永不从导入文件读取） |
| **修掉弹窗关闭的漏监听** | `closeOpenDialog()` 改走 `close()`；补 `role="dialog"` / `aria-modal` / 焦点陷阱 / 关闭后还原焦点（§5 #35） |
| **顺带修掉焦点陷阱的漏洞** | 焦点在弹窗**容器**上时，`dialogEl.contains(activeElement)` 判定为"在弹窗内"，反向 Tab 不会被拦、会退到遮罩后面。改判"焦点是否落在可聚焦项上"。这条是新增的自动化断言查出来的（§5 #41） |
| **请求可以取消了** | `gmhttp.ts` 登记在飞请求，菜单与诊断面板都能一键中断。**刻意不在面板关闭时自动取消**（§3.3） |
| **日志不再倒对象** | `core/log.ts`：分级 + 环形缓冲 + `describeUser()` 脱敏；诊断报告里带上最近 20 条 |
| **深色模式** | `ui/styles.ts` 的 133 处硬编码色值全换成 `--tb-eztb-*` 变量，跟随系统深色偏好 |
| **文案** | `@description` 里"加一个 eztb 按钮"改成"加一个「查询」按钮"，与按钮上的字一致 |

改动完的基线（1.8.0 当时）：typecheck 0 错 / verify 44 / keyword-test 70 /
live-test 33 / click-test 151 / page-test 68（取决于本机快照数量，见 §6），全绿。

**1.7.4 · 界面文案（第二批）**

| 位置 | 改后文字 |
|---|---|
| 「查询」按钮 hover（`main.ts`） | 查看该用户的资料 / 关注的人 / 关注的吧 / 粉丝 / 发帖 |
| 设置里「单个列表最多加载页数」的说明（`settingsDialog.ts`） | 每页 20 条。 |

按钮 hover 原来写的是"关注吧 / 粉丝 / **收藏吧**"：术语与面板不一致，而且同一句里
"关注吧"和"关注的吧"并排容易看成同一个东西。现在统一用页签上的名字
（关注的人 / 关注的吧）。设置里那句说明原来是"关注吧每页 20 条。50 页约等于 1000 条…"，
既把页签名写错（每页 20 条的是「关注的人」），又啰嗦，现在只留事实。

**1.7.3 · 界面文案精简（按用户逐条确认的措辞）**

只改用户看得见的文字，逻辑与请求行为不变。这一轮改了 4 条：

| 位置 | 改后文字 |
|---|---|
| 「关注的吧」隐藏关注贴吧时的顶部提示（`userForums.ts` 的 `HIDDEN_FORUMS_NOTE`） | 该用户的关注贴吧未公开，以下数据从用户数据中还原，可能不完整。 |
| 「关注的吧」该用户没有用户名时的提示（`NO_USERNAME_NOTE`） | 注意：该用户没有设置用户名，「吧内等级」无法查询。 |
| 「关注的吧」有吧名没等级时的提示（`NO_LEVEL_NOTE`） | 部分吧缺少等级信息。 |
| 「发帖」隐藏发帖记录时的空列表说明（`userPanel.ts` 的 `HIDDEN_POSTS_NOTE`） | 发帖信息设为私密。 |

顺带修一处由改文案暴露出来的缺口：原来"为什么有些吧没等级"是夹在 F1 那段长提示里的，
F1 缩短后（隐藏关注贴吧的用户）就不再有这条说明。现在「部分吧缺少等级信息」只要**有吧缺等级
就显示**（不再要求"没隐藏"），隐藏场景也照样有解释。click-test 匹配这些文字的三条断言同步
改成新措辞（"未公开"、"缺少等级信息"、"私密"）。

其余文案仍按 1.7.2 的样子，后续可以继续逐条改。

**1.7.2 · 工程整理 + 反查收尾**

- `resolveForumNames` 在取数前与等完限速名额后各回看一次缓存（另一条路径可能已经写好）——
  live-test：该页 9 个吧，两路并发只反查 9 次（不去重会是 18 次）。
- 补上真正能跑的类型检查（§5 #34）：`tsconfig.json` 的别名对齐 + `scripts/typecheck.mjs`。
- 文档与实现对齐：README 的断言条数与快照说明、PLAN.md 归档、§5 #33（提交信息与内容不符）。

> **版本号规则**：只要 `dist/` 的内容变了就必须提 `@version`（同名同版本号用户收不到更新）。
> 1.7.1 就是因为 1.7.0 推上去后又改过产物才提的（§5 #31）；1.7.2 同理。

**1.7.0 / 1.7.1 · 饼图统计口径修好 + 「查看全部吧的占比」（用户 2026-09-27 第二轮反馈）**

- 「初次点进时饼图有时只统计主题帖」有两个成因：空吧名被丢掉（#26）、回复那一路要按吧反查而慢 8 秒（#29）。
  现在未知吧名兜底、取数失败写在饼图旁、没到齐写明"还在加载"、主题帖 feed 白捡吧名、反查改有界并发。
  实测回复 8577ms → 1824ms、窗口 8066ms → 1285ms、请求 11 → 5。
- 「查看全部 N 个吧的占比」（#27）。
- 1.7.1：失败提示区分"整路缺"与"后续页没取到"；反查加 in-flight 去重（#32）。

**1.6.0 · 饼图改按吧统计、两路 feed 一起加载、按钮不再压正文（用户第三轮反馈）**

- 饼图从"发帖/回复占比"改成按吧（`buildForumSlices` / `buildForumPieSvg`）。
- 进「发帖」页签时两路各取一页（原来点哪个取哪个），饼图一开始就统计到回复。
- 「查询」按钮压住楼层正文的修复（#24），page-test 加了逐行断言；同时把 page-test 扩成能读「网页，完整」快照（#25）。

**1.5.1 · 楼中楼标「回复了谁」+ 回复页吧名缓存**

- 渲染 `replyTo`，抽成纯函数 `postRowSubParts` 以便离线测试。
- 回复 feed 的吧名反查加跨调用缓存（#23）：签到号请求 11 → 2。
- 「查楼层」改用正文级 pid（#22）。

**1.5.0 · 回复正文与楼层 / 按吧饼图 / 签到号 / 隐藏发帖 / 成分第 6 段**（用户 5 条需求）

- 回复、楼中楼显示正文与「查楼层」（§4.5）。
- 发帖占比饼图（当时按类型，1.6.0 改成按吧）。
- 识别隐藏发帖记录（§4.6），界面改说辞。
- 查签到号（`forumActivity.ts` + `activityRule.ts`）。
- 成分规则第 6 段「发帖所在吧」（§4.4）。

**1.4.0 / 1.3.2 / 1.3.1**

- 1.4.0：「查等级」（点了才查，`pb/page` 的 `userList[].levelId`，§4.2）。
- 1.3.2：把"为什么没等级"讲清楚；新增 `scripts/probe-user.mjs`。
- 1.3.1：脚本改名（去掉「（本地直连版）」），副作用是要重装（§8）。

**1.3.0 · 上传 GitHub + 发布准备**

- 补 `.gitignore` / `.gitattributes` / `LICENSE`（MIT，只覆盖本工程）/ `THIRD-PARTY.md`；
  README 重排并加 raw 安装链接；仓库里所有本机绝对路径改成"同级目录 + 环境变量"；
  元数据 `@namespace` / `@author` / `@supportURL` 指向本仓库。

**1.2.0 · 「成分」关键词检测**

- 规则一行一条（§4.4），纯逻辑放在 `core/composition.ts`；`core/identity.ts` 与 `core/userForums.ts`
  是从 `userPanel.ts` 抽出来的共用模块；`features/compositionScan.ts` 的 `checkUser` 是**唯一**检测入口。
- 不变成刷接口的工具：规则为空零请求、每页默认最多 20 人、同一用户走缓存（默认 3 天，规则指纹变了自动失效）。
- 反向验证 3 次：忽略排除词 → 2 项失败；弱证据当强证据 → 再加 1 项；不贴徽章 → click-test 2 项失败。
- 顺带修掉一个真 bug：`rescanPage()` 只清内存缓存，`checkUser` 会从落盘缓存读回旧结果，
  「重新检测本页用户」等于空操作——现在排队时带 `force`，click-test 断言"重新检测确实发了新请求"。

**1.1.0 · 发帖拆子页签 + 未压缩产物 + Greasy Fork 元数据**

- 「发帖」拆 **主题帖 / 回复** 子页签，各自独立翻页；子页签懒加载，切走再切回内容保留；
  反向验证：合并成一个列表 → click-test 3 项失败；去掉「回复」子页签 → 另 3 项失败。
- 产物默认不压缩（Greasy Fork 规则要求保留空白与变量名），压缩版另存 `*.min.user.js`，**不要传那个**。
- 补 `@name:zh-CN` / `@description:zh-CN` / `@compatible` / `@incompatible` / `@license MIT`，
  `@namespace` 等可用环境变量覆盖；产物末尾加 NOTICE 写明内嵌库来源与版本。这些要求钉进了 verify 的 V7 组。

**两次用户反馈的排查结论**

- 「隐藏关注贴吧没被计入成分判定」：恢复通道原来只在主接口**返回空**时才走，接口一旦**抛错**就整块跳过。
  现在 `loadUserForums(id, profileForums)` 把资料接口自带的「关注贴吧」字段（零额外请求）与主接口结果合并，
  主接口空或失败才走 `getHiddenLikeForum`；统计多一项 `forumsRecovered`。
- 「新版页面上成分标记压住回帖正文」：见 §5 #14（现强制单行，按剩余空隙决定显示几个）。

### 9.2 可以继续做

- 子页签只能显示"已加载 N 条"——`UserPostResIdl` 不返回总数，想显示"共 N 条"只能一直翻到底（不值得）。
- 成分检测只看**第 1 页**发帖（主题帖 60 + 回复 60）。可做成可配置页数，代价是每个用户请求数线性上涨。
- 关注吧与发帖都取不到时（对方设了隐私 / BDUSS 失效），面板会列出原因，但页面标记不会出现；
  可以给这种情况一个"证据不足"的独立标记。
- 饼图失败提示可以再细到"缺的是哪一页"（现在只说"后续页没取到"）。
- **V4 / V6 两项人工验证没做**：带真实 BDUSS 的鉴权接口、真实贴吧页面上的日常使用，需要用户自己装一次。
- **上传 Greasy Fork 没做**：产物已满足硬性要求，等用户确认 SDK 授权后可直接传 `dist/` 那份。

### 9.3 明确排除（不要擅自扩大）

- 任何写操作（关注/取关/签到/回帖），不碰 `tbs`。
- 导出、吧内分析、DB 统计（这些在 `apps/api` 层）。
- 修改 `packages/sdk` 源码。
- 保留"用 eztb.org 打开"的降级入口。

### 9.4 工程约束

- 上游 `packages/sdk` 锁在 `v3` 分支，具体提交锁在 `sdk.lock.json`；
  协议或结构变动后要更新锁文件、重新打包并复跑 `verify.mjs`（构建会对不上就停）。
- 本工程与上游是**两个独立目录**，没有 submodule 关系（`EZTB_ROOT` 指过去即可）。
- 上游主仓库（含 `apps/api`）**没有 LICENSE 文件**；但内嵌的 SDK 本身有明确许可：
  `packages/sdk` 是 submodule → `Dilettante258/tieba.js`，`package.json` 写 `license: ISC`
  （**1.8.0 更正的结论**，之前文档里写"未声明"是错的）。缺的只是上游没有 `LICENSE` 文件，
  产物 NOTICE 里按 ISC 模板补了许可文本；再稳妥一点就向上游要一份正式 LICENSE。
- `dist/tieba-eztb-toolbox.user.js` **提交进仓库**：改完代码要 `node build.mjs` 重建并一起提交，
  否则 README 里的 raw 安装链接给别人的是旧产物。
- 快照（`../test0/*.mhtml`）与 CSS 缓存不进仓库：含真实用户帖子内容，体积也大。

---

## 10. 新对话怎么接着干

1. 先读这份 `HANDOFF.md` 和 `README.md`，再动代码。
2. **改完必须跑五套测试 + 类型检查**（`typecheck` / `verify` / `keyword-test` / `live-test` / `click-test` / `page-test`）。
当前基线（1.8.2 实测）：typecheck 0 错 / verify 51 / keyword-test 79 / live-test 33 / click-test 184 /
   page-test 34 全绿（page-test 的项数随本机有的快照数量变化——本机现在只有 1 份快照 × 2 种宽度）。
   page-test 读仓库里的网页快照（`dist/.samples/`，同级的 `../test0` 也会找）；找不到的用例会显示"跳过"并注明。
3. 涉及 DOM 或布局的改动**加反向验证**：把修复改回去，确认断言会失败（见 §5 的排查方法论）。
4. 涉及协议或数据模型的疑问**先打真实数据**：`EZTB_PROBE=1 node scripts/live-test.mjs` 或
   `node scripts/probe-user.mjs <portrait|ID> [吧名]`，不要凭推测改。
5. **改完重建产物并提交**：`node build.mjs` → 跑测试 → 改 `package.json` 版本号 →
   `git add -A && git commit && git push`（仓库已公开，`main` 直接推）。
   **只要 `dist/` 内容变了就必须提 `@version`**；`docs:` 就只提交文档（§5 #33）。
   > 顺序上有两处会咬人：**版本号要在 `node build.mjs` 之前改**（`@version` 是从
   > `package.json` 抄进产物的）；而 CI 里那条 `git diff --exit-code -- dist` 正是为了
   > 拦住"改了源码忘了重建"。想避开手工顺序失误，直接照 CI 那串命令跑一遍。
6. `IMPROVEMENTS.md` 里还有没做完的条目（文件拆分、共同关注、规则文档等），下次可以接着挑。
7. 交付时提醒用户**重装脚本**；描述用"用户能感知到什么"（多了什么按钮、标记长什么样、哪里变快了），
  而不是只报"改了哪个文件"。
