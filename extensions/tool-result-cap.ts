/**
 * Tool Result Cap
 *
 * 출력이 큰 확장 도구의 결과 텍스트에 상한을 둔다.
 * - 대상: evaluate_browser, fetch_content, web_search (allowlist)
 * - 텍스트 합이 CAP_CHARS(12,000자)를 넘으면 앞에서 자르고 잘림 표시를 붙인다.
 * - 잘린 결과는 화면 표시와 모델 입력에 같이 반영된다 (tool_result 미들웨어).
 * - 이미지 블록과 details, isError, usage는 손대지 않는다.
 * - *_ui 도구, read_text, MCP 도구는 제외한다. UI 스냅샷·ref가 잘리면
 *   후속 조회와 resume 복원이 깨질 수 있어서 allowlist 방식만 쓴다.
 * - /result-cap on|off|status 로 켜고 끌 수 있다 (기본 on, 메모리에만 유지).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CAP_CHARS = 12_000;

/** 상한을 적용할 도구. 여기에 없는 도구는 그대로 둔다. */
const CAPPED_TOOLS = new Set(["evaluate_browser", "fetch_content", "web_search"]);

let enabled = true;

type TextBlock = { type: "text"; text?: string } & Record<string, unknown>;
type AnyBlock = { type: string } & Record<string, unknown>;

function totalTextLength(content: AnyBlock[]): number {
	let total = 0;
	for (const block of content) {
		if (block.type === "text" && typeof (block as TextBlock).text === "string") {
			total += ((block as TextBlock).text as string).length;
		}
	}
	return total;
}

function capContent(content: AnyBlock[]): AnyBlock[] {
	const total = totalTextLength(content);
	if (total <= CAP_CHARS) return content;

	const marker =
		`\n\n[result capped: showing first ${CAP_CHARS.toLocaleString("en-US")} of ` +
		`${total.toLocaleString("en-US")} chars. ` +
		`Narrow the query (bounded slice, aggregate, or smaller range) to see more. ` +
		`The remainder is discarded, not stored.]`;

	let budget = CAP_CHARS;
	let truncated = false;
	const out: AnyBlock[] = [];
	for (const block of content) {
		if (block.type !== "text" || typeof (block as TextBlock).text !== "string") {
			out.push(block);
			continue;
		}
		if (truncated) continue;
		const text = (block as TextBlock).text as string;
		if (text.length <= budget) {
			budget -= text.length;
			out.push(block);
			continue;
		}
		out.push({ ...block, text: text.slice(0, budget) + marker });
		truncated = true;
	}
	// 텍스트가 비어 있는 등 잘림 표시를 못 붙인 경우 마지막에 추가한다.
	if (!truncated) {
		out.push({ type: "text", text: marker });
	}
	return out;
}

export default function toolResultCap(pi: ExtensionAPI) {
	pi.on("tool_result", async (event) => {
		if (!enabled) return;
		if (!CAPPED_TOOLS.has(event.toolName)) return;
		if (!Array.isArray(event.content)) return;
		if (totalTextLength(event.content as AnyBlock[]) <= CAP_CHARS) return;
		return { content: capContent(event.content as AnyBlock[]) };
	});

	pi.registerCommand("result-cap", {
		description: "Cap long tool result text on/off (evaluate_browser, fetch_content, web_search)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				enabled = true;
				ctx.ui.notify(`result-cap: on (cap ${CAP_CHARS.toLocaleString("en-US")} chars)`, "info");
			} else if (arg === "off") {
				enabled = false;
				ctx.ui.notify("result-cap: off", "info");
			} else {
				ctx.ui.notify(
					`result-cap: ${enabled ? "on" : "off"} (cap ${CAP_CHARS.toLocaleString("en-US")} chars, tools: ${[...CAPPED_TOOLS].join(", ")})`,
					"info",
				);
			}
		},
	});
}
