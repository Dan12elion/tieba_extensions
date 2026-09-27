# eztb-userscript — 改造与验证清单（已归档）

> 立项时的清单，下面每一项都已经落地。现状、踩坑与接手流程看 [HANDOFF.md](HANDOFF.md)；
> 这份留作"为什么一开始这么定"的记录。

把 [eztb](https://github.com/Dilettante258/tieba-toolbox) 的核心能力（tieba.js SDK）直接编译进油猴脚本，
让脚本在贴吧页面上就地查询数据，**不再经过 eztb.org 等任何第三方服务**。

## 一、已确认的决策

| 编号 | 决策 |
| --- | --- |
| D1 | 独立工程目录（与上游 eztb 仓库并列），命名上标记归属 |
| D2 | 仅 Edge / Chrome，不承诺 Firefox |
| D3 | 用户手动粘贴 BDUSS，存 `GM_setValue`；界面内提供获取 BDUSS 的网址 |
| D4 | "方便做的"只读功能全部纳入第一版 |

## 二、验收标准

- 点按钮后 DevTools Network 里 `eztb.org` / `cf.eztb.org` / `sealosbja.site` 的请求数为 **0**。
- 数据由内置的 SDK 直连 `tiebac.baidu.com` 获取。
- 旧版、新版贴吧页面都能注入按钮并正常查询。
- 发布物是**单个 `.user.js`**，不依赖任何外部 URL（不使用 `@require` 远程加载）。

## 三、架构约束

- 不改 `packages/sdk` 源码：Node 相关的替换全在构建层（esbuild 解析插件）完成，
  上游 `v3` 分支更新后重新打包即可。
- 所有请求只打 `tiebac.baidu.com`（`http://` 在传输层统一升级为 HTTPS）。
- 只做只读操作，不触碰 `tbs` 写链路。

## 四、改造清单（全部完成）

### A. 构建工程

- [x] 独立仓库（与上游并列）。
- [x] esbuild：`--bundle --format=iife --platform=browser --target=es2020`，**默认不压缩**
  （Greasy Fork 要求提交未压缩的可读版）。
- [x] 依赖替换用解析插件而不是 `--alias` 参数（`scripts/shims-plugin.mjs`，打包与测试共用同一套规则）。
- [x] 注入 `Buffer` 垫片（全 SDK 仅 `core/http.ts` 一处 `Buffer.from`）。
- [x] 产物 + 元数据 → 单个 `.user.js`。
- [x] 体积：约 1.0 MB（不压缩的代价，仍远低于 Greasy Fork 的 2.0 MB 上限）。

### B. 适配点

`undici` → 同签名 `request()` 走 `GM_xmlhttpRequest`（`dump` 不可省）；`node:crypto` → 纯 JS MD5
（只返回小写 hex，调用方自己转大写）；`node-html-parser` → `DOMParser`
（`<script>` 的 `innerText` 要映射到 `textContent`）。细节见 HANDOFF §3.1。

### C. 运行时

- [x] `@connect tiebac.baidu.com`
- [x] 串行限速队列（默认最小间隔 400ms，可配置），SDK 层不含限速
- [x] BDUSS 入口（`GM_registerMenuCommand` → 输入 → `GM_setValue`）与失效提示
- [x] 结果缓存（用户资料 7 天；成分结果带规则指纹；吧名 / 楼层 / 吧内等级各有缓存）

### D. 基线脚本改造

- [x] 删掉 `EZTB_BASE`、`.tb-eztb-popup*` 样式、`eztbUrl()`、`showEztbPopup()` 的 iframe 逻辑
- [x] 弹窗改为自渲染（现在的 `src/ui/` + `src/features/`）
- [x] 保留新旧版 DOM 适配、UID 解析、按钮注入、缓存策略

### E. 第一版功能

- [x] 用户资料（`getProfile` / `getUserByUid`）
- [x] 关注的人（`getFollow` —— 它返回的是**用户**，不是贴吧）
- [x] 粉丝（`getFans`）
- [x] 关注的吧（`getLikeForum`，空则回退 `getHiddenLikeForum`）
- [x] 用户发帖（自建 `is_thread` 双 feed：主题帖 / 回复各自分页）

## 五、验证清单

| 编号 | 验证项 | 状态 |
| --- | --- | --- |
| V1 | BDUSS 是否可从 cookie 读取 | 不做（D3 手动粘贴） |
| V2 | 带鉴权的 `POST /c/s/login`（tbs） | 只读方案不需要 |
| V3 | 别名能否 bundle、体积多少 | 通过（`verify.mjs`） |
| V4 | 裸 HTML 页面内跑通 `getFollow` | 未验证（需真实 BDUSS） |
| V5 | `packRequest` 签名与 Node 版逐字符比对 | 通过（`verify.mjs`，现 39 项） |
| V6 | 装进油猴，新旧版页面各测一遍 | 未验证（需真实浏览器） |

> V4 / V6 只能由使用者在自己浏览器里确认，其余都已自动化。

## 六、里程碑

- M1（打包链路）已达成；M2 / M3 需要真人浏览器里的 BDUSS，至今没做。
- 实际推进中，协议链路是靠**匿名接口 + 真实数据**验通的（`scripts/live-test.mjs`），不是靠 V4；
  M4 的只读扩展（成分检测、查楼层、签到号、按吧饼图）也早已做完，见 HANDOFF §9.1。

## 七、明确不做

写操作（关注/取关/签到/回帖）、导出、吧内分析、DB 统计、改 `packages/sdk` 源码、
保留"用 eztb.org 打开"的降级入口。
