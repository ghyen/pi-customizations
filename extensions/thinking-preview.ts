/**
 * thinking-preview
 *
 * 숨겨진 thinking 블록("Thinking...")을 그 블록의 실제 첫 줄 미리보기로 바꾼다.
 * 접힘 상태에서만 동작하고, 클릭(fullscreen, 블록별)이나 ctrl+t(전체)로 펼치면
 * 원래대로 전체 추론이 나온다.
 *
 * 왜 런타임 패치인가:
 * - pi는 공개 API로 어시스턴트 메시지 렌더러를 노출하지 않는다.
 *   `ctx.ui.setHiddenThinkingLabel(label)`은 전역 단일 문자열이라 블록별 내용을
 *   넣을 수 없고, `registerMessageRenderer`는 custom message 전용이다.
 * - 실제 실행 코드는 minified 번들(`dist/bundle/chunks/chunk-*.js`)이라 파일을
 *   직접 고치면 `pi update`마다 날아간다.
 * 그래서 살아 있는 컴포넌트 인스턴스를 찾아 그 인스턴스의 updateContent만 감싼다.
 *
 * 트리 접근 경로:
 * `ctx.ui.setWidget(key, factory)`의 factory는 (tui, theme)를 동기로 넘겨준다.
 * tui는 `createInteractiveTuiReference` 프록시라 모드를 바꿔도 현재 renderer를
 * 가리킨다. 캡처 직후 같은 key를 undefined로 지워 화면에는 흔적을 남기지 않는다.
 *
 * 폭 계산:
 * 여기서는 미리보기 문자열을 어디서 자를지 정하는 데만 쓴다. 실제 줄 폭은
 * pi-tui의 Text가 wrapTextWithAnsi로 처리하므로 과대 측정은 안전하다
 * (과소 측정이 위험한 지점은 컴포넌트가 폭을 직접 맞추는 경우다).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** 위젯 캡처용 key. 화면에 남지 않도록 즉시 제거한다. */
const CAPTURE_WIDGET_KEY = "thinking-preview:capture";
/** 미리보기 앞에 붙이는 표식. */
const PREVIEW_PREFIX = "\u{1F4AD} ";
/** 미리보기 한 줄의 최대 셀 수. */
const MAX_PREVIEW_CELLS = 104;
/** 스트리밍 중 재탐색 최소 간격. */
const RESCAN_THROTTLE_MS = 120;
/** 트리 탐색 상한(무한 루프 방지). */
const MAX_VISITED_NODES = 4000;

type AnyRecord = Record<string, any>;

let capturedTui: AnyRecord | undefined;
let capturedTheme: AnyRecord | undefined;

const patchedComponents = new WeakSet<object>();

// ---------------------------------------------------------------- 폭 계산

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ZERO_WIDTH_GRAPHEME = /^[\u200B-\u200F\u2060\uFEFF]$/;
const COMBINING_GRAPHEME = /^[\u0300-\u036F\u1AB0-\u1AFF\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F]$/;

function graphemeCells(grapheme: string): number {
	if (grapheme === "\t") return 3;
	if (/^[\x20-\x7E]$/.test(grapheme)) return 1;
	// 말줄임표는 터미널에서 1칸이 표준이다. 2칸으로 세면 예산 계산이 어긋난다.
	if (grapheme === "\u2026") return 1;
	if (ZERO_WIDTH_GRAPHEME.test(grapheme) || COMBINING_GRAPHEME.test(grapheme)) return 0;
	// ASCII 밖은 전부 2칸으로 본다. 한글·CJK·전각은 정확하고, 나머지는 과대 측정이다.
	return 2;
}

export function textCells(text: string): number {
	let cells = 0;
	for (const { segment } of graphemeSegmenter.segment(text)) cells += graphemeCells(segment);
	return cells;
}

export function truncateToCells(text: string, maxCells: number): string {
	if (maxCells <= 0) return "";
	if (textCells(text) <= maxCells) return text;
	let out = "";
	let cells = 0;
	// 말줄임표 1칸을 남긴다.
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const width = graphemeCells(segment);
		if (cells + width > maxCells - 1) break;
		out += segment;
		cells += width;
	}
	return `${out.trimEnd()}\u2026`;
}

