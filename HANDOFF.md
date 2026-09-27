# eztb-userscript 项目交接文档

> 用途：在新对话中继续这个项目时，先读这份文档即可恢复全部上下文。
> 最后更新：2026-09-27
> 当前版本：**1.7.1**；仓库已公开在 <https://github.com/Dan12elion/tieba_extensions>
> （装在油猴里的那条对应 `dist/tieba-eztb-toolbox.user.js`）

---

## 1. 项目目标

**本仓库（公开）**：<https://github.com/Dan12elion/tieba_extensions>
产物元数据里的 `@namespace` / `@author` / `@supportURL` 已指向它（`build.mjs` 里的默认值）；
fork 出去的人要用 `EZTB_NAMESPACE` / `EZTB_AUTHOR` 改成自己的。

用户做了一个油猴脚本，在贴吧页面上点按钮查询用户数据（关注、粉丝、发帖等）。
旧实现是把 `https://www.eztb.org/follow` 用 iframe 内嵌进页面——**每点一次就让别人的服务器
交付一整套前端资源**。用户希望消除这个负担。

**最终方案（方案 C）**：把 eztb 的 SDK（tieba.js）**直接编译进油猴脚本**，
数据由脚本直连 `tiebac.baidu.com`，不经过任何第三方服务、不需要本地进程。

曾评估但未采用的方案：

| 方案 | 形态 | 未采用原因 |
|---|---|---|
| A | exe 提供本地前端 + API，脚本 iframe 指向 `127.0.0.1` | 仍然背着整个 SPA；iframe 里跑本地服务 |
| B | exe 只提供本地 API，脚本调接口自己渲染 | 需要一个常驻进程；对一个按钮来说太重 |
| C（采用） | 单文件油猴脚本，内置 SDK | — |

### 已确认的产品决策

| 编号 | 决策 |
|---|---|
| D1 | 独立工程目录，与上游 eztb 并列，命名上标记归属 |
| D2 | 只考虑 Edge / Chrome（不承诺 Firefox） |
| D3 | 用户手动粘贴 BDUSS，存 `GM_setValue`；设置里提供获取 BDUSS 的辅助网址 |
| D4 | "方便做的"只读功能全部纳入 |
| D5 | 不做任何写操作（不碰 tbs），不做导出 / 吧内分析 / DB |
| D6 | 不修改 `packages/sdk` 源码 |
| D7 | 「成分」关键词检测为**只读**功能：规则表为空时完全不工作（零请求），开启后也受"每页人数上限 + 缓存 + 串行限速"三重约束 |

---

## 2. 目录与文件

### 相关目录

| 路径 | 说明 |
|---|---|
| 本仓库 | **本工程**（独立目录，不在上游仓库里） |
| 上游 eztb 仓库（默认同级 `../eztb`） | monorepo：`apps/web`、`apps/api`、`packages/sdk`，构建与测试从它借依赖 |
| 快照目录（默认同级 `../test0`） | 含 **真实页面快照（.mhtml）** 与旧脚本；page-test 从这里取样 |
| 本仓库的 `dist/.samples/` | **另一个快照投放点**（被 .gitignore 忽略）：page-test 会同时在这两处找快照。用户后来把"旧版页面无按钮"那份放到了这里 |
| 文件位置 | 所有本机路径都改成"同级目录 + 环境变量覆盖"，仓库里不再出现 `E:\Codexpj\…` / 用户名；快照与 CSS 缓存不进仓库 |

### 本工程结构

```
eztb-userscript/
├─ build.mjs                    # esbuild 打包 + 拼接油猴元数据
├─ README.md                    # 用户向文档（功能、构建、踩坑说明）
├─ PLAN.md                      # 最初的改造/验证清单
├─ HANDOFF.md                   # 本文件
├─ LICENSE                      # MIT（只覆盖本工程自己的代码）
├─ THIRD-PARTY.md               # 内嵌的第三方代码与授权状态（含 SDK 无 LICENSE 的提醒）
├─ .gitattributes               # 统一 LF（产物会被直接安装/上传，换行必须稳定）
├─ .gitignore                   # 忽略 node_modules、dist/.verify、dist/.samples
├─ scripts/
│  ├─ shims-plugin.mjs          # Node→浏览器 的解析替换规则（打包与测试共用）
│  ├─ verify.mjs                # 签名逐字符比对 + 产物检查
│  ├─ live-test.mjs             # 真实接口连通性测试（EZTB_PROBE=1 开探查）
│  ├─ click-test.mjs            # 无头浏览器 + 本地代理，真实数据交互测试
│  ├─ page-test.mjs             # 真实页面快照（MHTML）离线回归
│  ├─ keyword-test.mjs          # 成分规则解析/匹配的纯离线测试
│  ├─ fetch-sample-css.mjs      # 把快照引用的外部 CSS 抓到本地缓存（page-test 用）
│  ├─ probe-user.mjs            # 单用户原始数据探查（回答"为什么这个字段拿不到"）
│  └─ extract-mhtml.mjs         # MHTML 解码工具
├─ src/
│  ├─ main.ts                   # 入口：注入样式、挂按钮、注册菜单、点击委托
│  ├─ core/
│  │  ├─ settings.ts            # BDUSS 与运行参数（GM 存储）
│  │  ├─ sdk.ts                 # TiebaClient 初始化/重建
│  │  ├─ identity.ts            # ★ UserRef → 带 ID 的 Identity（面板与成分检测共用）
│  │  ├─ userPost.ts            # ★ 主题帖/回复双 feed 取数与分类
│  │  ├─ userForums.ts          # ★ 关注的吧取数（含隐藏关注贴吧的回退）
│  │  ├─ replyFloor.ts          # ★ "这条回复在第几楼"（点了才查 + 缓存）
│  │  ├─ forumActivity.ts       # ★ "他最近在哪些吧发过言"（点了才查 + 缓存）
│  │  ├─ activityRule.ts        # ★ 签到号判定（纯逻辑：等级高 + 该吧 0 发言）
│  │  ├─ postStats.ts           # ★ 发帖/回复/楼中楼占比与饼图（纯逻辑）
│  │  ├─ composition.ts         # ★ 成分规则解析 / 匹配 / 关键词高亮（纯逻辑）
│  │  ├─ compositionDetect.ts   # ★ 成分取数编排（按需取关注吧 / 主题帖 / 回复）
│  │  ├─ compositionCache.ts    # ★ 成分结果缓存（带规则指纹）
│  │  ├─ forumLevel.ts          # ★ "点了才查"的吧内等级（从他在该吧的帖子里读 + 缓存）
│  │  ├─ queue.ts               # 串行限速队列
│  │  ├─ cached.ts              # 用户资料缓存（7 天）
│  │  ├─ gmhttp.ts              # GM_xmlhttpRequest 的 Promise 封装
│  │  └─ util.ts                # 转义、时间格式化、链接拼接等
│  ├─ shims/
│  │  ├─ undici.ts              # ★ undici → GM_xmlhttpRequest（含 HTTPS 升级）
│  │  ├─ md5.ts                 # node:crypto → 纯 JS MD5
│  │  ├─ html.ts                # node-html-parser → DOMParser
│  │  └─ live-entry.ts          # 仅供测试用的导出入口
│  ├─ page/
│  │  ├─ adapters.ts            # 新旧版贴吧 DOM 适配（移植自基线脚本）
│  │  ├─ scanner.ts             # 扫描 + MutationObserver + 按钮自愈
│  │  └─ badges.ts              # ★ 成分徽章（用户名旁的标记）
│  ├─ ui/
│  │  ├─ styles.ts              # 全部 CSS
│  │  └─ modal.ts               # 通用弹窗外壳
│  └─ features/
│     ├─ userPanel.ts           # ★ 用户面板（6 个页签）
│     ├─ compositionScan.ts     # ★ 成分检测调度（登记用户、限速、缓存、贴标记）
│     ├─ settingsDialog.ts      # BDUSS / 参数设置
│     └─ diagnose.ts            # 页面诊断报告
└─ dist/
   ├─ tieba-eztb-toolbox.user.js      # 产物：未压缩可读版（约 1.0 MB / 2.9 万行）
   ├─ tieba-eztb-toolbox.min.user.js  # 只有 `node build.mjs --minify` 时才生成
   ├─ .verify/                        # 测试中间产物（被 .gitignore 忽略）
   └─ .samples/                       # 随手放进来的页面快照（被 .gitignore 忽略）
```

