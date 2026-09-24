/**
 * 用户身份解析：把页面上抓到的 UserRef（可能只有头像串或用户名）变成
 * 带贴吧内部 ID 的 Identity，并顺带把资料写进缓存。
 *
 * 从 features/userPanel.ts 抽出来，因为后台成分检测也要用它——
 * 两条路径共用同一份"怎么把一个人认出来"的逻辑。
 */

import { Effect } from "effect";
import { getProfile, getUserInfo } from "tieba.js";
import {
	type CachedProfile,
	profileCacheKey,
	readProfileCache,
	writeProfileCache,
} from "./cached.ts";
import { requestQueue } from "./queue.ts";
import { ensureClient } from "./sdk.ts";
import { stripPortraitQuery, toNumber } from "./util.ts";
import type { UserRef } from "../page/adapters.ts";

function hasEffect(value: unknown): value is Effect.Effect<unknown, any> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { pipe?: unknown }).pipe === "function"
	);
}

/** 调用 SDK 并兼容"直接返回 Effect"与"返回 Effect.gen"两种写法。 */
export function callSdkLoose<T>(
	factory: () => T | Effect.Effect<T, any>,
): Promise<T> {
	ensureClient();
	return requestQueue.run(() => {
		const produced = factory();
		return hasEffect(produced)
			? (Effect.runPromise(produced) as Promise<T>)
			: Promise.resolve(produced as T);
	});
}

export interface Identity {
	id: number;
	uid?: string;
	un?: string;
	nickname?: string;
	portrait?: string;
	profile?: CachedProfile;
}

function snapshotProfile(user: any, ref: UserRef): CachedProfile {
	return {
		id: Number(user?.id ?? 0) || undefined,
		uid: user?.tiebaUid ? String(user.tiebaUid) : undefined,
		un: user?.name || undefined,
		nickname: user?.nameShow || ref.nickname || undefined,
		portrait: user?.portrait
			? stripPortraitQuery(user.portrait)
			: ref.portrait
				? stripPortraitQuery(ref.portrait)
				: undefined,
		level: toNumber(user?.levelId) || undefined,
		tbAge: user?.tbAge || undefined,
		postNum: toNumber(user?.postNum) || undefined,
		fansNum: toNumber(user?.fansNum) || undefined,
		concernNum: toNumber(user?.concernNum) || undefined,
		likeNum: toNumber(user?.myLikeNum) || undefined,
		intro: user?.intro || undefined,
		ip: user?.ipAddress || undefined,
		// profile 本身就带着关注贴吧名单：隐藏关注贴吧的用户只能从这里和 panel 恢复，
		// 顺手记进缓存，成分检测就不用再多发一次请求
		likeForum: (user?.likeForum ?? [])
			.map((forum: any) => forum?.forumName)
			.filter(Boolean),
		gender: toNumber(user?.sex) || toNumber(user?.gender) || undefined,
		isBawu: toNumber(user?.isBawu) === 1,
		bawuType: user?.bawuType || undefined,
		vipLevel: toNumber(user?.vipInfo?.vLevel) || undefined,
	};
}

export async function resolveIdentity(
	ref: UserRef,
	force = false,
): Promise<Identity> {
	const key = profileCacheKey(ref);
	// force 用于「刷新」：跳过缓存直读，重新拉一次并写回
	const cached = force ? null : readProfileCache(key);
	if (cached?.id) {
		return {
			id: cached.id,
			uid: cached.uid,
			un: cached.un,
			nickname: cached.nickname,
			portrait: cached.portrait,
			profile: cached,
		};
	}

	let raw: any = null;
	if (ref.userId) {
		raw = await callSdkLoose(() => getProfile(Number(ref.userId)));
	} else if (ref.portrait) {
		raw = await callSdkLoose(() => getProfile(stripPortraitQuery(ref.portrait!)));
	} else if (ref.un) {
		const info: any = await callSdkLoose(() => getUserInfo(ref.un!));
		if (info?.id) {
			raw = await callSdkLoose(() => getProfile(Number(info.id)));
		}
	}

	const user = raw?.user;
	if (!user?.id) {
		throw new Error("无法识别该用户（缺少贴吧号 / 用户 ID / 用户名）");
	}

	const profile = snapshotProfile(user, ref);
	writeProfileCache(key, profile);
	return {
		id: Number(user.id),
		uid: profile.uid,
		un: profile.un,
		nickname: profile.nickname,
		portrait: profile.portrait,
		profile,
	};
}
