# eztb-userscript — 改造与验证清单

把 [eztb](https://github.com/Dilettante258/tieba-toolbox) 的核心能力（tieba.js SDK）
直接编译进油猴脚本，让脚本在贴吧页面上就地查询数据，**不再经过 eztb.org 等任何第三方服务**。

## 一、已确认的决策

| 编号 | 决策 | 说明 |
| --- | --- | --- |
| D1 | 独立工程目录 | 与上游 eztb 仓库并列的一个独立仓库（本仓库），命名上标记归属 |
| D2 | 目标浏览器 | 仅 Edge / Chrome（不承诺 Firefox） |
| D3 | 凭据方式 | 用户手动粘贴 BDUSS，存于 `GM_setValue`；界面内提供获取 BDUSS 的网址与说明 |
| D4 | 功能范围 | "方便做的"只读功能全部纳入第一版 |

## 二、验收标准

- 点击按钮后，DevTools Network 面板中 `eztb.org` / `cf.eztb.org` / `sealosbja.site` 的请求数为 **0**
- 数据由脚本内置的 tieba.js 直连 `tiebac.baidu.com` 获取
- 旧版、新版贴吧页面均可注入按钮并正常查询
- 发布物为**单个 `.user.js` 文件**，不依赖任何外部 URL（不使用 `@require` 远程加载）

## 三、架构约束

- **不修改 `packages/sdk` 源码**：所有 Node 相关替换都在构建层用 esbuild 别名完成，
  这样上游 `v3` 分支更新时只需重新打包。
- 所有请求都只打 `tiebac.baidu.com`。
- 只做只读操作，不触碰 `tbs` 写链路。

## 四、改造清单

### A. 构建工程

- [x] 建立独立仓库（与上游 eztb 仓库并列）
- [x] esbuild 打包：`--bundle --format=iife --platform=browser --target=es2020 --minify`
- [x] 三个别名：
      `--alias:undici=./src/shims/undici-gm.ts`
      `--alias:node:crypto=./src/shims/md5.ts`
      `--alias:node-html-parser=./src/shims/html.ts`
- [x] 注入 `Buffer` 垫片（全 SDK 仅 `core/http.ts` 一处用到 `Buffer.from`）
- [x] 构建产物 + 元数据 → 拼出单个 `.user.js`
- [x] 体积预算 800KB（实际 414.8 KB）

### B. 适配点

| 目标 | 替换对象 | 实现要点 | 优先级 |
| --- | --- | --- | --- |
| `undici` | `core/http.ts` 的 `request` / `Agent` / `FormData` | 走 `GM_xmlhttpRequest`，实现 `{statusCode, statusText, body:{json, arrayBuffer, text, dump}}`；`dump` 不可省 | 必须 |
| `node:crypto` | `core/auth.ts` 的 MD5 签名 | 纯 JS md5；只需返回小写 hex（调用方自己 `toUpperCase()`） | 必须 |
| `Buffer` | `core/http.ts` 的 `Buffer.from` | `globalThis.Buffer ??= { from: (x) => x }` | 必须 |
| `node-html-parser` | `api/forum.ts` 的 HTML 解析 | 用 `DOMParser`；注意 `script` 的 `innerText` 需映射到 `textContent` | 可延后 |

额外发现并处理：SDK 的 `BASE_URL` 是 `http://tiebac.baidu.com`，已确认该域名支持
HTTPS，因此在传输层统一升级协议，避免 HTTPS 页面发起明文请求被拦截。

### C. 运行时

- [ ] `@connect tiebac.baidu.com`
- [ ] 限速队列（串行、最小间隔 300–500ms），SDK 层不含限速
- [ ] BDUSS 入口：`GM_registerMenuCommand` → 输入 → `GM_setValue`
- [ ] BDUSS 失效识别与重填提示
- [ ] 结果缓存

### D. 现有脚本改造

基线脚本：早期那个把 `eztb.org/follow` 内嵌进 iframe 的版本（不在本仓库里）

- [ ] 删除 `EZTB_BASE`、`.tb-eztb-popup*` 样式、`eztbUrl()`、`showEztbPopup()` 的 iframe 逻辑
- [ ] 弹窗改为自渲染列表
- [ ] 保留：新旧版 DOM 适配、uid 解析、按钮注入、缓存策略

### E. 第一版功能（D4：方便做的全上）

- [ ] 用户资料（`getProfile` / `getUserByUid`）
- [ ] 关注贴吧列表（`getFollow`，支持全量）
- [ ] 粉丝列表（`getFans`，支持全量）
- [ ] 收藏/关注贴吧（`getLikeForum` / `getHiddenLikeForum`）
- [ ] 用户发帖记录（`getUserPost`）

## 五、验证清单

| 编号 | 验证项 | 状态 |
| --- | --- | --- |
| V1 | BDUSS 是否可从 cookie 读取 | 已决定不依赖（D3 手动粘贴） |
| V2 | 带鉴权的 `POST /c/s/login`（tbs） | 只读方案不需要，跳过 |
| V3 | 三个别名能否 bundle 成功、体积多少 | 待验 |
| V4 | 裸 HTML 页面内跑通 `getFollow` | 待验（需用户提供 BDUSS） |
| V5 | `packRequest` 签名与 Node 版逐字符比对 | 待验 |
| V6 | 装进油猴，新旧版贴吧页各测一遍 | 待验 |

> 更新：V3 与 V5 已由 `node scripts/verify.mjs` 自动通过（24 项断言）。
> V4 / V6 需要真实浏览器与有效 BDUSS，仍需人工验证。

> 说明：`https://tiebac.baidu.com` 的 HTTPS 可用性、GM_xhr 的 multipart + arraybuffer 支持，
> 已由基线脚本 `postProfileProto()` 在生产环境中证实，无需重复验证。

## 六、里程碑

- **M1**：V3/V5 通过 → 打包链路成立
- **M2**：V4 通过 → 协议 + 凭据链路成立
- **M3**：V6 通过 → 可日常使用
- **M4**：扩展更多只读功能

## 七、明确不做

- 不做写操作（关注/取消关注/签到/回帖），不碰 `tbs`
- 不做导出、吧内分析、DB 统计（这些在 API 层，本方案拿不到）
- 不改 `packages/sdk` 源码
- 不保留"用 eztb.org 打开"的降级入口
