# 第三方代码说明

`dist/tieba-eztb-toolbox.user.js` 是**单文件产物**，里面打包了以下第三方代码。
构建脚本会把这份清单写进产物末尾的 `NOTICE`（见 `build.mjs` 的 `NOTICE` 常量）。

| 组件 | 版本 | 许可 | 来源 |
| --- | --- | --- | --- |
| tieba.js SDK（上游 eztb 的 `packages/sdk`） | v3 分支 | **未声明** | <https://github.com/Dilettante258/tieba-toolbox> |
| effect | 3.19.18 | MIT | <https://github.com/Effect-TS/effect> |
| @bufbuild/protobuf | 2.11.0 | Apache-2.0 AND BSD-3-Clause | <https://github.com/bufbuild/protobuf-es> |
| long | 5.3.2 | Apache-2.0 | <https://github.com/dcodeIO/long.js> |

## 需要特别注意的一条

上游 eztb 仓库与它的 `packages/sdk` **都没有 LICENSE 文件，也没有声明
`license` 字段**。也就是说这段 SDK 代码的授权状态不明确。

这意味着：

- 本地自己用没有问题；
- 但**公开分发**（发到 GitHub 公开仓库、上传到 Greasy Fork 等脚本站）属于再分发，
  严格来说需要先拿到上游作者的授权。已有用户这么做过（eztb 本身也是公开项目），
  但这是你的选择，风险请自行判断；
- 本工程的 `LICENSE`（MIT）只覆盖本工程自己的代码，**不能**用来给内嵌的 SDK 授权。

想彻底避开这个问题，只有两条路：拿到上游授权，或者改成 `@require` 远程加载上游发布的
SDK 包（但目前 SDK 里有 4 个 Node 依赖需要在构建时替换成浏览器实现，
直接 `@require` 原版跑不起来，详见 README 的「发布到 Greasy Fork」一节）。
