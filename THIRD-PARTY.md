# 第三方代码说明

`dist/tieba-eztb-toolbox.user.js` 是单文件产物，内嵌了下面这些第三方代码。
这份清单**不是手写的**：构建时由 `scripts/deps-info.mjs` 从磁盘上真实的
`package.json` 与 `git rev-parse HEAD` 读出，写进产物末尾的 NOTICE，
并由 `verify.mjs` 逐条核对。清单失真的话构建/校验会直接失败。

| 组件 | 版本 | 许可 | 来源 |
| --- | --- | --- | --- |
| tieba.js（上游的 `packages/sdk` 子模块） | 3.1.3 | **ISC** | <https://github.com/Dilettante258/tieba.js> |
| effect | 3.19.18 | MIT | <https://github.com/Effect-TS/effect> |
| @bufbuild/protobuf | 2.11.0 | Apache-2.0 AND BSD-3-Clause | <https://github.com/bufbuild/protobuf-es> |
| long | 5.3.2 | Apache-2.0 | <https://github.com/dcodeIO/long.js> |

SDK 锁定在提交 `338a81eacf4eb326fcb3ffbfa55d46395117a2e9`（branch `v3`），
记在仓库根目录的 `sdk.lock.json` 里。同一个文件还锁了**构建它的那份上游检出**：

```json
"eztb": { "repository": "https://github.com/Dilettante258/eazy-tieba",
          "branch": "v3", "commit": "c772db6…" }
```

这条是必要的：上游 `v3` 分支还在动，它的 `packages/sdk` 指针也跟着动（2026-09-28
实测尖端已经指向别的 SDK 提交），只锁 SDK 的提交号不足以保证 CI 复现出仓库里提交的
那份产物。上游更新后这两个提交号都会对不上，构建会停下来提醒确认；CI 也是按
`eztb.commit` 检出上游，而不是 clone `v3` 的尖端。

## 更正：tieba.js 的许可是 ISC

这份文档以前写的是「上游 eztb 仓库与 `packages/sdk` 都没有 LICENSE 文件，
也没有 `license` 字段，授权状态不明确」。**那是错的**，2026-09-28 核对后更正：

- `packages/sdk` 是 **git submodule**，指向 <https://github.com/Dilettante258/tieba.js>
  （`.gitmodules` 里写着 `branch = v3`），不是上游主仓库里的普通目录；
- 它的 `package.json` 里明确写着 `"name": "tieba.js"`、`"version": "3.1.3"`、
  `"license": "ISC"`、`"author": "Dilettante258"`。

顺带修掉的还有两处过期信息：产物 NOTICE 里 SDK 的来源以前写的是
`github.com/Dilettante258/tieba-toolbox`（该仓库已改名为 `eazy-tieba`），
而 `verify.mjs` 断言的正是这个旧 URL——等于把错误事实钉成了断言。

## 还差一件事：ISC 要求附带许可文本

ISC 的条款是「上述版权声明与本许可声明应包含在所有副本中」。上游 `tieba.js` 仓库
**没有 `LICENSE` 文件**，所以本工程在产物末尾的 NOTICE 里按 ISC 模板补了一份，
版权人取自它 `package.json` 的 `author` 字段，并注明这是按声明补的。

更稳妥的做法是向上游要一份正式 `LICENSE` 文件，这样"再分发要不要额外声明"就没有争议了。

## 其它

本工程的 `LICENSE`（MIT）只覆盖本工程自己的代码，不覆盖上面这些第三方组件。