---

## 3. 架构要点

### 3.1 四个 Node 依赖的浏览器替身（不改 SDK 源码）

构建时用 esbuild 的解析钩子替换，上游更新后重新打包即可：

| SDK 依赖 | 替身 | 关键点 |
|---|---|---|
| `undici` | `src/shims/undici.ts` | 同签名 `request()`，底层走 `GM_xmlhttpRequest`；**并把 `http://tiebac.baidu.com` 升级为 https** |
| `node:crypto` | `src/shims/md5.ts` | 只实现 `md5 + hex`；行为与 Node 逐字符一致（有测试） |
| `node-html-parser` | `src/shims/html.ts` | 用原生 `DOMParser`；`innerText` 映射到 `textContent`（`<script>` 的 innerText 在浏览器恒为空） |
| `Buffer` | build.mjs 的 banner | 全 SDK 只有 `core/http.ts` 一处 `Buffer.from`，垫成透传 |

SDK 内部生成的编解码器通过别名引入（`tieba.js/generated/UserPostReqIdl` 等），
用于取"主题帖"feed。

### 3.2 运行时

- **串行限速队列**：两个 feed 的正文请求（用户发帖/回复、关注/粉丝、贴吧资料…）都经
  `SerialQueue`，默认间隔 400ms（可配置），分页由脚本逐页驱动，
  **不使用 SDK 内部的并发 `ALL` 拉取**。
  **唯一的例外是"按吧反查吧名"**（回复 feed 只给 forumId）——它是几十字节的小 GET，
  走队列会让整页回复晚好几秒（§5 #29）。它改成最多 3 个在飞、间隔取
  `max(150ms, 用户设置 ÷ 3)`，即**默认设置下约 6 个/秒的上限**（设置调大时自动放宽），
  并且绕开队列。设置面板里写明了这个例外，改这块之前先读 §5 #29 与 `core/userPost.ts`。
- **凭据本地化**：BDUSS 只存油猴存储；支持整段粘贴 `BDUSS=xxx` 自动提取。
- **每个页签一个独立容器**（`.tb-eztb-pane`），切换只切显隐，内容保留、不重复请求。
- **点击走 document 捕获阶段的事件委托** + WeakMap 关联按钮与用户信息。
- **按钮用 `<button type="button">`**，不用 `<a href="javascript:...">`。

---

## 4. 关键数据模型（来自实测，非猜测）

### 4.1 接口语义对照（容易搞错）

| 页签 | 接口 | 返回的是 | 依据 |
|---|---|---|---|
| 关注的人 | `getFollow`（`/c/u/follow/followList`） | **用户** | 上游 `follow.tsx` 写的是"共关注 N 人" |
| 关注的吧 | `getLikeForum`（`/c/f/forum/like`） | **贴吧**，带 `level_id` | 上游 `likeforum.tsx` 标题就是"关注的吧" |
| 粉丝 | `getFans` | 用户 | |

> 曾经把这两个接口用反过：标签写"关注吧"却拉的是关注的人。

### 4.2 隐藏关注贴吧时的等级

`getHiddenLikeForum` 返回：

```ts
{ grade: Record<吧内等级, { forum_list: [吧名] }>, plain: [吧名] }
```

**等级在 `grade` 的键上**。只取 `forum_list` 会把等级全丢掉（已修）。
依据：上游 `likeforum.tsx` 的 `HiddenForums` 就是按 `[level, {forum_list}]` 渲染"吧内等级 N 级"。

**但有些用户根本拿不到等级**（2026-09-24 查证，用 `scripts/probe-user.mjs` 打原始数据）：
等级只有两个来源——`getLikeForum`（隐藏时为空）和 `panel.honor.grade`，而
`getPanel(un)` **只能按"用户名"查**。于是：

1. **没有用户名的账号**（页面上显示为「贴吧用户_xxxx」这类系统昵称，`user.name === ""`）
   一个等级都拿不到。实测把 用户名 / 贴吧号 / 内部 ID / portrait 四种标识符都喂给 panel，
   `honor.grade` 全是空的。这类账号不少（随手抓的案例里就有）。
2. 即使有用户名，`panel.honor.grade` 也只列**一部分**吧；剩下的只能从
   `profile.user.likeForum` 拿到**吧名**（`User_LikeForumInfo` 只有 forumName + forumId，没有等级）。

所以面板里"有的吧有等级、有的没有"是数据源的客观限制。界面现在会分别说明是哪种情况
（`userForums.ts` 的 `NO_USERNAME_NOTE` / `NO_LEVEL_NOTE`），别当成 bug 去"修"。

**第三条路（点了才查）**：`/c/f/pb/page`（帖子接口）返回的 `userList` 里，
每个人的 `levelId` 就是他在**这个吧**的等级——实测：例子里的楼主在汉族吧 levelId=9，
而 panel 那条路完全查不到他。于是有了 `src/core/forumLevel.ts`：

- 只在用户点「查等级」时触发，每个吧最多 1 次取帖 + 3 次 `pb/page`；
- 候选帖优先取**他自己的主题帖**（他一定是 1 楼，必在第 1 页），没有才退而取他回复过的帖；
- 结果写进 `tbEztbToolboxForumLevelV1` 缓存，设置面板里有「清空吧内等级缓存」；
- 交叉验证（`live-test`）：面板**有**等级的用户，这条路读出来的等级与面板一致（7 = 7）。

### 4.3 发帖：主题帖与回复是两个独立 feed

`UserPostReqIdl` 里有 `is_thread` 字段，**SDK 从未使用**：

| 请求 | 内容 | 原始 title |
|---|---|---|
| `is_thread=0`（SDK 默认） | 该用户**回复别人的帖** | 一律带 `回复：` 前缀（SDK 会抹掉） |
| `is_thread=1` | 该用户**自己开的主题帖** | 无前缀 |

两个 feed 的形状也不同：

- **主题帖**：没有 `content[]`，正文在 `first_post_content[]`；
  `forum_name` 已直接给出（无需 `getForumName` 反查）；
  `processUserPosts()` 对它返回 **0 条**。
- **回复**：正文在 `content[]`；`affiliated`（`postType === "1"`）标记楼中楼。

因此 `src/core/userPost.ts` 自己构造请求（`loadTopicRows` / `loadReplyRows`），
每条打标签：**主题 / 回复 / 楼中楼**；`loadPostPage` 保留给探查脚本用，面板不再调它。

**每页 60 条**（实测：uid `3408054413` 主题帖第 1、2 页各 60 条且内容不同；
某用户只有 19 条主题帖时第 2 页直接为空——所以判断"有没有下一页"不能只看页大小，
要按返回条数为 0 判定，`mountPagedList` 就是这么做的）。

**面板里不合并两条 feed**：两边分页各自独立，合并后页码对不上、跨页的时间倒序
只能近似。现在「发帖」页签拆成 **主题帖 / 回复** 两个子页签，各自从第 1 页开始、
各点各的「加载更多」。

### 4.4 成分规则与判定强度（思路来自 B 站成分检测器）

规则文本一行一条，写在设置面板里：

```
名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单 | 发帖所在吧关键词
```

| 判定 | 说明 |
|---|---|
| 分隔符 | 字段用 `|`，关键词用逗号（中英文都行）。**不按空格切**——参考脚本里就有「互动抽奖 #原神」这种带空格的词，切了就废 |
| 发帖匹配 | 打在该用户主题帖/回复的「标题 + 正文摘要」上（各取第 1 页） |
| 吧匹配 | 打在该用户关注的吧名上（`getLikeForum`，隐藏时回退 `getHiddenLikeForum`） |
| 发帖所在吧 | 打在他**实际发过帖**的吧名上（1.5.0 新增，规则文本里的**第 6 段**）。与"关注的吧"是两回事：关注是一回事，说没说话是另一回事。放最后一段是为了不改老规则（5 段）的列序；末尾多写一个 `|` 也不会被误读 |
| 证据强弱 | 名单 / 关注的吧 / **主题帖** = 强证据；**回复、楼中楼** = 弱证据（界面标"可能是误判"，标记也淡一些） |
| 排除词 | 命中则整条证据作废（对应参考脚本的 keywordsReverse），用来压住玩梗误伤 |
| 合并 | 同一条规则的多条证据合成一个命中，不会变成两个徽章刷屏 |
| 缓存 | 结果里存规则指纹（`hashRules`），改规则自动失效；默认 3 天过期 |

