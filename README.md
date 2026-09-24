# eztb-userscript

把 [eztb](https://github.com/Dilettante258/tieba-toolbox) 的只读查询能力
（tieba.js SDK）**直接编译进油猴脚本**，在贴吧页面上就地查询数据。

数据全部由脚本直连 `tiebac.baidu.com`，**不经过 eztb.org 或任何其他第三方服务**。

> 本仓库：<https://github.com/Dan12elion/tieba_extensions>
> 元数据里的 `@namespace` / `@author` / `@supportURL` 都指向它（见 `build.mjs`）；
> 如果你是 fork 这个工程，记得用 `EZTB_NAMESPACE` / `EZTB_AUTHOR` 换成自己的标识。

## 与旧脚本的关系

基线脚本（早期那个点击按钮后在 iframe 里内嵌 `https://www.eztb.org/follow` 的版本，
每点一次都会让别人的服务器交付一整套前端资源）不在本仓库里。
本工程保留它已经验证过的部分（新旧版 DOM 适配、UID 解析、按钮注入、缓存），
但把数据来源换成了脚本内置的 SDK。

## 目录结构

```
eztb-userscript/
├─ build.mjs              # esbuild 打包 + 拼接油猴元数据
├─ scripts/
│  ├─ shims-plugin.mjs    # Node → 浏览器 的解析替换规则（打包与校验共用）
│  └─ verify.mjs          # 自动校验：MD5 签名、产物检查
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

本工程**刻意不重复安装依赖**，直接使用上游 eztb 仓库里已装好的 `effect`、
`@bufbuild/protobuf` 和 esbuild。默认从**与本项目同级的 `../eztb`** 取，
可以用 `EZTB_ROOT` 指向别处：

```powershell
$env:EZTB_ROOT = "<上游 eztb 仓库的路径>"   # 可选，默认 ../eztb
node build.mjs            # 可读版（默认）
node build.mjs --minify   # 压缩版，写到 dist/tieba-eztb-toolbox.min.user.js
node scripts/verify.mjs
```

产物：`dist/tieba-eztb-toolbox.user.js`（**未压缩**，约 1.0 MB / 2.9 万行）。

默认不压缩是有意为之：Greasy Fork 的发布规则里写着「提交到 Greasy Fork 的代码不得
混淆或压缩……必须以非压缩的形式输出，保留空白和变量名」，而油猴的编辑器里也只有
未压缩的版本才能正常换行阅读。`--minify` 那条路径写的是另一个文件名，不会覆盖可读版，
而且**压缩版不能传到 Greasy Fork**（会被删除）。

元数据里凡是跟"你是谁"有关的部分都可以用环境变量覆盖，不用改代码：

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `EZTB_NAME` | `@name`（同时生成 `@name:zh-CN`） | 贴吧 eztb 工具箱（本地直连版） |
| `EZTB_NAMESPACE` | `@namespace`，与 `@name` 一起构成脚本唯一标识 | `eztb-userscript` |
| `EZTB_AUTHOR` | `@author`，留空则不输出该行 | 空 |
| `EZTB_SUPPORT_URL` | `@supportURL`，留空则不输出该行 | 空 |

> `@namespace` 一旦发布就不要改，否则所有已安装的用户会被当成装了另一个脚本。

## 安装

1. 在 Edge / Chrome 安装 Tampermonkey（或 Edge 版 Tampermonkey）。
2. 打开 Tampermonkey 面板 → 添加新脚本 → 用 `dist/tieba-eztb-toolbox.user.js`
   的内容替换掉模板 → 保存。
3. 首次使用点脚本菜单「eztb：设置 BDUSS / 运行参数」，按提示粘贴 BDUSS。

装好之后的地址栏直接打开 `dist/tieba-eztb-toolbox.user.js` 的 raw 链接也能安装
（油猴会识别 `.user.js` 并弹出安装框）：

```
https://raw.githubusercontent.com/Dan12elion/tieba_extensions/main/dist/tieba-eztb-toolbox.user.js
```

## 发布到 Greasy Fork

已按它的发布规则逐条核对过（[code-rules](https://greasyfork.org/zh-CN/help/code-rules)、
[meta-keys](https://greasyfork.org/zh-CN/help/meta-keys)），并且把这些要求写成了
自动校验（`verify.mjs` 的 **V7 · Greasy Fork 发布要求** 一组断言）：

| 要求 | 本工程的做法 |
| --- | --- |
| 代码不得混淆或压缩，要保留空白与变量名 | 默认构建就是未压缩的可读版（约 2.9 万行，最长行不到 2000 字符） |
| 脚本大小 ≤ 2.0 MB | 约 1.0 MB |
| `@name`、`@description` 必填 | 都有，且各带一份 `:zh-CN` 语言标记 |
| 至少一个 `@match`/`@include`，且只匹配自己提供功能的站点 | 两个 `*://…tieba.baidu.com/*` |
| `@license` 用 SPDX 标识符 | `MIT` |
| 内嵌的库必须写明来源、名称与版本 | 文件末尾的 NOTICE 逐条列出（tieba.js SDK / effect / @bufbuild/protobuf / long，含仓库地址与版本号） |
| 不要自己写 `@updateURL` / `@downloadURL` | 没有写，交给 Greasy Fork 自动改写 |
| 主要功能必须在站内代码里实现 | 全部打包进单文件，不使用 `@require` 远程加载 |

上传之前还需要你补两件事：

1. 确认元数据里的标识是你的（本仓库的默认值已经指向 `Dan12elion/tieba_extensions`；
   fork 的话用 `EZTB_NAMESPACE` / `EZTB_AUTHOR` 覆盖后再构建）。
2. **确认 tieba.js SDK 的授权**：上游 `eztb` 仓库和 `packages/sdk` 都没有 LICENSE 文件，
   也没声明 `license` 字段。规则里"必须遵守他人的版权"这条要求你确实有权分发这段代码，
   没确认之前不建议公开上传。

> 为什么不用 `@require` 加载库？SDK 里有 4 个 Node 依赖（`undici`、`node:crypto`、
> `node-html-parser`、`Buffer`）需要在构建时替换成浏览器实现，直接 `@require` 原版是跑不起来的。
> 规则允许内嵌，前提是写明来源——也就是上面那条 NOTICE。

## 功能

点击任意用户名右侧的 `eztb` 按钮，打开用户面板，含六个只读页签：

| 页签 | 数据来源 | 说明 |
| --- | --- | --- |
| 资料 | `getProfile` | 基础资料、等级、吧龄、发帖数等 |
| 成分 | 关注的吧 + 主题帖 + 回复 | 按关键词规则标注这个用户的"成分"，命中的词在原文里高亮 |
| 关注的人 | `getFollow` | **返回的是用户，不是贴吧**（每页 20 条，按需翻页） |
| 关注的吧 | `getLikeForum` → 回退 `getHiddenLikeForum` | 带吧内等级 Lv.N |
| 粉丝 | `getFans` | |
| 发帖 | 自建请求（`is_thread` 双 feed） | 拆成 **主题帖 / 回复** 两个子页签，**各自独立翻页**；每条标注 **主题 / 回复 / 楼中楼** |

面板底部提供 **「刷新当前页签」**：重新解析用户并重建当前页签，其它页签的内容保留；
在「发帖」页签里刷新后会回到刷新前选中的那个子页签。

## 成分检测（关键词标注）

参考 B 站"成分检测器"的做法：配好关键词规则后，脚本会在后台逐个检查页面上出现的用户，
命中就在用户名旁挂一个彩色标记，点标记直接看"命中了哪条规则、命中了什么"。

规则在设置面板里逐行写，格式是：

```
# 注释行随便写
🎮原神 | 原神,芙宁娜,米哈游 | 原神吧,米哈游吧 | 原神怎么你了
🎁抽奖 | 互动抽奖,转发本条动态
⚠️某个名单 | | | | 1234567890
```

`名称 | 发帖关键词 | 关注的吧关键词 | 排除关键词 | 直接命中名单`，后三段都可以省略，关键词用逗号分隔。

匹配与判定：

- **发帖**关键词打在该用户主题帖与回复的「标题 + 正文摘要」上（各取第 1 页，每页 60 条）；
  **吧**关键词打在该用户关注的吧名上。
- **隐藏了关注贴吧的用户也算数**：`getLikeForum` 拿不到东西时，脚本会从资料接口自带的
  「关注贴吧」字段与用户面板的等级分组里恢复出一部分吧名，一起参与判定；
  面板的「成分」页签会写明"其中 N 个来自隐藏关注贴吧的恢复"。恢复出来的列表可能不完整——
  这是贴吧本身的限制，不是脚本偷懒。
- **排除关键词**命中就整条不算——用来压住"只是玩梗/讨论"这类误伤。
- 证据分强弱：名单、关注的吧、**主题帖**算强证据；**回复与楼中楼**只算弱证据，
  界面上会标"证据较弱，可能是误判"，标记也会淡一些。
- 一个用户同一条规则命中多处（既关注了那个吧、又发过相关主题帖）会合并成一个标记，不会重复刷屏。

请求成本与开关：

- **规则表为空时，一个请求都不会发**（这是默认状态，装上不会打扰任何人）。
- 每个用户最多 3 个请求（关注的吧 + 主题帖 + 回复）。设置里可限制**每页最多检测多少人**（默认 20），
  超出的不再排队；同一个用户在缓存有效期内只查一次（默认 3 天，改规则会让缓存自动失效）。
- 所有请求仍然走那条串行限速队列，与手动查询共用同一个间隔设置。

脚本菜单里另有两个入口：**「eztb：重新检测本页用户」**、**「eztb：清空成分缓存」**。

脚本菜单里还有一个 **「eztb：诊断当前页面」**，会列出当前页面的 URL、各扫描器
选择器的命中数、已注入按钮数，以及页面上所有用户主页链接的 class 统计——
遇到「某类页面不出按钮」时，把这个报告发出来即可定位。

> 术语对照（容易搞错，已踩过坑）：
> 上游网页的 `/follow` 页面是「关注列表 / 共关注 N 人」，对应 `getFollow`；
> 「关注的吧」是 `/likeforum` 页面，对应 `getLikeForum`。两者不是同一个接口。

全部为只读，不涉及 `tbs`、不执行任何写操作。

## 关键设计

- **不改 SDK 源码**：`packages/sdk` 保持原样，所有 Node 依赖替换都在构建层用
  esbuild 解析规则完成。上游更新后重新打包即可。
- **协议统一升级为 HTTPS**：SDK 的 `BASE_URL` 是 `http://tiebac.baidu.com`，
  而该域名支持 HTTPS（SDK 自己的 `getPanel` 就用的 https），
  因此传输层统一改写协议，避开混合内容问题。
- **串行限速**：所有请求经 `SerialQueue` 排队，默认最小间隔 400ms，
  且分页由脚本逐页驱动，不使用 SDK 内部的并发 `ALL` 拉取。
- **凭据本地化**：BDUSS 存在油猴存储（浏览器配置目录）里，不上传任何地方。
- **按钮必须显式声明 `pointer-events:auto !important`**（见 `src/ui/styles.ts`）：
  新版贴吧把操作按钮放在 `.btn-wrapper` 里，该容器常态是 `pointer-events:none`，
  子元素不覆盖就会「看得见、点不动」。这条是踩过的坑，不要删。
- **点击走 document 捕获阶段的事件委托**（见 `src/main.ts`）：
  页面在冒泡阶段的事件处理可能吞掉点击，挂在按钮自身上的监听会收不到。
- **列表行的标题/副标题必须是块级**（见 `src/ui/styles.ts`）：
  `overflow:hidden` + `text-overflow:ellipsis` 对 `display:inline` 的元素完全无效，
  会让两行文字挤在同一行并撑乱行高。改回行内会立刻复现「内容错位」。
- **隐藏关注贴吧时，等级藏在 `panel.honor.grade` 的键上**：
  结构是 `{ 吧内等级: { forum_list: [吧名] } }`，必须按组展开才能保留等级；
  只取 `forum_list` 会把等级全部丢掉。
- **每个页签必须有独立容器**（见 `src/features/userPanel.ts`）：
  所有页签共用一个容器、再记一个"已初始化"集合，会同时引入两个 bug——
  切回访问过的页签被提前 return（容器里留着上一个页签的内容），
  以及上一个页签的异步回调返回时覆盖当前页签的内容。
  现在的做法是每页签一个 `.tb-eztb-pane`，切换只切显隐，已加载的内容保留。
  「发帖」页签内部同理拆成两个子页签（`.tb-eztb-subpane`），各自持有容器与分页状态。
- **按钮的 z-index 只能是 5**：曾经为了修点击问题设成 `2e9`，结果页面弹层/遮罩
  该盖住按钮时盖不住。点击问题的真正解法是 `pointer-events:auto`，不是抬 z-index。
- **发帖列表必须用 `getUserPost(id, page, true)`**：发帖接口默认不返回吧名，
  需要 SDK 用 `forumId` 反查，否则每一条都显示「未知贴吧」。
- **「已处理」标记不能与旧脚本重名**（见 `src/page/scanner.ts`）：
  本脚本用 `data-tb-eztb-toolbox-done`。早期版本沿用了旧脚本的
  `data-tb-eztb-done`，两个脚本同时装时**谁先跑谁就把元素标记完**，
  后跑的那个扫描时全部跳过、一个按钮都不注入——表现为「某些页面完全没有按钮」。
  脚本检测到旧脚本的按钮时会提示卸载。
- **「主题帖」和「回复」是两个独立 feed**（见 `src/core/userPost.ts`）：
  由 protobuf 的 `is_thread` 切换（`is_thread=1` 才是主题帖）。SDK 只暴露了
  回复那一路，所以这里自己构造请求。两个 feed 形状也不同——主题帖没有
  `content[]`，正文在 `first_post_content[]`，`processUserPosts` 对它返回 0 条，
  因此主题帖的行直接由原始条目构造；回复 feed 的原始 `title` 一律带「回复：」前缀
  （SDK 会抹掉）。
  两条 feed 的分页互相独立（每页 60 条），所以面板里**不做跨 feed 的时间归并**，
  而是「主题帖 / 回复」两个子页签各自翻页、各自保留已加载的内容。
- **「成分」标注与面板走同一条检测路径**（见 `src/features/compositionScan.ts` 的 `checkUser`）：
  页面上贴的标记、面板「成分」页签的结论、写进缓存的结果都出自同一次检测，
  不会出现"页面标了、面板却说没中"这种打架。缓存里记着规则指纹（`hashRules`），
  改了规则表缓存就自动失效，不需要手动清。
- **成分标记必须待在头部行的高度内**（见 `src/ui/styles.ts` 的 `.tb-eztb-badges`）：
  新版贴吧的头部行高度写死 40px（`.image-text .user-info{height:40px}`），
  标记一折行就会顶到下面的标题与正文上（实测压住 13px）。所以标记容器是
  `flex-wrap:nowrap` + 允许压缩裁剪，页面代码那边按行的剩余空隙决定显示几个标记，
  放不下就退成 `+N` 甚至一个圆点。改回 `wrap` 会立刻复现"标记压住正文"。
- **手写 protobuf 请求必须走 `fromPartial`**：生成代码的 `encode` 用
  `字段 !== 默认值` 判断是否写入，直接传部分对象会让缺失的 int64 字段以
  `undefined` 进入 `BigInt()` 而抛错（踩过：`Cannot convert undefined to a BigInt`）。

## 自动校验

四个脚本，都不需要 BDUSS：

| 命令 | 验证内容 |
| --- | --- |
| `node scripts/verify.mjs` | 浏览器版 MD5 / `packRequest` 与 Node 版逐字符一致；产物无残留 Node 依赖、不含 eztb.org；以及 Greasy Fork 的发布要求（39 项） |
| `node scripts/keyword-test.mjs` | 「成分」规则解析、匹配、排除词、证据强弱、高亮转义（29 项，纯离线） |
| `node scripts/live-test.mjs` | 打真实贴吧接口（匿名 proto 端点），验证签名、protobuf、multipart、HTTPS 升级、翻页、关键词匹配与"隐藏关注贴吧"的恢复（17 项） |
| `node scripts/click-test.mjs` | 无头 Edge/Chrome 里验证按钮注入、命中测试（`elementFromPoint`）、面板渲染、子页签独立翻页、成分标记（含隐藏关注贴吧参与判定）与菜单命令（85 项） |
| `node scripts/page-test.mjs` | 用真实页面快照（mhtml + 抓下来的 CSS）离线回归：按钮注入、新版头部行的排版约束（66 项） |

> 快照本身不带外部 CSS（MHTML 只存内联样式）。先跑一次
> `node scripts/fetch-sample-css.mjs` 把样式抓到 `../test0/_css_cache`（可用 `EZTB_SAMPLE_DIR` / `EZTB_CSS_DIR` 改路径），
> 否则"标记压住正文"这类布局问题测不出来。

**尚未验证**（需要真实浏览器 + 有效 BDUSS）：

- 带 BDUSS 的鉴权接口（关注吧 / 粉丝 / 收藏吧 / 发帖）
- 真实贴吧页面上的按钮注入与自愈

## 开发说明与致谢

本仓库的代码、测试与文档由作者 **Dan12elion** 与 AI 助手协作完成：

| | |
| --- | --- |
| 模型 | DeepSeek |
| 工具 | Codex 桌面版（在本机执行构建与测试） |

AI 在这里是协作工具而不是作者：每一步改动都由作者确认后才提交，
[LICENSE](LICENSE) 里的版权人也只写作者本人；AI 生成的内容不单独主张版权。

## 合规提醒

- BDUSS 等同于账号登录凭据，请勿分享或粘贴到不可信的网站。
- 请保持默认的请求间隔，不要用它做批量抓取或任何自动化写操作。
- 许可见 [LICENSE](LICENSE)（本工程自己的代码，MIT）与
  [THIRD-PARTY.md](THIRD-PARTY.md)（内嵌的第三方代码及其授权状态）。
- 上游 eztb 仓库与 `packages/sdk` **没有 LICENSE 文件**，也没声明 `license` 字段；
  产物里内嵌了这段 SDK 代码（来源与版本见文件末尾 NOTICE），
  对外分发（含上传到脚本站）前需自行确认授权。
- 产物里另外内嵌了三个有明确许可的库：effect（MIT）、@bufbuild/protobuf
  （Apache-2.0 AND BSD-3-Clause）、long（Apache-2.0）。
