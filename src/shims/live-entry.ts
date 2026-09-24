/**
 * 仅供 scripts/live-test.mjs 使用的入口：
 * 把 SDK 里需要匿名验证的 proto 接口转出去。
 */
export {
	TiebaClient,
	initClient,
	getClient,
	getThreads,
	getProfile,
	getUserByUid,
	getUserPost,
	getRawUserPost,
	processUserPosts,
	getPanel,
} from "tieba.js";

// 仅供 scripts/live-test.mjs 的探查：直接引用 SDK 生成的编解码器
export { UserPostReqIdl } from "eztb-internal/userpost-req";
export { UserPostResIdl } from "eztb-internal/userpost-res";

// 本工程自己的取数模块，用于在 Node 里复现问题
export { loadPostPage, loadReplyRows, loadTopicRows } from "../core/userPost.ts";
// 关注的吧（含"隐藏关注贴吧"的回退），成分检测与面板共用这一份
export { loadUserForums } from "../core/userForums.ts";
// 关键词匹配是纯逻辑，这里导出让 live-test 用真实数据跑一遍
export { matchComposition, parseRules } from "../core/composition.ts";