### 4.5 楼层号只在帖子接口里，发帖 feed 没有

`PostInfoList` 的字段是 forumId / threadId / **postId** / createTime / title / content[] …
**没有 `floor`**（`Post.floor` 属于 `/c/f/pb/page`、`/c/f/pb/floor` 那一侧的 `Post` 消息）。
所以「回复在第几楼」只能额外换一次：

```
getComments({tid, pid})  →  /c/f/pb/floor?cmd=303002  →  data.post.floor
```

实测（2026-09-27）这一条对两种行都成立：

- **普通回复**：pid 就是那一楼自己的帖子 ID → `floor=3`
- **楼中楼**：pid 是楼中楼那条的帖子 ID → `floor` 是**它所在的那一楼**（实测 2），
  同一次返回里 `data.post.content` 还是那一楼的正文——正好用来说明"回的是哪一楼"

**pid 必须取正文级（`UserPost.cid`），不能取记录级（`PostInfoList.postId`）**：
一条 feed 记录可以带多条正文（他在同一个帖子里连发几楼），记录级 pid 是这几行**共用**的，
拿它去查楼层会让同一帖的每一行都查回同一个楼层。实测（uid 874540992 第 1 页）：
一条记录含 3 条正文，记录级 pid 是 112 楼，而第二、三条正文分别在 111 楼等位置；
抽样 24 个用户 187 条记录里 32 条（17.1%）是这种"一记录多正文"。live-test 有断言：
同一帖子里两行回复必须查到**各自**的楼层（不是同一个）。

一条回复 = 一个请求，所以做成**点了才查**（`src/core/replyFloor.ts`），缓存在
`tbEztbToolboxReplyFloorV1`。live-test 里有交叉验证（封装读到的楼层与直接调接口一致）
和"第二次走缓存"的断言。

### 4.6 发帖记录被隐藏：`hidePost` 是唯一能看出来的信号

用户把发帖记录设为私密时，**两路 feed 都返回 `hidePost=1`、`maskType=3`、`postList` 为空**；
正常用户是 `hidePost=0`、`maskType=1`。实测（2026-09-27 抽样 108 个真实用户）：
15 个隐藏、93 个正常，`hidePost` 与 `maskType=3` 完全对应，且**没有一个反例**
（说了隐藏还给内容的）。

结论：**被隐藏的帖子拿不到**（服务端根本不返回内容，脚本没有绕过的办法），
但可以把"对方隐藏了"和"对方没有公开的帖子"区分开——面板现在会说前者。
断言在 live-test：`hidePost=1 的返回里列表必为空（没有反例）`。

> 顺带：`hidePost` 是 protobuf 里的 `uint32`（字段号 2），所以 `{data:{hidePost:1}}`
> 的字节就是 `12 02 10 01`。click-test 用它把某个用户的 userpost 响应顶掉，
> 从而**不依赖某个真实账号的隐私设置**来验证这条路径。

---

