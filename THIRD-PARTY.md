# 第三方代码说明

`dist/tieba-eztb-toolbox.user.js` 是单文件产物，内嵌了下面这些第三方代码
（`build.mjs` 会把这份清单写进产物末尾的 NOTICE）：

| 组件 | 版本 | 许可 | 来源 |
| --- | --- | --- | --- |
| tieba.js SDK（上游 eztb 的 `packages/sdk`） | v3 分支 | **未声明** | <https://github.com/Dilettante258/tieba-toolbox> |
| effect | 3.19.18 | MIT | <https://github.com/Effect-TS/effect> |
| @bufbuild/protobuf | 2.11.0 | Apache-2.0 AND BSD-3-Clause | <https://github.com/bufbuild/protobuf-es> |
| long | 5.3.2 | Apache-2.0 | <https://github.com/dcodeIO/long.js> |

## tieba.js SDK 的许可未声明

上游 eztb 仓库与它的 `packages/sdk` **都没有 LICENSE 文件，也没有 `license` 字段**，授权状态不明确：

- 自己本地用没有问题；
- 公开分发（推 GitHub 公开仓库、上传脚本站等）属于再分发，严格来说需要先得到上游作者授权；
- 本工程的 `LICENSE`（MIT）只覆盖本工程自己的代码，**不能**用来给内嵌的 SDK 授权。

想彻底避开这个问题只有两条路：拿到上游授权，或者改成 `@require` 远程加载上游发布的 SDK 包——
但 SDK 有 4 个 Node 依赖需要在构建时替换成浏览器实现，直接 `@require` 原版跑不起来（见 README）。
