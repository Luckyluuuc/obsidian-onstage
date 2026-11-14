/*
 * Pure Markdown -> deck parser. No Obsidian imports, so it can be unit tested in Node.
 *
 * Line numbers are 0-based and always refer to the original note, so the
 * projection can follow the editor cursor.
 */

export type BlockKind = "list-item" | "heading" | "fence" | "math" | "quote" | "paragraph";

export interface Block {
	text: string;
	/** Original source lines (before %% comments were removed). */
	raw: string;
	start: number;
	end: number;
	kind: BlockKind;
}

export type SlideKind = "cover" | "section" | "content" | "agenda";

export interface Slide {
	kind: SlideKind;
	/** Markdown source of the title (inline), or null for untitled slides. */
	title: string | null;
	/** Source line of the title heading, or -1. */
	titleLine: number;
	/** Level of the title heading (1 for #), or 0 when the slide has no heading. */
	level: number;
	/** First and last source line covered by this slide (-1 for generated slides). */
	start: number;
	end: number;
	blocks: Block[];
}

export interface Deck {
	frontmatter: string | null;
	slides: Slide[];
}

export interface ParseOptions {
	/** 0 = split on thematic breaks only; 1..6 = every heading up to this level starts a slide. */
	splitLevel: number;
	cover: boolean;
	agenda: boolean;
	fallbackTitle: string;
	agendaTitle: string;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const BREAK_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_RE = /^ ?(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const INDENTED_RE = /^(?: {2,}|\t)/;

/** Replace %% comments with spaces (keeps line numbers and columns stable). */
function stripComments(lines: string[]): string[] {
	const out: string[] = [];
	let inComment = false;
	let fence: string | null = null;
	for (const line of lines) {
		if (!inComment) {
			const f = FENCE_RE.exec(line);
			if (fence) {
				if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
				out.push(line);
				continue;
			}
			if (f) {
				fence = f[1];
				out.push(line);
				continue;
			}
		}
		let result = "";
		let i = 0;
		while (i < line.length) {
			const idx = line.indexOf("%%", i);
			if (idx === -1) {
				result += inComment ? "" : line.slice(i);
				break;
			}
			if (!inComment) result += line.slice(i, idx);
			inComment = !inComment;
			i = idx + 2;
		}
		out.push(result.trim() === "" ? "" : result.trimEnd());
	}
	return out;
}

function extractFrontmatter(lines: string[]): { body: string[]; frontmatter: string | null } {
	if (lines.length === 0 || lines[0].trim() !== "---") return { body: lines, frontmatter: null };
	for (let i = 1; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t === "---" || t === "...") {
			const fm = lines.slice(1, i).join("\n");
			const body = lines.slice();
			for (let k = 0; k <= i; k++) body[k] = "";
			return { body, frontmatter: fm };
		}
	}
	return { body: lines, frontmatter: null };
}

/** Raw YAML of the note properties, or null. */
export function frontmatterText(source: string): string | null {
	return extractFrontmatter(source.replace(/\r\n?/g, "\n").split("\n")).frontmatter;
}

class BlockBuilder {
	blocks: Block[] = [];
	private cur: { lines: string[]; start: number; kind: BlockKind } | null = null;
	private pendingBlank = 0;

	get kind(): BlockKind | null {
		return this.cur ? this.cur.kind : null;
	}

	start(kind: BlockKind, line: string, n: number): void {
		this.close();
		this.cur = { lines: [line], start: n, kind };
	}

	append(line: string): void {
		if (!this.cur) return;
		for (let i = 0; i < this.pendingBlank; i++) this.cur.lines.push("");
		this.pendingBlank = 0;
		this.cur.lines.push(line);
	}

	blank(): void {
		if (!this.cur) return;
		if (this.cur.kind === "list-item") this.pendingBlank++;
		else this.close();
	}

	get hasPendingBlank(): boolean {
		return this.pendingBlank > 0;
	}

