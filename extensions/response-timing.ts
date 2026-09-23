import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "response-timing";

function formatElapsed(milliseconds: number): string {
	const tenths = Math.floor(milliseconds / 100);
	const totalSeconds = Math.floor(tenths / 10);
	const fractional = tenths % 10;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}.${fractional}초`;
	if (minutes > 0) return `${minutes}분 ${seconds}.${fractional}초`;
	return `${seconds}.${fractional}초`;
}

function formatTimestamp(timestamp: number): string {
	return new Intl.DateTimeFormat("ko-KR", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).format(new Date(timestamp));
}

export default function (pi: ExtensionAPI) {
	let requestStartedAt: number | undefined;
	let outputTokens = 0;

	pi.on("session_start", (_event, ctx) => {
		requestStartedAt = undefined;
		outputTokens = 0;
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		requestStartedAt = performance.now();
		outputTokens = 0;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	});

	pi.on("message_end", (event, ctx) => {
		if (ctx.mode !== "tui" || requestStartedAt === undefined) return;
		if (event.message.role !== "assistant") return;

		const count = event.message.usage.output;
		if (Number.isFinite(count) && count > 0) outputTokens += count;
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui" || requestStartedAt === undefined) return;

		const answeredAt = Date.now();
		const elapsedMs = performance.now() - requestStartedAt;
		const elapsed = formatElapsed(elapsedMs);
		const tps = elapsedMs > 0 ? (outputTokens / (elapsedMs / 1000)).toFixed(1) : "—";
		const formattedTokens = new Intl.NumberFormat("ko-KR").format(outputTokens);
		requestStartedAt = undefined;
		outputTokens = 0;

		const line = `총 소요 ${elapsed} · 출력 ${formattedTokens} tokens · E2E TPS ${tps} tok/s · 답변 시각 ${formatTimestamp(answeredAt)}`;
		ctx.ui.setWidget(WIDGET_KEY, [ctx.ui.theme.fg("dim", line)]);
	});
}
