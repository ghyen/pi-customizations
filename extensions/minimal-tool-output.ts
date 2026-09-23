/**
 * Minimal Tool Output
 *
 * 도구 실행을 한 줄로 압축한다.
 * - 호출 줄: 상태 글리프 + 이름 + 대표 인자 (⋯ 실행 중 / ✓ 성공 / ✗ 실패)
 * - 접힘 상태의 결과: 0줄. 위 한 줄이 그 도구의 유일한 흔적이다.
 * - 에러: 항상 전체 표시 (실패를 못 보면 위험)
 * - ctrl+o 로 펼치면 호출 줄 + 전체 출력 표시
 *
 * renderShell:"self" 로 기본 셸(Box + Spacer)을 끈다. 이 셸은 내용이 있으면
 * 빈 줄 1개 + 내용을 돌려주고, 내용이 0줄이면 행 자체를 지운다. 그래서 접힘
 * 상태의 결과를 빈 컴포넌트로 돌려주면 도구 행이 한 줄로 유지된다.
 *
 * 폭 처리: 컴포넌트가 width 보다 긴 줄을 돌려주면 pi-tui 가 죽는다. 접힘에서는
 * truncateToWidth 로 자르고, 펼침에서는 wrapTextWithAnsi 로 접어서 넘긴다.
 *
 * 내장 도구의 실행/스키마/시스템 프롬프트 메타데이터는 원본을 그대로 위임한다.
 */

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

const CREATORS = {
	read: createReadTool,
	bash: createBashTool,
	edit: createEditTool,
	write: createWriteTool,
	grep: createGrepTool,
	find: createFindTool,
	ls: createLsTool,
} as const;

type ToolName = keyof typeof CREATORS;

/**
 * 시스템 프롬프트의 "Available tools" 스니펫을 수집한다.
 * getSystemPromptOptions 는 선택적이라 없을 때는 프롬프트를 파싱한다.
 */
function collectSnippets(ctx: ExtensionContext): Record<string, string> {
	try {
		const fromOptions = ctx.getSystemPromptOptions?.()?.toolSnippets;
		if (fromOptions && Object.keys(fromOptions).length > 0) return { ...fromOptions };
	} catch {
		// 아래 파싱으로 폴백
	}

	const snippets: Record<string, string> = {};
	try {
		const prompt = ctx.getSystemPrompt();
		for (const line of prompt.split("\n")) {
			const match = /^-\s+([a-z][a-z0-9_]*):\s+(.+)$/.exec(line.trim());
			if (match) snippets[match[1]] = match[2].trim();
		}
	} catch {
		// 스니펫을 못 읽으면 도구는 그대로 동작한다.
	}
	return snippets;
}

/** 도구별 인스턴스를 cwd 단위로 캐시한다. */
const instances = new Map<string, Record<ToolName, unknown>>();

function getInstances(cwd: string): Record<ToolName, ReturnType<(typeof CREATORS)[ToolName]>> {
	let cached = instances.get(cwd);
	if (!cached) {
		cached = Object.fromEntries(
			Object.entries(CREATORS).map(([name, create]) => [name, create(cwd)]),
		) as Record<ToolName, ReturnType<(typeof CREATORS)[ToolName]>>;
		instances.set(cwd, cached);
	}
	return cached;
}