	close(): void {
		if (this.cur) {
			this.blocks.push({
				text: this.cur.lines.join("\n"),
				raw: "",
				start: this.cur.start,
				end: this.cur.start + this.cur.lines.length - 1,
				kind: this.cur.kind,
			});
		}
		this.cur = null;
		this.pendingBlank = 0;
	}
}

export function parseDeck(source: string, opts: ParseOptions): Deck {
	const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
	const { body, frontmatter } = extractFrontmatter(rawLines);
	const lines = stripComments(body);

	const slides: Slide[] = [];
	const level = opts.splitLevel;

	let slide: Slide = {
		kind: opts.cover ? "cover" : "content",
		title: opts.cover ? opts.fallbackTitle : null,
		titleLine: -1,
		level: 0,
		start: 0,
		end: 0,
		blocks: [],
	};
	let builder = new BlockBuilder();

	const finish = (endLine: number) => {
		builder.close();
		slide.blocks = builder.blocks;
		slide.end = Math.max(slide.start, endLine);
		slides.push(slide);
		builder = new BlockBuilder();
	};
	const open = (kind: SlideKind, title: string | null, n: number, hl = 0) => {
		finish(n - 1);
		slide = { kind, title, titleLine: title === null ? -1 : n, level: hl, start: n, end: n, blocks: [] };
	};

	let fence: string | null = null;
	let inMath = false;

	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		const trimmed = line.trim();

		// Inside a fenced block (top level).
		if (fence) {
			builder.append(line);
			const f = FENCE_RE.exec(line);
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length && trimmed === f[1]) {
				fence = null;
				builder.close();
			}
			continue;
		}
		if (inMath) {
			builder.append(line);
			if (trimmed.endsWith("$$")) {
				inMath = false;
				builder.close();
			}
			continue;
		}

		// Indented content continues the current list item (including nested fences).
		if (builder.kind === "list-item" && trimmed !== "" && INDENTED_RE.test(line)) {
			builder.append(line);
			continue;
		}

		if (trimmed === "") {
			builder.blank();
			continue;
		}

		if (BREAK_RE.test(line)) {
			open("content", null, n);
			continue;
		}

		const h = HEADING_RE.exec(line);
		if (h) {
			const hl = h[1].length;
			const text = h[2];
			// Every heading up to the chosen level starts a slide; deeper ones stay inside it.
			if (level > 0 && hl <= level) {
				open("content", text, n, hl);
				continue;
			}
			builder.start("heading", line, n);
			builder.close();
			continue;
		}

		const f = FENCE_RE.exec(line);
		if (f) {
			fence = f[1];
			builder.start("fence", line, n);
			continue;
		}

		if (trimmed.startsWith("$$")) {
			builder.start("math", line, n);
			if (trimmed.length > 2 && trimmed.endsWith("$$") && trimmed !== "$$") builder.close();
			else inMath = true;
			continue;
		}

		if (LIST_RE.test(line)) {
			builder.start("list-item", line, n);
			continue;
		}

		if (/^ {0,3}>/.test(line)) {
			if (builder.kind === "quote") builder.append(line);
			else builder.start("quote", line, n);
			continue;
		}

		// Paragraph line or lazy continuation.
		const k = builder.kind;
		if (k === "paragraph" || (k === "list-item" && !builder.hasPendingBlank)) builder.append(line);
		else if (k === "quote") builder.append(line);
		else builder.start("paragraph", line, n);
	}
	finish(lines.length - 1);

	for (const sl of slides) {
		for (const b of sl.blocks) b.raw = rawLines.slice(b.start, b.end + 1).join("\n");
	}

	// Drop untitled empty slides (e.g. a trailing ---) but keep the cover and titled topics.
	let result = slides.filter((s) => s.kind === "cover" || s.title !== null || s.blocks.length > 0);

	if (opts.agenda) {
		// The table of contents lists the highest-level headings of the note. A level with a single
		// heading (often the note title written as #) is skipped for the next one.
		const titled = result.filter((s) => s.kind === "content" && s.title && s.level > 0);
		let topics: Slide[] = [];
		for (let lv = 1; lv <= 6 && topics.length < 2; lv++) topics = titled.filter((s) => s.level === lv);
		if (topics.length >= 2) {
			const agenda: Slide = {
				kind: "agenda",
				title: opts.agendaTitle || null,
				titleLine: -1,
				level: 0,
				start: -1,
				end: -1,
				blocks: topics.map((s, i) => ({
					text: `${i + 1}. ${s.title}`,
					raw: "",
					start: -1,
					end: -1,
					kind: "list-item",
				})),
			};
			const at = result.length > 0 && result[0].kind === "cover" ? 1 : 0;
			result = [...result.slice(0, at), agenda, ...result.slice(at)];
		}
	}

	return { frontmatter, slides: result };
}

