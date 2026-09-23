/**
 * session-last-title
 *
 * /resume 목록에 세션의 "첫 질문" 대신 "마지막 질문"이 보이게 한다.
 * pi는 이름이 없는 세션에 대해 첫 사용자 메시지를 표시하므로,
 * 매 프롬프트마다 세션 이름을 마지막 질문으로 갱신한다.
 *
 * - before_agent_start: 새 질문이 오면 세션 이름을 그 질문으로 갱신
 * - session_start(resume/fork): 이름이 없는 기존 세션은 마지막 질문으로 채움
 * - /last-title on|off|sync: 자동 갱신 켜기/끄기/지금 동기화
 *   (off는 이 프로세스에서만 유지, 재시작하면 다시 켜짐)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_NAME_LENGTH = 100;

let enabled = true;

type SessionEntries = Array<{
	type?: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}>;

function toTitle(text: string): string | undefined {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return undefined;
	// 커맨드(/...)·셸 실행(!...)은 제목에서 제외
	if (cleaned.startsWith("/") || cleaned.startsWith("!")) return undefined;
	if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
	return `${cleaned.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
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

function lastUserTitle(entries: SessionEntries): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;
		if (entry.message?.role !== "user") continue;
		const title = toTitle(extractText(entry.message.content));
		if (title) return title;
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	// 새 질문 → 세션 이름을 마지막 질문으로 갱신
	pi.on("before_agent_start", async (event, _ctx) => {
		if (!enabled) return;
		const title = toTitle(event.prompt ?? "");
		if (title) pi.setSessionName(title);
	});

	// resume/fork로 연 기존 세션에 이름이 없으면 마지막 질문으로 채움
	// (수동으로 지은 이름은 덮어쓰지 않음)
	pi.on("session_start", async (event, ctx) => {
		if (!enabled) return;
		if (event.reason !== "resume" && event.reason !== "fork") return;
		if (pi.getSessionName()) return;
		const title = lastUserTitle(
			ctx.sessionManager.getBranch() as unknown as SessionEntries,
		);
		if (title) pi.setSessionName(title);
	});

	pi.registerCommand("last-title", {
		description: "마지막 질문을 세션 이름으로 사용 (on/off/sync)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "off") {
				enabled = false;
				ctx.ui.notify(
					"last-title 꺼짐 (이 세션에서만 유지, /name 지정이 유지됨)",
					"info",
				);
				return;
			}
			if (arg === "on") {
				enabled = true;
				ctx.ui.notify("last-title 켜짐", "info");
				return;
			}
			if (arg === "sync" || arg === "") {
				const title = lastUserTitle(
					ctx.sessionManager.getBranch() as unknown as SessionEntries,
				);
				if (!title) {
					ctx.ui.notify("동기화할 사용자 질문이 없음", "warning");
					return;
				}
				pi.setSessionName(title);
				ctx.ui.notify(`세션 이름 동기화: ${title}`, "info");
				return;
			}
			ctx.ui.notify("사용법: /last-title [on|off|sync]", "warning");
		},
	});
}
