/**
 * pinned-question
 *
 * 마지막 사용자 질문을 입력창 위에 최대 3줄로 고정 표시한다.
 * fullscreen 모드에서는 대화가 스크롤되면 보낸 질문이 화면 밖으로 올라가므로,
 * 에디터 바로 위 위젯에 마지막 질문을 다시 보여준다.
 *
 * - before_agent_start: 새 질문이 오면 위젯을 교체
 * - input(source === "extension"): 내부/알림 메시지는 다음 갱신을 건너뜀
 * - session_start(new): 위젯 초기화 / (resume/fork): 분기에서 마지막 질문 복원
 * - session_tree: 이동한 분기의 마지막 질문으로 갱신
 *
 * 커맨드(/...)·셸 실행(!...)은 질문으로 취급하지 않는다.
 * 렌더는 공개 API(ctx.ui.setWidget)만 사용하고, 폭 계산은 pi-tui 유틸을 쓴다.
 * 너비보다 긴 줄을 그대로 넘기면 pi-tui가 죽으므로 반드시 자르거나 접는다.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const WIDGET_KEY = "pinned-question";
const MAX_LINES = 3;
const ELLIPSIS = "…";

let pinned: string | undefined;
let skipNextPrompt = false;

type BranchEntry = {
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

/** 공백을 접고, 비어 있거나 커맨드/셸 실행이면 버린다. */
function cleanPrompt(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const text = raw.replace(/\s+/g, " ").trim();
	if (!text) return undefined;
	if (text.startsWith("/") || text.startsWith("!")) return undefined;
	return text;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" &&
				block !== null &&
				(block as { type?: unknown }).type === "text",
		)
		.map((block) => block.text)
		.join(" ");
}

/** 분기에서 가장 마지막 실제 사용자 질문을 찾는다. */
function lastUserQuestion(entries: unknown): string | undefined {
	if (!Array.isArray(entries)) return undefined;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as BranchEntry;
		if (!entry || entry.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const cleaned = cleanPrompt(extractText(entry.message.content));
		if (cleaned) return cleaned;
	}
	return undefined;
}

/** 초과분을 마지막 줄에 … 표시로 접는다. 결과 줄은 항상 width 이하이다. */
function fitLines(text: string, width: number): string[] {
	const safe = Math.max(2, Math.floor(width) || 0);
	const lines = wrapTextWithAnsi(text, safe);
	if (lines.length <= MAX_LINES) return lines;
	const shown = lines.slice(0, MAX_LINES);
	shown[MAX_LINES - 1] = `${truncateToWidth(shown[MAX_LINES - 1], safe - 1, "", false)}${ELLIPSIS}`;
	return shown;
}

function renderWidget(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (!pinned) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	const text = pinned;
	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				return fitLines(text, width).map((line) => theme.fg("dim", line));
			},
		}),
		{ placement: "aboveEditor" },
	);
}

export default function pinnedQuestion(pi: ExtensionAPI) {
	// 입력 출처를 기록한다. extension이 넣은 메시지는 질문으로 취급하지 않는다.
	// 매 입력마다 덮어쓰므로, 실행되지 않은 입력이 다음 질문을 오염시키지 않는다.
	pi.on("input", async (event, _ctx) => {
		skipNextPrompt = event.source === "extension";
	});

	// 새 질문 → 위젯 교체
	pi.on("before_agent_start", async (event, ctx) => {
		if (skipNextPrompt) {
			skipNextPrompt = false;
			return;
		}
		const text = cleanPrompt(event.prompt);
		if (!text || text === pinned) return;
		pinned = text;
		renderWidget(ctx);
	});

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "new") {
			pinned = undefined;
			skipNextPrompt = false;
			if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		if (!ctx.hasUI) return;
		if (event.reason === "resume" || event.reason === "fork" || !pinned) {
			const restored = lastUserQuestion(ctx.sessionManager.getBranch());
			if (restored !== pinned) {
				pinned = restored;
				renderWidget(ctx);
			} else if (restored) {
				renderWidget(ctx);
			}
		}
	});

	// 트리 이동 → 이동한 분기의 마지막 질문으로 갱신
	pi.on("session_tree", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const restored = lastUserQuestion(ctx.sessionManager.getBranch());
		if (restored !== pinned) {
			pinned = restored;
			renderWidget(ctx);
		}
	});
}