## 5. 踩过的坑（最重要的一节，重写时别重蹈）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 按钮看得见、点不动 | 新版页面 `.btn-wrapper` 是 `pointer-events:none`，子元素继承后无法命中 | 按钮必须 `pointer-events:auto !important` |
| 2 | 点了完全没反应 | `<a href="javascript:void(0)">` 被油猴沙箱拦截 | 改用 `<button type="button">` |
| 3 | 按钮浮在本该遮住它的图层之上 | 我为修#1 把 z-index 提到 `2e9` | z-index 只能是 **5**（与基线一致）；#1 的真正解法是 pointer-events |
| 4 | 列表内容错位 | 标题/副标题是 `<span>`（inline），`overflow+ellipsis` 对行内元素无效 | `.tb-eztb-row-main` 用纵向 flex；标题/副标题 `display:block` |
| 5 | 切回访问过的页签不生效、内容错乱 | 所有页签共用一个容器 + 记"已初始化"集合：切回被提前 return；上一个页签的异步回调会覆盖当前内容 | 每页签独立容器，切换只切显隐 |
| 6 | **旧版贴吧页面完全没有按钮** | 与旧脚本共用标记属性 `data-tb-eztb-done`；旧脚本先跑把元素标记完，本脚本全跳过 | 本脚本改用 `data-tb-eztb-toolbox-done`；检测到旧脚本按钮时提示卸载 |
| 7 | 发帖列表全显示"未知贴吧" | `getUserPost(id, page, false)` 跳过了吧名解析 | 传 `true`（或走新的 `userPost.ts`） |
| 8 | 手写 protobuf 请求抛 `Cannot convert undefined to a BigInt` | 生成代码的 `encode` 用 `字段 !== 默认值` 判断写入，传部分对象时缺失的 int64 变成 `undefined` | 必须走 `**fromPartial**` 补全默认值 |
| 9 | 旧脚本按钮点不动 | 它的 `javascript:` href 被油猴剥掉，anchor 无 href | 卸载旧脚本（已在本脚本里做提示） |
| 10 | MHTML 快照里找不到脚本样式 | **MHTML 保存会丢掉 `<style>`** | 排查时别把"没有样式"当作脚本没运行的证据 |
| 11 | 浏览器里报 `Invalid regular expression: missing /`，位置完全指不出来 | 内联脚本写在 Node 的模板字符串里，`/\n/g` 这种写法里的 `\n` 被 Node 提前换成了真换行，正则被切断成两行 | 浏览器看到的那份源码要写成 `\\n`；并且 `click-test` / `page-test` 现在会先把页面里的内联脚本过一遍 `new Function` 做语法自检，失败直接指出是第几个脚本。同一类坑还有**正则里的转义**：`/Lv\.\d+/` 在模板字符串里会变成 `/Lv.d+/`（`\.`→`.`、`\d`→`d`），断言会静默失效——能不用转义就别用，必须用时写双份 |
| 12 | 设置面板打包后出现 3000+ 字符的超长行，且踩到"未压缩"检查 | esbuild 重排 AST 时会把一整条 `a + b + c` 拼串压成一行 | 改为 `parts.push(...)` 逐行拼（语句不会被合并），最长行随即回到几百字符 |
| 13 | 成分标记的命中测试失败，但元素明明在 | 上一步打开的面板遮罩是 `z-index:2147483647` 的全屏 fixed 层，`elementFromPoint` 只能拿到遮罩 | 断言前先关掉面板；写页面级命中测试时先确认没有遮罩 |
| 14 | 新版页面上成分标记"轻微"压住下面的正文 | 新版头部行高度写死 40px（`.image-text .user-info{height:40px}`，CSS 在 `pb.*.css` 里），而标记容器当时是 `flex-wrap:wrap`：命中 2~3 条规则时折成两行，实测量到溢出 12.5~13px | `.tb-eztb-badges` 改 `flex-wrap:nowrap` + `min-width:0` + `overflow:hidden`，并给携带它的 `.btn-wrapper` 加 `:has()` 收缩规则；JS 侧按 `.head-spacer` 的剩余宽度决定显示几个标记，放不下退成 `+N`、再放不下退成一个圆点 |
| 15 | 想复现 #14，但快照里量出来"没有重叠"，差点得出"不存在这个问题"的结论 | MHTML 只保存页面**内联** `<style>`（`cid:css-…@mhtml.blink`），**外部** CSS 只剩链接；而 `.head-line{display:flex}`、`.image-text .user-info{height:40px}` 全在外部 `pb.*.css` 里 | 新增 `scripts/fetch-sample-css.mjs` 把快照引用的 CSS 抓到 `../test0/_css_cache`，page-test 用本地路由 `/css/<name>` 喂回去，快照这才变成"带样式"的页面，也才量出 #14 |
| 16 | 在 Node 里调 SDK 的 `getPosts` 报 `Cannot read properties of undefined (reading '0')`，且一个请求都没发出去 | 签名是 `getPosts(tid, page, options)`，我按 `getPosts({tid, page, rn})` 调：`page` 变成 undefined，走进了多页分支里的 `page[0]` | 看签名再调；这类"本地就炸、且没发请求"的错优先怀疑参数形状 |
| 17 | 想从帖子页读"某人在某吧的等级"，一开始以为拿不到 | `pb/page` 的响应里楼层 `author` 是空的，数据在同级的 `userList[]` 里（按 `authorId` 对应） | 读 `userList`，里面的 `levelId` 就是**该吧**等级（见 §4.2 第三条路） |
| 18 | 断言"楼中楼被标记为 sub"无故失败；"needForumName 能解析吧名"也失败 | **样本问题**：这两条断言拿"某个吧第一页的前几个作者"当样本，而那几个人恰好没发帖 / 没有楼中楼（2026-09-27 实测正好撞上） | 扩样本：多取两个吧的作者凑候选名单，在名单里**找符合条件的那一个**，而不是赌第一个；另外单个用户取数失败要 `try/catch` 跳过（有个 id 会回 `errno 300000`，不接住会把整轮测试带崩） |
| 19 | click-test 里"隐藏了发帖记录"的桩一次都没命中 | 请求体里找 user id 用了 ASCII 字符串，但 proto 里 **`userId` 是 int64，走 varint 编码** | 按 varint 字节匹配（`varintBytes(uid)`）。另外 protobuf 请求是 **multipart/form-data**（字段名 `data`、filename `file`），不是裸二进制——抓包/写桩时别按裸 protobuf 想 |
| 20 | 断言"点查楼层后换成了 N楼"，报"没有换成楼层标记"，但功能其实正常 | 我读的是 `floorBtn.parentNode`，而 `button.replaceWith(span)` 之后**原按钮的 `parentNode` 变成 null** | 点击前先记住所在行（`closest('.tb-eztb-row')`），断言去行里找；顺带发现"等 `!isConnected`"本身就会在替换的那一刻成立，不能当"被重建"的证据 |
| 21 | 新加的「检测签到号」按钮复用 `.tb-eztb-levelbtn` 类，导致老断言点错按钮 | 测试按类名找「查等级」按钮（`querySelectorAll('.tb-eztb-levelbtn')[0]`），我的按钮排在列表前面被当成目标 | 每种小按钮用**自己的类名**（`tb-eztb-levelbtn` / `tb-eztb-floorbtn` / `tb-eztb-minibtn`），样式用逗号选择器共享 |
| 22 | 「查楼层」对同一帖子里的多行回复都显示同一个楼层 | 行上的 pid 取了记录级 `PostInfoList.postId`，而**一条记录可以带多条正文**（同帖连发几楼），记录级 pid 是共用的 | 取正文级 `UserPost.cid`（`postId: String(post.cid \|\| post.postId)`）。实测抽样 187 条记录里 32 条是多正文（17.1%）；live-test 加了"同帖两行必须查到各自楼层"的断言 |
| 23 | 「检测签到号」实际发了 11 个请求，代码/文档都以为只有 2 个 | 回复 feed **不返回吧名**（只有 forumId），要按吧反查 `getForumName`；而 SDK 自己的 names 缓存是**每次 `Effect.runPromise` 都重建**的（模块级存的是 Effect 而不是解析后的 Cache），所以每取一页回复都要重发一遍 | 在 `core/userPost.ts` 里加跨调用的吧名缓存（`forumNames`，上限 500）。实测第二条同页回复的请求数从 11 降到 2；live-test 有断言"第二次不再重复反查"。**注意**：全新会话里第一次仍是 2 + 该页不同吧数 |
| 24 | 用户报「查询按钮有时部分遮挡楼层正文」 | 回复行的正文块 `.comment-content` 会**往上顶**到头部行（`.head-line.user-info`，写死 40px）的下半部分：实测行 247\~287、正文从 y=271 开始；而按钮在行里垂直居中、占 255\~279，正好压住正文第一行。判据不能看包围盒相交（那会把同行的空槽也算上），要看"**把按钮藏起来再取同一个点**"命中的是谁——实测 23 行里 20 行压着 `.pb-rich-text` | CSS 里对这类行（`.head-line:has(+ .comment-content)`）把按钮/标记**贴到行顶**（`align-self:flex-start`）。修复后逐行复查 0/23；这条断言进了 page-test 常规断言（不只在探针里）。注意脚本自己的 CSS 写了 `visibility:visible !important`，做这类探针要用 `style.setProperty(..., 'important')` 才藏得掉 |
| 25 | page-test 加载「网页，完整」快照时**所有外部 CSS 404**，页面又变回无样式 | 我把 HTML 里的 `<标题>_files/` 改写成 `/files/`，`./<标题>_files/x.css` 就变成 `.//files/x.css`——浏览器按"协议相对 URL"解析，全 404。**和 §5 #15 是同一个坑的另一种形态**：布局断言其实测在裸 DOM 上，`页面看起来没问题` 的结论完全不可信 | 不再改写 HTML，按**原目录名**提供文件（`/<标题>_files/…`）。另外剥掉快照里的页面脚本（`xxx.js.下载` 离线取不到，残留内联脚本会抛 `_typeof is not defined`，把"无 JS 错误"断言染红）。修好后 pb.css 1765 条规则真的生效，异常行数立刻从 1 涨到 20——才看见 #24 |
| 26 | 用户报「发帖页签初次点进时，饼图**有时**只统计主题帖，有时又统计全部」 | 回复行所在的吧要靠 `getForumName` **反查**（回复 feed 只给 forumId，不给吧名）；反查失败时那一行的 `forumName` 是空串，而 `countPostsByForum` 早先把**空吧名直接 `continue` 掉**——回复的条数于是整批消失，只剩主题帖。之所以"有时"，就是因为反查偶发失败（另有一次实测：某个 uid 的 userpost 直接回 `errno 300000`，那一路连行都没有） | ① 空吧名归到常量 `UNKNOWN_FORUM`（「未知贴吧」）而不是丢弃——**统计口径必须是"一条都不少"**；② `resolveForumNames` 失败重试一次（失败结果仍带 5 分钟过期）；③ 分页列表加 `onError` 回调，某一路取数失败会把提示写到**饼图旁边**（原来错误只显示在被隐藏的子页签里，用户根本看不见）。click-test 加了不变量：饼图条数 == 两路子页签已加载的行数 |
| 27 | 「其它 N 个吧」占比很大时，光看饼图不知道是哪些吧 | 饼图按设计只画前 5 个（否则图例几十行） | `buildForumListHtml`：底部一个「查看全部 N 个吧的占比」按钮，展开后每个吧一行（吧名 + 横条 + 条数 + 占比，按条数排序）。展开状态存在面板闭包里，因为 `updatePie` 每次都重建 innerHTML，状态放 DOM 上会被冲掉 |
| 28 | click-test 里"饼图"那一批断言（含"饼图条数 = 已加载行数"这条不变量）**一条都没进结果**，却被当成"测过了" | 两个原因叠在一起：① 等待写在 `until(..., 30 秒)` 的超时回调里，而全局兜底 `finish()` 先执行——超时后新 `add()` 的断言已经随结果发走了；② 判据里的正则写在页面的模板字符串里，`\d` 被 Node 吃掉一层变成 `/(d+)/`，**永远匹配不上**（§5 #11 的同类，换个形式又踩） | 等待挪到主链上（上限 12 秒、超时如实报出来），判据改成"直接和两路子页签的行数比对"，并补了一条**同步**断言（点开「发帖」的瞬间必须看到"数据还在加载"的提示）。教训：**断言数量增加不等于覆盖增加**，写完要确认它真的跑了 |
| 29 | 「初次点进时饼图有时只统计主题帖」的**时序**成因与取舍 | 回复那一页要按吧反查吧名，而反查当时排在 400ms 的串行队列里：实测 uid 3408054413 主题帖 511ms 到、回复 **8577ms** 才到（`dist/.verify/pierace.mjs`）。这 8 秒里饼图只有主题帖的段，看起来却像完整结果 | ① 图上写明「「回复」的数据还在加载，下面的占比还不完整——到齐后会自动补上」（`buildPieNotes`，两路到齐自动消失）；② 从**主题帖 feed 白捡** id→吧名（它本来就带吧名，实测回复页 12 个唯一吧里能白捡 8 个，零请求成本，`dist/.verify/harvest-value.mjs`）；③ 吧名反查改成有界并发：最多 3 个在飞、间隔取 `max(150ms, 用户设置 ÷ 3)`——**不硬编码忽略用户设置**（默认 400ms 时约 150ms；用户调到 1200ms 时自动放宽到 400ms）。两个 feed 的正文请求仍然严格走串行队列 |
| 30 | 「复制的吧名缓存第二次不再请求」这条断言一直通过，其实**什么都没测** | 同一个进程里前面已经取过那个用户的回复页，`forumNames` 是热的，量出来「第一次 +0、第二次 +0」——两边相等，断言恒真 | 打断言前先 `clearForumNameCache()`；并且要断言「第一次 > 0 **且** 第二次 == 0」，只写「两次相等」是不够的 |
| 31 | 一个**变异测试用的临时行**被别人的提交带上了 `main` | 做反向验证时在 `rememberForumNames` 顶部临时插了 `return items; // ★变异测试用`，而协调方那两分钟里正好 `git add -A` 提交并推送 → 那个提交把"白捡吧名"整个关掉（src 与 dist 都提前返回），回复那一路又回到每吧 400ms 串行反查，只是被"数据还在加载"的提示盖住（用户只会觉得"怎么一直慢"） | 发现后立刻撤掉并重建产物（`4946ef3`），并核对用户实际安装的那份 raw 产物里 `rememberForumNames` 是先 harvest 再返回。教训：**变异测试的改动不要在工作区里久留，尤其别跨越并发提交的窗口**——要么在仓库副本里做，要么改完立刻还原并 `git status` 确认干净 |