// ------------------------------------------------------- 순수 추출/포맷 로직

/**
 * 메시지에서 thinking 실행(run)들을 뽑는다.
 * assistant-message.js가 연속된 thinking 블록을 "\n\n"로 합쳐 하나의 블록으로
 * 그리므로, 같은 방식으로 묶어야 컴포넌트 순서와 1:1로 맞는다.
 */
export function extractThinkingRuns(message: AnyRecord | undefined): string[] {
	const content = Array.isArray(message?.content) ? (message as AnyRecord).content : [];
	const runs: string[] = [];
	for (let i = 0; i < content.length; i++) {
		if (content[i]?.type !== "thinking") continue;
		const blocks: string[] = [];
		for (; i < content.length; i++) {
			const block = content[i];
			if (block?.type !== "thinking") break;
			const text = typeof block.thinking === "string" ? block.thinking.trim() : "";
			if (text) blocks.push(text);
		}
		i--;
		if (blocks.length > 0) runs.push(blocks.join("\n\n"));
	}
	return runs;
}

/** 첫 비어있지 않은 줄에서 마크다운 구조 기호만 걷어낸다. */
export function previewBody(run: string): string {
	for (const rawLine of run.split("\n")) {
		let line = rawLine.trim();
		if (!line) continue;
		line = line.replace(/^(?:[-*+\u2022]\s+|\d+[.)]\s+|#{1,6}\s+|>\s+)+/, "");
		line = line.replace(/\s+/g, " ").trim();
		if (line) return line;
	}
	return "";
}

export function buildPreview(run: string, maxCells = MAX_PREVIEW_CELLS): string {
	const body = previewBody(run);
	if (!body) return PREVIEW_PREFIX.trimEnd();
	const budget = Math.max(16, maxCells - textCells(PREVIEW_PREFIX));
	return PREVIEW_PREFIX + truncateToCells(body, budget);
}

// ------------------------------------------------------------ 컴포넌트 탐색

function isAssistantMessageComponent(node: unknown): node is AnyRecord {
	const candidate = node as AnyRecord;
	return (
		!!candidate &&
		typeof candidate === "object" &&
		typeof candidate.updateContent === "function" &&
		"thinkingVisibilityOverrides" in candidate &&
		"contentContainer" in candidate &&
		"hideThinkingBlock" in candidate
	);
}

function isMouseRegionLike(node: unknown): node is AnyRecord {
	const candidate = node as AnyRecord;
	return !!candidate && typeof candidate === "object" && "child" in candidate && typeof candidate.handleMouse === "function";
}

/** 접힘 상태에서 thinking 블록 자리에 들어가는 한 줄 Text인지 판별한다. */
function isHiddenThinkingLine(node: unknown): node is AnyRecord {
	const candidate = node as AnyRecord;
	if (!candidate || typeof candidate !== "object") return false;
	if (typeof candidate.setText !== "function" || typeof candidate.text !== "string") return false;
	// 펼쳐진 블록은 Markdown 컴포넌트다. 필드로 구분한다(모듈 사본이 달라도 동작).
	return !("options" in candidate) && !("defaultTextStyle" in candidate);
}

/** 살아 있는 컴포넌트 트리에서 어시스턴트 메시지 컴포넌트를 모은다. */
export function collectAssistantComponents(root: unknown): AnyRecord[] {
	const found: AnyRecord[] = [];
	const seen = new Set<unknown>();
	const stack: unknown[] = [root];
	let visited = 0;
	while (stack.length > 0 && visited < MAX_VISITED_NODES) {
		const node = stack.pop();
		if (!node || typeof node !== "object" || seen.has(node)) continue;
		seen.add(node);
		visited++;
		if (isAssistantMessageComponent(node)) {
			found.push(node);
			continue;
		}
		const layoutRoot = (node as AnyRecord).layoutRoot;
		if (layoutRoot && typeof layoutRoot === "object") stack.push(layoutRoot);
		const children = (node as AnyRecord).children;
		if (Array.isArray(children)) {
			for (const child of children) stack.push(child);
		}
	}
	return found;
}

/**
 * 접힌 thinking 블록들의 표시 문자열을 미리보기로 바꾼다.
 * MouseRegion 자식은 thinking run과 순서대로 1:1 대응한다(코어가 run마다 하나씩 감싼다).
 */
export function applyPreviews(component: AnyRecord, message: AnyRecord | undefined, theme: AnyRecord | undefined): number {
	if (!theme || typeof theme.fg !== "function") return 0;
	const children = component?.contentContainer?.children;
	if (!Array.isArray(children)) return 0;
	const runs = extractThinkingRuns(message);
	if (runs.length === 0) return 0;
	let runIndex = 0;
	let applied = 0;
	for (const child of children) {
		if (!isMouseRegionLike(child)) continue;
		const run = runs[runIndex++];
		if (run === undefined) break;
		const inner = child.child;
		if (!isHiddenThinkingLine(inner)) continue;
		const styled = theme.italic(theme.fg("thinkingText", buildPreview(run)));
		if (inner.text !== styled) inner.setText(styled);
		applied++;
	}
	return applied;
}

// --------------------------------------------------------------- 런타임 패치

function patchComponent(component: AnyRecord): void {
	if (patchedComponents.has(component)) return;
	patchedComponents.add(component);
	const original = component.updateContent;
	if (typeof original !== "function") return;
	component.updateContent = function patchedUpdateContent(this: AnyRecord, message?: AnyRecord, isStreaming?: boolean) {
		const result = original.call(this, message, isStreaming);
		try {
			applyPreviews(this, message, capturedTheme);
		} catch {
			// 미리보기 실패가 본 렌더를 깨면 안 된다.
		}
		return result;
	};
	try {
		// 이미 그려진 내용에도 적용한다. invalidate()가 updateContent를 다시 부른다.
		component.invalidate?.();
	} catch {
		// 무시: 다음 갱신에서 적용된다.
	}
}

/**
 * 위젯 factory로 현재 TUI와 theme를 동기 캡처한 뒤 위젯을 즉시 제거한다.
 * tui는 프록시라 모드 전환 후에도 현재 renderer를 가리킨다.
 */
function captureTuiAndTheme(ctx: ExtensionContext | AnyRecord | undefined): boolean {
	const ui = (ctx as AnyRecord | undefined)?.ui;
	if (!ui || typeof ui.setWidget !== "function") return false;
	try {
		ui.setWidget(CAPTURE_WIDGET_KEY, (tui: AnyRecord, theme: AnyRecord) => {
			capturedTui = tui;
			capturedTheme = theme;
			return { render: () => [], invalidate() {} };
		});
		ui.setWidget(CAPTURE_WIDGET_KEY, undefined);
		return true;
	} catch {
		return false;
	}
}

function scan(ctx: ExtensionContext | AnyRecord | undefined): number {
	if (!captureTuiAndTheme(ctx)) return 0;
	const components = collectAssistantComponents(capturedTui);
	for (const component of components) patchComponent(component);
	return components.length;
}

// ------------------------------------------------------------------- 확장 등록

export default function thinkingPreview(pi: ExtensionAPI) {
	let ctxRef: ExtensionContext | AnyRecord | undefined;
	let lastScanAt = 0;

	const scanNow = () => {
		lastScanAt = Date.now();
		scan(ctxRef);
	};
	// 코어가 컴포넌트를 만든 직후에 돌아야 하므로 한 틱 미룬다.
	const scanSoon = () => {
		setTimeout(scanNow, 0);
		setTimeout(scanNow, 60);
	};
	const scanThrottled = () => {
		if (Date.now() - lastScanAt < RESCAN_THROTTLE_MS) return;
		scanNow();
	};

	pi.on("session_start", async (_event, ctx) => {
		ctxRef = ctx;
		scanSoon();
	});
	pi.on("message_start", async (_event, ctx) => {
		ctxRef = ctx;
		scanSoon();
	});
	pi.on("message_update", async (_event, ctx) => {
		ctxRef = ctx;
		scanThrottled();
	});
	pi.on("message_end", async () => {
		scanSoon();
	});
	pi.on("turn_end", async () => {
		scanSoon();
	});
	pi.on("session_shutdown", async () => {
		ctxRef = undefined;
	});
}
