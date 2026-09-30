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

// 「校验 BDUSS」要用到的鉴权接口：无效凭据下它们会回 errno，正好当面量清楚
export { getFans, getFollow, getUserInfo } from "tieba.js";

// 仅供 scripts/live-test.mjs 的探查：直接引用 SDK 生成的编解码器
export { UserPostReqIdl } from "eztb-internal/userpost-req";
export { UserPostResIdl } from "eztb-internal/userpost-res";

// 本工程自己的取数模块，用于在 Node 里复现问题
export {
	clearForumNameCache,
	loadPostPage,
	loadReplyPage,
	loadReplyRows,
	loadTopicPage,
	loadTopicRows,
} from "../core/userPost.ts";
// 「这条回复在第几楼」（点了才查）与它的缓存
export { fetchReplyFloor, readReplyFloorCache } from "../core/replyFloor.ts";
// 「他最近在哪些吧发过言」（签到号判定用的样本）
export { loadForumActivity } from "../core/forumActivity.ts";
// 关注的吧（含"隐藏关注贴吧"的回退），成分检测与面板共用这一份
export { loadUserForums } from "../core/userForums.ts";
// 探查脚本要单独调这两个接口做对照
export { getHiddenLikeForum, getLikeForum } from "tieba.js";
// 探查脚本要看清楼层里作者带的字段（比如"吧内等级"）
export { getPosts } from "tieba.js";
// 「回复/楼中楼 的楼层号」来源：/c/f/pb/floor 的 data.post.floor
export { getComments } from "tieba.js";
// 「点了才查」的吧内等级（从他在该吧的帖子里读）
export { fetchUserForumLevel } from "../core/forumLevel.ts";
// 关键词匹配是纯逻辑，这里导出让 live-test 用真实数据跑一遍
export { matchComposition, parseRules } from "../core/composition.ts";