### 排查方法论（有效，建议沿用）

- 用无头 Edge 抓真实 DOM（curl 会被百度 403 / 安全验证挡住）
- 用户保存的 `.mhtml` 快照是**最好的证据**：能看出哪个脚本跑过、留下了什么
- **反向验证**：把修复改回坏的样子，断言必须失败。做过 3 次
  （pointer-events、布局、页签容器），每次都精确复现了用户症状
- **变异测试**（1.5.1 又做了一轮，5 处全中）：在**仓库副本**里改坏一处 → `node build.mjs` → 跑对应测试 →
  确认断言变红 → 还原。这轮改的是：饼图弧长、签到判定、成分第 6 段、楼层 pid、回复正文渲染；
  对应变红的是 keyword-test 的「三段弧长加起来等于整圈」「只挑等级达标 + 该吧 0 条发言」「在他发过主题帖的吧命中」、
  live-test 的「同帖两行查到各自楼层」（变异后 4 vs 4，pid 也相同）、click-test 的「回复行显示了回复正文」（变异后 0/6）。
  这轮还揪出**两条形同虚设的断言**：吧名反查缓存那条在热缓存上量（现在先 `clearForumNameCache()` 再量），
  以及"回复行有正文"拿整段 `textContent` 的长度判断（光靠吧名标签就能满足，现在扣掉标签再看是否非空）。

---

## 6. 测试设施

**五套测试 + 三个工具**，全部不需要 BDUSS（用假 BDUSS，proto 接口本来就不带它）：

```powershell
cd <本项目目录>
node build.mjs                # 默认产出未压缩的可读版（Greasy Fork 要求）
node build.mjs --minify       # 需要小体积时另存 dist/tieba-eztb-toolbox.min.user.js
node scripts/verify.mjs       # 签名比对 + 产物检查 + Greasy Fork 要求（39 项断言）
node scripts/keyword-test.mjs # 规则解析/匹配 + 按吧占比与"全部吧列表" + 签到判定 + 发帖行副标题（纯离线，69 项断言）
node scripts/live-test.mjs    # 真实接口链路（32 项断言）
node scripts/click-test.mjs   # 无头浏览器 + 真实数据交互（140 项断言）
node scripts/fetch-sample-css.mjs  # 换 MHTML 快照后跑一次：抓快照引用的外部 CSS
node scripts/page-test.mjs    # 真实页面快照回归（1 份「网页，完整」快照 ×2 次运行，34 项断言）

# 工具：把 mhtml 解码成可加载的 html（输出目录可用 EZTB_EXTRACT_OUT 指定）
node scripts/extract-mhtml.mjs "某个.mhtml"

# 工具：把一个用户在四个接口下的原始返回打出来，并列出展平后的发帖行
#       （kind / 吧名 / 回复对象 / 能不能查楼层）——回答"为什么这个字段拿不到"
node scripts/probe-user.mjs <portrait串|数字ID> [吧名]

# 探查模式：打印原始 feed 结构、is_thread 对比、loadPostPage 分组统计
$env:EZTB_PROBE=1; node scripts/live-test.mjs
```

### 各脚本的机制

| 脚本 | 机制 | 能抓到什么 |
|---|---|---|
| `verify.mjs` | 把 SDK 的 `packRequest` 分别用 Node crypto 和浏览器 shim 跑一遍，逐字符比对；另外把 Greasy Fork 的硬性要求（未压缩、≤2 MB、元数据必填项、内嵌库来源）写成 V7 一组断言 | 签名错误（错了极难排查）、手滑改成压缩版、元数据漏项 |
| `keyword-test.mjs` | 打包真实的 `src/core/composition.ts`、`postStats.ts`、`activityRule.ts`（三个纯逻辑模块），对规则解析、匹配、排除词、证据强弱、高亮转义、占比/饼图几何、签到号判定做断言 | 成分规则、饼图算法、签到判定改坏（离线就能发现，不用等浏览器） |
| `live-test.mjs` | Node fetch 顶替 GM_xmlhttpRequest，打真实贴吧匿名 proto 接口 | 协议、鉴权、数据模型、翻页（`pn` 第 2 页与第 1 页不同）、真实发帖数据跑关键词匹配、隐藏关注贴吧的恢复、**"点了才查"的等级与面板交叉验证** |
| `click-test.mjs` | 本地起同源服务：托管页面 + 转发请求到贴吧（绕开 CORS）+ 收集结果；用无头 Edge 打开，注入脚本+GM 桩，做 DOM/布局/交互断言，结果 POST 回 Node | 注入、命中测试、渲染、排版、页签切换、子页签独立翻页、刷新、成分标记、关注的吧「查等级」按钮、菜单里的重新检测 |
| `page-test.mjs` | 支持两种快照：MHTML（解码后把外部 CSS 从 `_css_cache` 补回来）与「网页，完整」（`<标题>.html` + `<标题>_files/`，**自带 CSS**，按原目录名提供资源、页面脚本剥掉）。同一份快照会跑两次：正常宽度 + 窄容器 420px | 只有真实页面才暴露的问题（如#6 标记撞名）、默认不带规则时不得注入成分标记、新版头部行里按钮/标记的排版约束（#14）、**按钮是否压住正文**（#24） |

### 环境依赖

- 已装：Node v24、Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）
- **没有** `bun`、**没有** `npm`（不要在方案里依赖安装步骤）
- page-test 需要快照的 CSS 缓存：`../test0/_css_cache`（首次或换快照后跑一次
  `node scripts/fetch-sample-css.mjs`）；缺了它布局类断言会失真（见 §5 #15）
- esbuild 从上游仓库借用：`../eztb/node_modules/esbuild`；
  依赖（`effect` / `@bufbuild/protobuf` / `long`）也走 `nodePaths` 指向上游 node_modules
- 上游路径默认是同级的 `../eztb`，可用环境变量覆盖：`$env:EZTB_ROOT = "<上游路径>"`

---

## 7. 当前功能清单

点击任意用户名旁的 **「查询」** 按钮打开面板（按钮文字 1.4.1 起从 `eztb` 改成「查询」），六个只读页签：

| 页签 | 内容 |
|---|---|
| 资料 | `getProfile`：贴吧号、用户名、昵称、等级、吧龄、发帖数、粉丝/关注数、IP 属地、会员、吧务、简介 |
| 成分 | 关键词规则命中的结果：命中的规则、原因（在名单里 / 关注了某个吧 / 哪条帖子命中）、命中的关键词与原文片段（高亮），以及本次扫描统计（含"其中 N 个吧来自隐藏关注贴吧的恢复"） |
| 关注的人 | `getFollow`，分页加载（每页 20） |
| 关注的吧 | `getLikeForum`（带 Lv.N 与等级称号），空则回退 `getHiddenLikeForum`（**等级取自 grade 的键**）；拿不到等级的行带「查等级」按钮（点了才查，见 §4.2） |
| 粉丝 | `getFans` |
| 发帖 | 拆成 **主题帖 / 回复** 两个子页签，各自独立翻页；每条标注 **主题 / 回复 / 楼中楼**，回复与楼中楼显示**回复正文**、带 **「查楼层」** 按钮（点了才查，见 §4.5）；页签顶部是**「发帖都发在哪些吧」的占比饼图**（`core/postStats.ts`），进页签时两路 feed 各取一页（1.6.0） |

