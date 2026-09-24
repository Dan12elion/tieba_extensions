/**
 * 串行限速队列。
 *
 * SDK 自身没有限速，而贴吧接口对短时间内的密集请求比较敏感。
 * 所有出站请求都经过这里：同一时刻只有一个请求在飞，
 * 且相邻两次请求至少间隔 minIntervalMs。
 */

export class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();
	private lastFinishedAt = 0;

	constructor(private minIntervalMs: number) {}

	setMinInterval(ms: number): void {
		this.minIntervalMs = ms;
	}

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(async () => {
			const wait = this.lastFinishedAt + this.minIntervalMs - Date.now();
			if (wait > 0) {
				await new Promise((resolve) => setTimeout(resolve, wait));
			}
			try {
				return await task();
			} finally {
				this.lastFinishedAt = Date.now();
			}
		});
		// 单个任务失败不应中断整条队列
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

export const requestQueue = new SerialQueue(400);