/** Split a heading line into its "## " prefix and its text, or null if it is not a heading. */
export function splitHeading(line: string): { prefix: string; text: string } | null {
	const m = /^( {0,3}#{1,6}[ \t]+)(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
	return m ? { prefix: m[1], text: m[2] } : null;
}

export function isListLine(text: string): boolean {
	return LIST_RE.test(text);
}

/** Index of the slide that contains a source line, or -1. */
export function slideForLine(deck: Deck, line: number): number {
	let best = -1;
	for (let i = 0; i < deck.slides.length; i++) {
		const s = deck.slides[i];
		if (s.start < 0) continue;
		if (s.start <= line) best = i;
		else break;
	}
	return best;
}

/** Stable identity for a slide across re-parses (kind + title + occurrence). */
export function slideKeys(deck: Deck): string[] {
	const seen = new Map<string, number>();
	return deck.slides.map((s) => {
		const base = `${s.kind}|${s.title ?? ""}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return `${base}|${n}`;
	});
}

/** An edit made on the slide, expressed in source lines of the note. */
export type SlideEdit =
	| { kind: "replace"; from: number; to: number; expected: string; text: string }
	| { kind: "insert"; after: number; expectedLine?: string; expectedTitle?: string; text: string }
	| { kind: "title"; line: number; expectedTitle: string; text: string };

/** Apply a slide edit to the lines of a note. Returns null if the note no longer matches. */
export function applyEditToLines(lines: string[], edit: SlideEdit): string[] | null {
	const out = lines.slice();
	if (edit.kind === "replace") {
		if (edit.to >= lines.length || lines.slice(edit.from, edit.to + 1).join("\n") !== edit.expected) return null;
		const repl = edit.text === "" ? [] : edit.text.split("\n");
		out.splice(edit.from, edit.to - edit.from + 1, ...repl);
		return out;
	}
	if (edit.kind === "insert") {
		if (edit.after >= lines.length) return null;
		const line = lines[edit.after];
		if (edit.expectedLine !== undefined && line !== edit.expectedLine) return null;
		if (edit.expectedTitle !== undefined && splitHeading(line)?.text !== edit.expectedTitle) return null;
		out.splice(edit.after + 1, 0, ...edit.text.split("\n"));
		return out;
	}
	if (edit.line >= lines.length) return null;
	const h = splitHeading(lines[edit.line]);
	if (!h || h.text !== edit.expectedTitle) return null;
	out[edit.line] = h.prefix + edit.text.replace(/\s*\n\s*/g, " ").trim();
	return out;
}

/**
 * Markdown source of a slide (identified by its key), from its title line to its last
 * non-empty line.
 */
export function slideSource(
	text: string,
	opts: ParseOptions,
	key: string
): { from: number; to: number; text: string } | null {
	const deck = parseDeck(text, opts);
	const idx = slideKeys(deck).indexOf(key);
	const slide = idx >= 0 ? deck.slides[idx] : null;
	if (!slide || slide.start < 0) return null;
	if (slide.kind === "cover" && slide.titleLine < 0 && slide.blocks.length === 0) return null;
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	let from = slide.titleLine >= 0 ? slide.titleLine : slide.blocks.length ? slide.blocks[0].start : slide.start;
	if (slide.titleLine < 0 && BREAK_RE.test(lines[from] ?? "")) from++;
	let to = Math.min(slide.end, lines.length - 1);
	while (to >= from && lines[to].trim() === "") to--;
	const section = lines.slice(from, to + 1).join("\n");
	return { from, to, text: section };
}