其他：

- **「发帖」页签顶部的占比饼图**：按**吧**统计他的发帖都发在哪些吧（1.6.0 从"按类型"改成按吧，
  用户要求）。前 5 个吧各自一段，剩下的合成「其它 N 个吧」；进页签时两路 feed 各取一页，
  所以一开始就统计到回复。用 SVG 的 `stroke-dasharray` 画（不用 path 弧线：只有一个分类占 100%
  时弧线起终点重合会算出 NaN），纯字符串生成，离线可测。
  **统计口径见 §5 #26**：吧名没解析出来的行算进「未知贴吧」，绝不丢条数；
  某一路 feed 取数失败时，饼图旁边直接写明缺哪一路。
  两路没到齐时图上必须写明**「还在加载，下面的占比还不完整」**——回复那一路要按吧反查吧名，
  冷启动时可能比主题帖晚好几秒，不能让"只有主题帖"的饼图看起来像完整结果（§5 #28/#29）。
- **「查看全部 N 个吧的占比」按钮**（1.7.0）：饼图只画前 5 个吧，按钮展开后每个吧一行
  （吧名 + 横条 + 条数 + 占比），"其它"占比大时能一眼看出是哪些吧（§5 #27）。
- **「关注的吧」里的「检测签到号」**：点它才取数（发帖 feed 各一页；回复里的吧名要按吧反查一次，
  见 §5 #23——首次约 11 个请求，之后命中吧名缓存只剩 2 个），按吧统计他最近在哪儿发言，
  标出「吧内等级 ≥ 门槛、最近这批帖子里该吧 0 条发言」的吧，并给每行补上「近期发言 N 条」。
  结论里必须同时写明判定条件与样本大小（`core/activityRule.ts` 的 `signInSummary`）——
  样本只有最近一页，不能写成"他从来不发言"。门槛在设置里（`signInLevelThreshold`，默认 6）。
- **隐藏发帖记录时说明原因**（§4.6）：不再显示"没有公开的主题帖"，而是"对方隐藏了发帖记录。
- 面板底部 **「刷新当前页签」**（重新解析用户 + 重建当前页签，其它页签保留；
  在「发帖」页签里刷新后会回到刷新前选中的那个子页签）
- **页面成分标注**：配好规则后，命中的用户会在「查询」按钮旁多出一个彩色标记，
  hover 写明原因，点它直接打开面板的「成分」页签。显示几个标记由头部行的剩余空隙决定
  （最多 3 个，放不下收成 `+N`、再放不下退成一个圆点）——**任何情况下都不折行**，
  因为新版头部行是固定 40px 高，折行就会压住正文（见 §5 的 #14）
- **「关注的吧」里没等级的吧带一个「查等级」小按钮**（`src/core/forumLevel.ts`）：
  点了才去他在该吧的帖子里读等级，读到就换成 `Lv.N` 并写缓存，读不到就写"查不到"并说明原因；
  设置面板里有对应的「清空吧内等级缓存」
- 脚本菜单：**设置 BDUSS / 运行参数**、**清空用户资料缓存**、**诊断当前页面**
- 脚本菜单另有：**清空成分缓存**、**重新检测本页用户**
- 页面适配：旧版（`.l_post` / `.p_author_name` / `.lzl_cnt > .at`）、新版（`.head-line`）

---

## 8. 需要用户配合的事项

1. **每次改完必须重新安装 userscript**（油猴里粘贴新内容覆盖）。
   注意 1.3.1 起脚本**改过名**（去掉「（本地直连版）」）：`@name` 变了之后油猴会把新版当成另一个脚本，
   要先把旧条目删掉再装（设置存在脚本存储里，换条目会一起清掉，需要重新粘 BDUSS 与关键词规则）。
2. **必须卸载旧脚本 `tieba-eztb-follow.user.js`**——它的按钮已失效（href 被剥掉），
   而且会与本脚本抢 DOM 标记。本脚本检测到它时会打印一次提示。
3. 遇到"某类页面不出按钮"，用菜单里的 **「eztb：诊断当前页面」** 复制报告，
   或把该页面另存为 `.mhtml` 放进快照目录（默认同级的 `../test0`，或本仓库的 `dist/.samples/`）。
4. 要传 Greasy Fork 的话：元数据的标识已经指向本仓库，直接用 `dist/` 那份产物即可；
   但仍需**确认 tieba.js SDK 的授权**（上游没有 LICENSE 文件，见 §9 与 `THIRD-PARTY.md`）。

---

## 9. 已完成 / 未完成

> 按版本倒序。细节都在本文档前面几节，这里只记"做了什么、现在什么状态"。
> 更完整的逐条记录看 `git log`（仓库已公开）。

### 9.1 已完成

**1.7.0 / 1.7.1 · 饼图统计口径修好（不再丢条数）+ 标出"还在加载" + 「查看全部吧的占比」按钮**（用户 2026-09-27 的第二轮反馈）：

> 版本号为什么到 1.7.1：1.7.0 推上去之后又改过两次产物（先是撤掉误入提交的变异行，见 §5 #31），
> **同名同版本号用户不会收到更新**，所以任何"产物内容变了"的后续改动都必须提 `@version`。

| 需求 | 根因/做法 | 验证 |
|---|---|---|
| 「初次点进时饼图**有时**只统计主题帖」 | 回复行的吧名要靠 `getForumName` 反查，反查失败时 `forumName` 是空串，而按吧统计**把空吧名 continue 掉了** → 回复条数整批消失。现在空吧名归到「未知贴吧」（一条不少），反查失败重试一次，某一路 feed 取数失败会在饼图旁边写明缺哪一路（原来错误藏在不显示的子页签里） | keyword-test：空吧名归到「未知贴吧」而不是被跳过；click-test 不变量：**饼图条数 == 两路子页签已加载的行数** |
| 同上（**"有时"的主因其实是时序**） | 独立子代理用真实计时把这条钉死了：主题帖 511ms 到、回复 **8577ms** 才到——只画着主题帖的窗口有 **8.1 秒**，而它看起来和完整结果一模一样（反查失败率实测≈0，所以"未知贴吧"只是兜底不是主因）。做法：① 没到齐时图上写明「数据还在加载，下面的占比还不完整」；② 从主题帖 feed 白捡吧名（零请求，回复页 12 个唯一吧里白捡 8 个）；③ 反查改成有界并发（最多 3 个、间隔取 `max(150ms, 用户设置÷3)`）。详见 §5 #28/#29。**实测**：回复 8577ms → 1824ms，窗口 8066ms → 1285ms，请求数 11 → 5 | click-test 新增**同步**断言"点开「发帖」的瞬间必须看到加载提示"，另有"两路到齐后提示必须消失"；`live-test` 加了"回复页只反查 3 次（不白捡要 9 次）"，做反向验证时把它自己的变异抓了出来 |
| 「其它贴吧占比大时，要能看全部吧的占比列表」 | `buildForumStats` / `buildForumListHtml`：饼图下加「查看全部 N 个吧的占比」按钮，展开后每个吧一行（吧名 + 横条 + 条数 + 占比，按条数排序）；展开状态存在面板闭包里（`updatePie` 每次都重建 innerHTML，状态不能放 DOM） | keyword-test 5 项（排序与百分比、"其它"里的吧一个不落、收起态只有按钮、单吧不给按钮、吧名转义）；click-test：按钮存在、展开后每个吧一行且行内有名字/条数/占比、按钮变「收起」、再点收起 |

**1.6.0 · 饼图改按吧统计 + 两路 feed 一起加载 + 「查询」按钮不再压住正文**（用户 2026-09-27 的三条反馈）：