function shortenPath(value: string): string {
	const home = homedir();
	return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function clip(value: string, max: number): string {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

/**
 * 정확히 한 줄만 렌더하는 컴포넌트.
 * 폭보다 긴 줄을 그대로 돌려주면 pi-tui 가 "Rendered line exceeds terminal width" 로
 * 죽으므로, 접힘에서는 잘라서, 펼침에서는 접어서 넘긴다.
 */
class OneLine {
	private text = "";
	private wrap = false;

	set(text: string, wrap: boolean): void {
		this.text = text;
		this.wrap = wrap;
	}

	invalidate(): void {
		// 캐시를 두지 않으므로 할 일이 없다.
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		if (this.wrap) return wrapTextWithAnsi(this.text, safeWidth);
		return [truncateToWidth(this.text, safeWidth, "…")];
	}
}

/** 상태 글리프. 실행 중 / 성공 / 실패를 한 글자로 구분한다. */
function statusGlyph(status: string | undefined, theme: any): string {
	if (status === "ok") return theme.fg("success", "✓");
	if (status === "error") return theme.fg("error", "✗");
	return theme.fg("muted", "⋯");
}

/** 도구 호출 한 줄: 상태 + 이름 + 대표 인자 */
function formatCall(name: ToolName, args: Record<string, unknown> | undefined, status: string | undefined, theme: any): string {
	const glyph = statusGlyph(status, theme);
	const title = theme.fg("toolTitle", theme.bold(name));
	const target = theme.fg("accent", describeTarget(name, args));
	return `${glyph} ${title} ${target}`;
}

/**
 * 결과 슬롯에서 호출 줄의 상태를 갱신한다.
 * 호출 줄은 결과보다 먼저 그려지므로, 값이 실제로 바뀐 경우에만 다음 틱에 다시
 * 그리게 한다(그대로 두면 무한 재렌더가 된다).
 */
function markStatus(context: any, status: "ok" | "error"): void {
	const state = context?.state;
	if (!state) return;
	state.status = status;
	if (state.renderedStatus === status) return;
	setTimeout(() => {
		try {
			context.invalidate();
		} catch {
			// 다음 갱신에서 반영된다.
		}
	}, 0);
}

function describeTarget(name: ToolName, args: Record<string, unknown> | undefined): string {
	const a = (args ?? {}) as Record<string, string | number | boolean | undefined>;
	const path = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : undefined;
	// 접힘 줄은 렌더 시 폭에 맞춰 잘린다. 여기 값은 펼침(ctrl+o)에서 보이는 상한이다.
	const max = 200;

	switch (name) {
		case "bash":
			return clip(String(a.command ?? "..."), max);
		case "grep":
			return clip(`/${String(a.pattern ?? "")}/ ${path ? shortenPath(path) : "."}`, max);
		case "find":
			return clip(`${String(a.pattern ?? "")} ${path ? shortenPath(path) : "."}`, max);
		case "read":
			return clip(shortenPath(path ?? ""), max);
		case "ls":
			return clip(shortenPath(path ?? "."), max);
		case "write":
			return clip(shortenPath(path ?? ""), max);
		case "edit":
			return clip(shortenPath(path ?? ""), max);
		default:
			return clip(path ?? "", max);
	}
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n")
		.trim();
}

/**
 * 결과 렌더링.
 * 에러 = 전체 표시, 접힘 + 정상 = 0줄(호출 줄만 남음), 펼침 = 전체 출력.
 */
function formatResult(
	name: ToolName,
	result: { content: Array<{ type: string; text?: string }> },
	options: { expanded: boolean; isPartial: boolean },
	context: { isError: boolean; args?: Record<string, unknown> },
	theme: any,
): Container {
	const box = new Container();
	const text = textOf(result);

	if (context.isError) {
		markStatus(context, "error");
		const body = text || "(no error detail)";
		box.addChild(new Text(`\n${theme.fg("error", clip(body, 4000))}`, 0, 0));
		return box;
	}

	// 실행 중에는 호출 줄만 유지한다.
	if (options.isPartial) {
		return box;
	}

	markStatus(context, "ok");

	// 접힘 + 정상 = 0줄. 호출 줄(renderCall)이 이 도구의 유일한 흔적이다.
	if (!options.expanded) {
		return box;
	}

	// 펼침(ctrl+o) = 전체 출력. 접힘 상태를 되돌아볼 유일한 경로다.
	if (text) {
		box.addChild(new Text(`\n${theme.fg("toolOutput", text)}`, 0, 0));
	}
	return box;
}

export default function minimalToolOutput(pi: ExtensionAPI) {
	const register = (ctx: ExtensionContext) => {
		const metadata = new Map<string, ToolInfo>(pi.getAllTools().map((t) => [t.name, t]));
		const snippets = collectSnippets(ctx);
		const cwd = ctx.cwd;

		for (const name of Object.keys(CREATORS) as ToolName[]) {
			const info = metadata.get(name);
			const builtin = getInstances(cwd)[name] as {
				description: string;
				parameters: unknown;
				execute: (...args: any[]) => Promise<any>;
				prepareArguments?: unknown;
				constrainedSampling?: unknown;
				executionMode?: unknown;
			};
			if (!info || !builtin) continue;

			pi.registerTool({
				name,
				label: name,
				// 시스템 프롬프트의 도구 설명/가이드라인을 원본 그대로 유지한다.
				description: info.description,
				promptSnippet: snippets[name],
				promptGuidelines: info.promptGuidelines ? [...info.promptGuidelines] : undefined,
				parameters: info.parameters as any,
				// 입력 정규화와 샘플링 동작을 원본에 그대로 위임한다.
				prepareArguments: builtin.prepareArguments as any,
				constrainedSampling: builtin.constrainedSampling as any,
				executionMode: builtin.executionMode as any,
				// renderShell:"self" + 0줄 렌더 = ToolExecutionComponent.render() 가 [] 를 반환한다.
				// 기본 셸은 Spacer(1) 을 무조건 붙이므로 이 모드가 아니면 빈 줄이 남는다.
				renderShell: "self",

				async execute(toolCallId, params, signal, onUpdate, execCtx) {
					const target = getInstances(execCtx.cwd ?? cwd)[name] as typeof builtin;
					return target.execute(toolCallId, params, signal, onUpdate, execCtx);
				},

				// 호출 한 줄(상태 글리프 + 이름 + 대표 인자)만 그린다.
				// 상태는 결과가 도착하면 renderResult 가 state.status 를 바꾸고 재렌더를 요청한다.
				renderCall(args: any, theme: any, context: any) {
					const state = context?.state;
					const status = state?.status;
					if (state) state.renderedStatus = status ?? "running";
					const component = (context?.lastComponent as OneLine | undefined) ?? new OneLine();
					component.set(formatCall(name, args, status, theme), Boolean(context?.expanded));
					return component;
				},

				renderResult(result, options, theme: any, context: any) {
					return formatResult(name, result as any, options, context, theme);
				},
			});
		}
	};

	// registerTool 은 session_start 에서도 즉시 반영된다.
	// 이 시점에야 getAllTools() 와 시스템 프롬프트 스니펫을 안전하게 읽을 수 있다.
	pi.on("session_start", async (_event, ctx) => {
		register(ctx);
	});
}