| 需求 | 做法 | 验证 |
|---|---|---|
| 饼图从"发帖/回复占比"改成"在各个贴吧的发帖、回复次数占比" | `core/postStats.ts` 换成 `buildForumSlices` / `buildForumPieSvg`：按吧名聚合，前 5 个各一段、其余合成「其它 N 个吧」，配色按排名取（稳定可比较） | keyword-test 8 项（按吧计数、累加、排序与百分比、聚合"其它"、单吧不崩、弧长合计=整圈、图例文案、吧名转义）；click-test：图例是**吧名**而不是"主题帖/回复/楼中楼"、各段合计 100% |
| 初次点进「发帖」只统计了主题帖，回复没算进去 | 进页签时**两路 feed 各取第一页**（原来点哪个取哪个）。串行限速下回复会晚几百毫秒到，饼图随数据到齐自动补全 | click-test：等饼图总数超过"只有主题帖"的数量再断言（实测 19 → 25 条），并断言预先加载的回复子页签**没有显示出来** |
| 「查询」按钮有时部分遮挡楼层正文 | 见 §5 #24：这类行把按钮贴到行顶；page-test 里加了逐行"藏起来再取同一点"的常规断言 | page-test：修复前 20/23 行压着正文，修复后 0/23；窄容器（420px）那次运行也全过 |

顺带把 page-test 扩成能读用户另存的「网页，完整」快照（`<标题>.html` + `<标题>_files/`，**自带外部 CSS**），
踩到的坑记在 §5 #25——一度又变成"在无样式页面上测布局"。

**1.5.1 · 楼中楼标出「回复了谁」+ 回复页吧名反查的请求数修复**（对 1.5.0 那五条需求的复审）：

| 事项 | 做法 | 验证 |
|---|---|---|
| 楼中楼只显示正文，看不出他在回谁 | 渲染 `PostRow.replyTo`（显示成「↩ 名字」）。这段渲染抽成纯函数 `core/postStats.ts` 的 `postRowSubParts`，离线就能测 | keyword-test 7 项（有/无 replyTo、主题帖与普通回复不标、HTML 转义）；click-test 复核面板确实走这一份渲染 |
| 「检测签到号」的请求数被 SDK 的吧名反查放大 | 回复 feed 只有 `forumId`。SDK 的 `processUserPosts(..., true)` 每次 `Effect.runPromise` 都会**重建**它的内部缓存，于是每取一页回复都按吧重发一遍 `getforumdetail`——实测一条 12 行的回复页多发 9 个请求，「检测签到号」因此从 2 个请求涨到 11 个。现在 `loadReplyPage` 自己按 forumId 缓存吧名（成功的长期有效，失败的 5 分钟后允许重试） | live-test：冷启动第一次 +9、第二次 +0；「回复行能解析出吧名」12/12 |
| 这条缓存的旧断言是**恒真**的 | 旧断言直接在热缓存上量出「第一次 +0、第二次 +0」，等于没测。现在先 `clearForumNameCache()` 清空再量 | live-test 改成「第一次会请求、第二次不重复」 |
| **「查楼层」对同一帖子的多行回复会显示同一个楼层**（独立子代理用真实数据证伪时发现的） | 行上的 pid 原来取了记录级 `PostInfoList.postId`，而一条记录可以带多条正文（同帖连发几楼），记录级 pid 是共用的。改成正文级 `UserPost.cid`（见 §4.5 与坑 #22） | live-test 新增两条：同帖多行的 postId 互不相同；同帖两行普通回复查到的是**各自**楼层（实测 4 vs 2） |

> 排查顺手补的：`scripts/probe-user.mjs` 现在会把**展平后的发帖行**（kind / 吧名 / 回复对象 / 能不能查楼层）打出来——
> 「这个字段为什么拿不到」类问题先用它看真实数据，别再猜。

**1.5.0 · 回复正文与楼层 + 占比饼图 + 签到号 + 隐藏发帖 + 成分第 6 段**（按用户给的 5 条需求做的）：

| 需求 | 做法 | 验证 |
|---|---|---|
| 回复、楼中楼显示楼层和回复内容 | 回复正文本来就在 `preview` 里，只是**没渲染**——现在显示出来了；楼层用 `getComments` 的 `data.post.floor`（§4.5），一行一个「查楼层」按钮，点了才查、查过缓存 | live-test：读到楼层=3 且与直接调接口一致、第二次走缓存；click-test：正文 6/6 行可见、点按钮后换成「N楼」并带上那一楼的内容 |
| 发帖、回复按占比画饼图 | `core/postStats.ts`：计数 + 占比 + SVG 环形图（纯逻辑）；「发帖」页签顶部渲染，翻页时更新 | keyword-test 8 项（占比、合计 100%、空数据不 NaN、单分类只画一段、弧长合计等于整圈）；click-test：图例三段、占比合计 100%、扇段数与有数据的分类一致 |
| 能否查被隐藏的主题帖 | **不能**（服务端只返回空列表），但能识别出来——`hidePost != 0` 就是"隐藏了"（§4.6）；界面改说辞，不再说"没有公开的主题帖" | live-test：不变量（hidePost=1 必为空，108 个用户里 15 个隐藏，无反例）；click-test：本地代理把该用户的 userpost 顶成 `hidePost=1` 后断言提示与空列表（不依赖真实账号的隐私设置） |
| 查成分加入"在某个吧发言"的检测 | 规则第 6 段 `postForumKeywords`：打在他**实际发过帖**的吧名上（主题帖=强证据，回复=弱证据）。放在末尾是为了不动老规则的列序 | keyword-test 8 项（新列解析、老规则不受影响、末尾多一个 `|` 也不误读、强/弱证据、排除词、指纹变化）；live-test 现有断言回归通过 |
| 查签到号（等级与活跃度不符） | `core/forumActivity.ts` 取"主题帖一页 + 回复一页"按吧统计；`core/activityRule.ts` 纯逻辑判定「等级 ≥ 门槛 且 该吧 0 条」 | keyword-test 6 项（统计、只挑达标且零发言、无等级不参与、门槛、措辞含样本与条件）；live-test 2 项（样本取得到、统计数不超过样本）；click-test：点按钮出结论、每行补「近期发言 N 条」 |

顺带修掉的两处**测试自身**的脆弱（不是产品 bug，但让套件在真实数据前变红）：
`needForumName` 与"楼中楼标记"两条断言原来赌"某个吧第一页的前几个作者"，改成扩样本后在名单里找符合条件的那个；
单个用户取数失败（实测有个 id 回 `errno 300000`）要 `try/catch` 跳过。详见 §5 的 #18～#21。

**1.4.0 · 「查等级」（点了才查）** —— 隐藏关注贴吧 + 没有用户名的用户本来拿不到吧内等级，
现在面板「关注的吧」里没等级的行带一个小按钮，点了才去他在该吧的帖子里读
（`pb/page` 的 `userList[].levelId`），读到写缓存。交叉验证：面板有等级的用户读出来一致（7=7）；
`click-test` 实测点「百度」读到 Lv.5。详见 §4.2。

**1.3.2 · 把"为什么没等级"讲清楚** —— 面板分别说明"该用户没有用户名"与"资料里只给了吧名"两种情况；
新增 `scripts/probe-user.mjs` 探查工具（回答"为什么这个字段拿不到"的标准做法）。

**1.3.1 · 脚本改名** —— `@name` 去掉「（本地直连版）」。副作用：油猴按 `@name + @namespace` 认脚本，
改名后本地旧条目会被当成另一个脚本，需要卸载重装。

**1.3.0 · 上传 GitHub + 发布准备** —— 仓库公开在
<https://github.com/Dan12elion/tieba_extensions>；补 `.gitignore`（忽略 `dist/.verify`、`dist/.samples`）、
`.gitattributes`（统一 LF）、`LICENSE`（MIT，只覆盖本工程代码）、`THIRD-PARTY.md`（内嵌库清单 +
上游 SDK 没有 LICENSE 的提醒）；README 重排（安装 / 功能 / 成分检测提到最前，构建等后置）并加上
raw 安装链接；把仓库里所有本机绝对路径改成"同级目录 + 环境变量覆盖"；元数据 `@namespace` / `@author` /
`@supportURL` 指向本仓库。

**1.2.0 · 「成分」关键词检测**（这一轮的主要功能，对应 B 站成分检测器的思路）：
  规则一行一条（`名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单`），
  命中就贴在用户名旁，或者在面板「成分」页签里看细节。
  关键实现点：`core/composition.ts` 是纯逻辑（离线可测）；
  `core/identity.ts` 与 `core/userForums.ts` 是从 `userPanel.ts` 抽出来的共用模块
  （面板和后台检测都走同一份"认人 / 取关注吧"的代码）；
  `features/compositionScan.ts` 的 `checkUser` 是**唯一**的检测入口——
  页面标记、面板结论、缓存结果都是它的产物。
  为了不变成刷接口的工具：规则为空时零请求、每页默认最多 20 人、
  同一用户走缓存（默认 3 天，规则指纹变了自动失效）、所有请求仍走串行限速队列。
  反向验证做了三次：忽略排除词 → `keyword-test` 2 项失败；把弱证据当强证据 → 再加 1 项失败；
  不贴徽章 → `click-test` 2 项失败。
  过程中真踩到一个 bug 并修掉：`rescanPage()` 原本只清内存缓存，`checkUser` 会从落盘缓存里读回旧结果，
  「重新检测本页用户」等于空操作——现在排队时带 `force`，并且 `click-test` 会断言"重新检测确实发了新请求"。

**1.1.0 · 「发帖」拆子页签 + 未压缩产物 + Greasy Fork 元数据**（下面三条）：

- 「发帖」页签已按用户之前的意思拆成 **主题帖 / 回复** 两个子页签，各自独立翻页
  （`src/features/userPanel.ts` 的 `renderPostsTab` / `mountPostsSubList`，
  样式在 `src/ui/styles.ts` 的 `.tb-eztb-subtab*`）。
  子页签是懒加载的：没点过的那个不发请求；切走再切回来内容保留；
  点「刷新当前页签」会重建整个「发帖」页签并停回刷新前的那个子页签。
  反向验证做过两次：把两条 feed 并回一个列表 → `click-test` 3 项失败；
  去掉「回复」子页签 → 另外 3 项失败。

- **产物改成未压缩的可读版**（`build.mjs` 默认不再 `minify`）：Greasy Fork 的规则要求
  "不得混淆或压缩，必须以非压缩的形式输出，保留空白和变量名"，油猴编辑器里也只有
  未压缩版能正常换行。压缩版改成 `node build.mjs --minify` 另存
  `dist/tieba-eztb-toolbox.min.user.js`，**不要传那个**。
  反向验证：拿压缩版跑 `EZTB_BUNDLE=… node scripts/verify.mjs` → "产物是未压缩的可读形式" 失败。

- **按 Greasy Fork 要求补了元数据**（`build.mjs` 的 `META`）：`@name:zh-CN` /
  `@description:zh-CN` 语言标记、`@compatible chrome|edge`、`@incompatible firefox`、
  `@license MIT`（SPDX）；`@namespace` / `@author` / `@supportURL` 改成环境变量可覆盖
  （`EZTB_NAMESPACE` 等），默认值里不再出现假的 github 地址。
  另外产物末尾加了 **NOTICE**：内嵌库的来源、名称、版本（规则要求"内嵌库必须写明来源"）。
  这些要求本身也钉进了 `verify.mjs` 的 V7 组（14 项）。

**两次用户反馈的排查细节**（技术结论见 §4.2 与 §5 的 #14/#15，这里只留结论）：

1. **「隐藏关注贴吧没被计入成分判定」**：根因是恢复通道只在主接口**返回空**时才走，
   接口一旦**抛错**（隐藏列表、接口抽风）就整块跳过，关注的吧证据直接丢失。
   现在 `loadUserForums(id, profileForums)` 把 profile 自带的「关注贴吧」字段
   （零额外请求）与主接口结果合并，主接口空或失败时才走 `getHiddenLikeForum`；
   检测统计多一项 `forumsRecovered`，面板会写明"其中 N 个来自隐藏关注贴吧的恢复"。
   验证：`live-test` 两条断言 + `click-test` 用「关注吧关键词 = 小红书」跑通端到端。

2. **「新版页面上成分标记压住回帖正文」**：新版头部行固定 40px 高，而标记容器当时允许折行，
   命中 2~3 条时折成两三行，实测溢出 12.5~13px。现在强制单行、
   按行内剩余空隙决定显示几个（`+N` → 圆点兜底），并给 `.btn-wrapper` 加了 `:has()` 收缩规则。
   反向验证：`nowrap` 改回 `wrap` → `page-test` 两条断言失败。
   顺带发现 MHTML 不带外部 CSS，"快照里的布局"之前是假象（§5 #15）。

### 9.2 还没做的 / 可以继续

- 子页签只能显示"已加载 N 条"——`UserPostResIdl` 不返回总数，拿不到"共 N 条"。
  若想显示总数，只能靠一直翻到底（不值得）。
- 成分检测目前只看**第 1 页**发帖（主题帖 60 条 + 回复 60 条）。想让判断更准可以做成可配置的页数，
  代价是每个用户的请求数线性上涨——现在的取舍是"够用且不像在刷接口"。
- 关注吧与发帖都取不到时（比如对方设了隐私、或 BDUSS 失效），面板会列出"部分数据没取到"的原因，
  但标记不会出现；可以考虑给这种情况一个"证据不足"的独立标记。
- V4 / V6 那两项人工验证（带真实 BDUSS 的鉴权接口、真实贴吧页面上的日常使用）
  仍然没做，需要用户在自己的浏览器里装一次。
- **上传 Greasy Fork（还没做）**：产物已经满足它的硬性要求（未压缩、1.0 MB、元数据齐全），
  直接传 `dist/` 那份即可。用户已经决定把代码公开在 GitHub（`THIRD-PARTY.md` 里写明了
  上游 SDK 没有 LICENSE 这件事）；剩下的是他自己愿不愿意往脚本站再发一份。

### 9.3 明确排除的范围（不要擅自扩大）

- 任何写操作（关注/取关/签到/回帖），不碰 `tbs`
- 导出、吧内分析、DB 统计（这些在 `apps/api` 层）
- 修改 `packages/sdk` 源码
- 保留"用 eztb.org 打开"的降级入口

### 9.4 已知的工程约束

- 上游 `packages/sdk` 锁在 `v3` 分支；协议或结构变动后需要重新打包并复跑 `verify.mjs`
- 本工程与上游是**两个独立目录**，没有 git submodule 关系（`EZTB_ROOT` 指过去即可）
- 整个上游仓库（含 SDK、API）**没有 LICENSE 文件**，要对外分发前需先确认授权
- `dist/tieba-eztb-toolbox.user.js` **是提交进仓库的**：改完代码要 `node build.mjs` 重建并一起提交，
  否则仓库里的产物会落后于源码（README 里给了 raw 安装链接，别人装的就是这一份）
- 快照（`../test0/*.mhtml`）与 CSS 缓存不进仓库：含真实用户帖子内容，体积也大

---

## 10. 新对话怎么接着干

1. 先读这份 `HANDOFF.md` 和 `README.md`，再动代码。
2. **改完必须跑五套测试**（`verify` / `keyword-test` / `live-test` / `click-test` / `page-test`），
当前基线（1.7.0 实测）：verify 39 / keyword-test 69 / live-test 32 / click-test 140 / page-test 34 项全绿；
   page-test 现在读**仓库根目录下那份网页快照**（已 gitignore），不再需要 `../test0`；
   快照不在时相关用例会显示"跳过"并注明。
3. 涉及 DOM 或布局的改动，**加反向验证**：把修复改回去，确认断言会失败。
4. 涉及协议或数据模型的疑问，**先打真实数据**：`EZTB_PROBE=1 node scripts/live-test.mjs`
   或 `node scripts/probe-user.mjs <portrait|ID> [吧名]`，不要凭推测改。
5. **改完代码要重新构建产物并提交**：`node build.mjs` → 跑测试 → 改 `package.json` 版本号 →
   `git add -A && git commit && git push`（仓库已公开，`main` 直接推）。
6. 每次交付都要提醒用户：**重装脚本**（油猴里覆盖，或者用 README 里的 raw 链接）。
7. 交付时按"用户能感知到什么"来描述（面板多了什么按钮、标记长什么样），
   而不是只报"改了哪个文件"。
