import { Component, ItemView, MarkdownRenderer, Notice, Scope, ViewStateResult, setIcon, WorkspaceLeaf, finishRenderMath } from "obsidian";
import { Deck, Slide, slideForLine, slideKeys } from "./parser";
import { SlideSuggest } from "./suggest";
import { t } from "./i18n";
import type OnStagePlugin from "./main";

export const VIEW_TYPE_ONSTAGE = "onstage-projection";

/** Virtual canvas size. Everything is laid out at this size and scaled to the window. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;
/** Extra room required before the text is allowed to grow back (avoids size flicker while typing). */
const GROW_SLACK = 28;

interface Entry {
	key: string;
	el: HTMLElement;
	comp: Component;
	ready: Promise<void>;
}

interface Layout {
	pages: number[][];
	scales: number[];
}

interface SlideModel {
	slide: Slide;
	key: string;
	title: Entry | null;
	blocks: Entry[];
	layout: Layout | null;
}

export interface DeckUpdate {
	deck: Deck;
	sourcePath: string;
	meta: string[];
	/** Source line to show (follow cursor). Null keeps the current slide. */
	line: number | null;
}

/** Cache of rendered Markdown fragments, so live edits only re-render what changed. */
class FragmentPool {
	private pool = new Map<string, Entry[]>();

	constructor(private owner: ItemView) {}

	acquire(kind: string, md: string, sourcePath: string, used: Set<Entry>): Entry {
		const key = `${kind}\u0000${sourcePath}\u0000${md}`;
		const list = this.pool.get(key) ?? [];
		for (const e of list) {
			if (!used.has(e)) {
				used.add(e);
				return e;
			}
		}
		const el = this.owner.containerEl.doc.createElement("div");
		el.addClass("onstage-fragment");
		const comp = new Component();
		this.owner.addChild(comp);
		const ready = MarkdownRenderer.render(this.owner.app, md, el, sourcePath, comp).catch((err) => {
			console.error("OnStage: render failed", err);
		});
		const entry: Entry = { key, el, comp, ready };
		list.push(entry);
		this.pool.set(key, list);
		used.add(entry);
		return entry;
	}

	sweep(used: Set<Entry>): void {
		for (const [key, list] of this.pool) {
			const keep = list.filter((e) => used.has(e));
			for (const e of list) {
				if (!used.has(e)) {
					e.el.detach();
					this.owner.removeChild(e.comp);
				}
			}
			if (keep.length) this.pool.set(key, keep);
			else this.pool.delete(key);
		}
	}

	clear(): void {
		this.sweep(new Set());
	}
}

export class ProjectionView extends ItemView {
	private plugin: OnStagePlugin;
	private pool: FragmentPool;
	private rootEl!: HTMLElement;
	private canvasEl!: HTMLElement;
	private slideEl!: HTMLElement;
	private measureEl!: HTMLElement;
	private blackoutEl!: HTMLElement;

	private models: SlideModel[] = [];
	private meta: string[] = [];
	private sourcePath = "";
	private deck: Deck | null = null;
	private current = 0;
	private page = 0;
	private generation = 0;
	private lastScale = new Map<string, number>();
	private resizeObserver: ResizeObserver | null = null;
	private flowHeight = 0;
	private relayoutTimer: number | null = null;
	private shownKey = "";
	private mathSheets = new Map<string, CSSStyleSheet>();
	private editing: HTMLTextAreaElement | null = null;
	private pendingShow = false;
	private finishEditing: ((commit: boolean) => void) | null = null;
	private editBtn!: HTMLButtonElement;
	private suggest: SlideSuggest | null = null;
	private zoomEl!: HTMLElement;
	private zoomTimer: number | null = null;
	private canvasH = CANVAS_H;
	/** Key events already handled (the same event can reach us through several listeners). */
	private handledKeys = new WeakSet<Event>();
	private mathCss = new Map<string, string>();

	constructor(leaf: WorkspaceLeaf, plugin: OnStagePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.pool = new FragmentPool(this);
	}

	getViewType(): string {
		return VIEW_TYPE_ONSTAGE;
	}

	getDisplayText(): string {
		const name = this.sourcePath.split("/").pop()?.replace(/\.md$/, "");
		return name ? `${t("viewTitle")} - ${name}` : t("viewTitle");
	}

	getIcon(): string {
		return "presentation";
	}

	getState(): Record<string, unknown> {
		return { ...super.getState(), file: this.sourcePath };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const file = (state as { file?: unknown } | null)?.file;
		if (typeof file === "string" && file) {
			this.sourcePath = file;
			this.plugin.onProjectionReady(this, file);
		}
		await super.setState(state, result);
	}

	setSourcePath(path: string): void {
		if (path === this.sourcePath) return;
		this.sourcePath = path;
		// Refresh the tab and window title.
		(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("onstage-view");
		this.rootEl = this.contentEl.createDiv({ cls: "onstage-root" });
		this.canvasEl = this.rootEl.createDiv({ cls: "onstage-canvas" });
		this.slideEl = this.canvasEl.createDiv({ cls: "onstage-slide" });
		this.measureEl = this.canvasEl.createDiv({ cls: "onstage-slide onstage-measure" });
		this.measureEl.setAttr("aria-hidden", "true");
		this.blackoutEl = this.canvasEl.createDiv({ cls: "onstage-blackout" });
		// Visible on hover: a way to edit that does not depend on the keyboard.
		this.editBtn = this.rootEl.createEl("button", { cls: "onstage-edit-btn" });
		this.zoomEl = this.rootEl.createDiv({ cls: "onstage-zoom-flash" });
		this.updateEditButton();
		this.applyAppearance();

		// Keyboard: the projection surface is focusable, so keys work as soon as you click it,
		// whatever window the view lives in.
		this.rootEl.tabIndex = 0;

		// Cmd/Ctrl+E is also Obsidian's "Toggle reading view" hotkey: claim it through the
		// view's keymap scope, which Obsidian consults before its global hotkeys.
		this.scope = new Scope(this.app.scope);
		const toggle = (evt: KeyboardEvent) => {
			this.toggleFromKey(evt);
			return false;
		};
		for (const key of ["e", "E"]) {
			this.scope.register(["Mod"], key, toggle);
			this.scope.register(["Ctrl"], key, toggle);
		}
		this.scope.register([], "Escape", (evt) => {
			if (this.suggest?.isOpen) {
				this.suggest.close();
				return false;
			}
			if (!this.finishEditing) return true;
			if (!this.handledKeys.has(evt)) {
				this.handledKeys.add(evt);
				this.finishEditing(true);
			}
			return false;
		});
		this.registerDomEvent(this.rootEl, "keydown", (evt) => this.onKey(evt));
		this.registerDomEvent(this.rootEl, "mousedown", (evt) => {
			if (this.isEditorTarget(evt.target)) return;
			this.rootEl.focus({ preventScroll: true });
		});
		this.registerDomEvent(this.editBtn, "click", (evt) => {
			evt.stopPropagation();
			this.toggleSourceEdit();
		});
		// Click: left third goes back, the rest goes forward.
		this.registerDomEvent(this.rootEl, "click", (evt) => {
			if (this.editing || this.isEditorTarget(evt.target)) return;
			if (this.handleLinkClick(evt)) return;
			const r = this.rootEl.getBoundingClientRect();
			const back = evt.clientX < r.left + r.width / 3;
			this.plugin.manualNavigate(this, () => (back ? this.prev() : this.next()));
		});

		// Obsidian may create the view in the main window and only then move it into the
		// projection window: observers are (re)attached to the window the view is really in,
		// and the size is also checked twice a second as a safety net.
		this.register(() => this.detachFromWindow());
		this.registerInterval(window.setInterval(() => this.fitCanvas(), 500));
		this.fitCanvas();
		this.rootEl.win.requestAnimationFrame(() => this.fitCanvas());
		if (this.models.length) this.show(false);
		if (this.sourcePath) this.plugin.onProjectionReady(this, this.sourcePath);
	}

	async onClose(): Promise<void> {
		this.pool.clear();
		this.plugin.onProjectionClosed(this);
	}

	/* ------------------------------------------------------------------ */
	/* Appearance                                                          */
	/* ------------------------------------------------------------------ */

	applyAppearance(): void {
		if (!this.rootEl) return;
		const s = this.plugin.settingsFor(this);
		let theme = s.theme as string;
		if (theme === "auto") theme = this.containerEl.doc.body.hasClass("theme-dark") ? "dark" : "light";
		this.rootEl.setAttr("data-theme", theme);
		this.rootEl.toggleClass("onstage-no-progress", !s.progress);
		this.rootEl.toggleClass("onstage-links", s.clickableLinks);
		this.rootEl.style.setProperty("--onstage-accent", s.accent || "#3a5bd9");
		this.rootEl.style.setProperty("--onstage-base", String((s.fontSize || 1) * (this.plugin.settings.zoom || 1)));
		if (s.fontFamily.trim()) this.rootEl.style.setProperty("--onstage-font", s.fontFamily);
		else this.rootEl.style.removeProperty("--onstage-font");
		for (const m of this.models) m.layout = null;
		this.lastScale.clear();
		if (this.models.length) this.show(false);
	}

	private boundWin: Window | null = null;
	private unbindWin: (() => void) | null = null;
	private lastSize = "";

	/** Attach size observers and window listeners to the window that currently holds the view. */
	private attachToWindow(): void {
		const win = this.rootEl.win as Window & typeof globalThis;
		if (win === this.boundWin) return;
		this.detachFromWindow();
		this.boundWin = win;
		const fit = () => this.fitCanvas();
		const stage = new win.ResizeObserver(fit);
		stage.observe(this.rootEl);
		this.resizeObserver = new win.ResizeObserver(() => this.onContentResize());
		win.addEventListener("resize", fit);
		win.document.addEventListener("fullscreenchange", fit);
		this.unbindWin = () => {
			stage.disconnect();
			this.resizeObserver?.disconnect();
			this.resizeObserver = null;
			win.removeEventListener("resize", fit);
			win.document.removeEventListener("fullscreenchange", fit);
		};
		if (this.models.length) this.show(false);
	}

	private detachFromWindow(): void {
		this.unbindWin?.();
		this.unbindWin = null;
		this.boundWin = null;
	}

	/**
	 * The slide takes the shape of the window (from 4:3 to 21:9) instead of a fixed 16:9,
	 * so a fullscreen projection has no empty bands.
	 */
	private fitCanvas(): void {
		if (!this.rootEl) return;
		this.attachToWindow();
		const w = this.rootEl.clientWidth;
		const h = this.rootEl.clientHeight;
		if (!w || !h) return;
		const size = `${w}x${h}`;
		if (size === this.lastSize) return;
		this.lastSize = size;
		const canvasH = Math.round(Math.min(CANVAS_W * 0.75, Math.max(CANVAS_W * (9 / 21), (CANVAS_W * h) / w)));
		const scale = Math.min(w / CANVAS_W, h / canvasH);
		this.canvasEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
		if (canvasH !== this.canvasH) {
			this.canvasH = canvasH;
			this.canvasEl.setCssProps({ "--onstage-canvas-h": `${canvasH}px` });
			for (const m of this.models) m.layout = null;
			if (this.models.length) this.show(false);
		}
	}

	/** Zoom the slide content (+, -, 0 in the projection). Remembered in the settings. */
	private zoomBy(delta: number | null): void {
		const s = this.plugin.settings;
		const next = delta === null ? 1 : Math.round(Math.min(2, Math.max(0.6, s.zoom + delta)) * 100) / 100;
		if (next === s.zoom) return;
		s.zoom = next;
		void this.plugin.saveSettings();
		this.flashZoom(`${Math.round(next * 100)} %`);
	}

	private flashZoom(text: string): void {
		this.zoomEl.setText(text);
		this.zoomEl.addClass("is-visible");
		if (this.zoomTimer !== null) window.clearTimeout(this.zoomTimer);
		this.zoomTimer = window.setTimeout(() => {
			this.zoomTimer = null;
			this.zoomEl.removeClass("is-visible");
		}, 900);
	}

	/* ------------------------------------------------------------------ */
	/* Deck updates                                                        */
	/* ------------------------------------------------------------------ */

	async update(u: DeckUpdate): Promise<void> {
		const gen = ++this.generation;
		const used = new Set<Entry>();
		const keys = slideKeys(u.deck);
		const prevKey = this.models[this.current]?.key;
		const prevPage = this.page;

		const models: SlideModel[] = u.deck.slides.map((slide, i) => ({
			slide,
			key: keys[i],
			title: slide.title ? this.pool.acquire("title", slide.title, u.sourcePath, used) : null,
			blocks: slide.blocks.map((b) => this.pool.acquire("block", b.text, u.sourcePath, used)),
			layout: null,
		}));

		const pending: Promise<void>[] = [];
		for (const m of models) {
			if (m.title) pending.push(m.title.ready);
			for (const b of m.blocks) pending.push(b.ready);
		}
		await Promise.all(pending);
		if (gen !== this.generation) return;
		try {
			await finishRenderMath();
		} catch {
			/* MathJax not loaded: nothing to finish */
		}
		if (gen !== this.generation) return;
		this.syncMathStyles();

		const pathChanged = this.sourcePath !== u.sourcePath;
		this.deck = u.deck;
		this.models = models;
		this.meta = u.meta;
		this.sourcePath = u.sourcePath;
		this.pool.sweep(used);
		if (pathChanged) {
			// Refresh the popout window title.
			(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
		}

		let target = keys.indexOf(prevKey ?? "");
		let page = target >= 0 ? prevPage : 0;
		if (u.line !== null) {
			const pos = this.positionForLine(u.line);
			if (pos) {
				target = pos.slide;
				page = pos.page;
			}
		}
		if (target < 0) target = Math.min(this.current, models.length - 1);
		this.current = Math.max(0, target);
		this.page = page;
		this.show(false);
	}

	/**
	 * MathJax injects its stylesheet into the main window only. Mirror it into the
	 * projection window so formulas render the same there.
	 */
	private syncMathStyles(): void {
		const doc = this.containerEl.doc;
		const mainDoc = this.app.workspace.containerEl.doc;
		if (doc === mainDoc) return;
		const win = this.containerEl.win as Window & typeof globalThis;
		for (const id of ["MJX-CHTML-styles", "MJX-SVG-styles"]) {
			// Obsidian may already mirror it into the popout.
			if (doc.getElementById(id)) continue;
			const css = mainDoc.getElementById(id)?.textContent ?? "";
			if (!css) continue;
			let sheet = this.mathSheets.get(id);
			if (!sheet) {
				sheet = new win.CSSStyleSheet();
				this.mathSheets.set(id, sheet);
				doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
			}
			if (this.mathCss.get(id) !== css) {
				sheet.replaceSync(css);
				this.mathCss.set(id, css);
			}
		}
	}

	/* ------------------------------------------------------------------ */
	/* Navigation                                                          */
	/* ------------------------------------------------------------------ */

	get slideCount(): number {
		return this.models.length;
	}

	get currentSlide(): number {
		return this.current;
	}

	slideIndexForLine(line: number): number {
		return this.deck ? slideForLine(this.deck, line) : -1;
	}

	positionForLine(line: number): { slide: number; page: number } | null {
		if (!this.deck) return null;
		const idx = slideForLine(this.deck, line);
		if (idx < 0) return null;
		const model = this.models[idx];
		const layout = this.ensureLayout(model);
		let blockIdx = -1;
		model.slide.blocks.forEach((b, i) => {
			if (b.start <= line) blockIdx = i;
		});
		let page = 0;
		if (blockIdx >= 0) {
			const p = layout.pages.findIndex((pg) => pg.includes(blockIdx));
			if (p >= 0) page = p;
		}
		return { slide: idx, page };
	}

	goToLine(line: number): void {
		const pos = this.positionForLine(line);
		if (!pos) return;
		if (pos.slide === this.current && pos.page === this.page) return;
		const animate = pos.slide !== this.current;
		this.current = pos.slide;
		this.page = pos.page;
		this.show(animate);
	}

	next(): boolean {
		const m = this.models[this.current];
		if (!m) return false;
		const layout = this.ensureLayout(m);
		if (this.page < layout.pages.length - 1) {
			this.page++;
			this.show(true);
			return true;
		}
		if (this.current < this.models.length - 1) {
			this.current++;
			this.page = 0;
			this.show(true);
			return true;
		}
		return false;
	}

	prev(): boolean {
		if (this.page > 0) {
			this.page--;
			this.show(true);
			return true;
		}
		if (this.current > 0) {
			this.current--;
			const layout = this.ensureLayout(this.models[this.current]);
			this.page = layout.pages.length - 1;
			this.show(true);
			return true;
		}
		return false;
	}

	first(): void {
		this.current = 0;
		this.page = 0;
		this.show(true);
	}

	last(): void {
		this.current = Math.max(0, this.models.length - 1);
		this.page = Math.max(0, this.ensureLayout(this.models[this.current]).pages.length - 1);
		this.show(true);
	}

	toggleBlackout(): void {
		this.blackoutEl.toggleClass("is-active", !this.blackoutEl.hasClass("is-active"));
	}

	toggleFullscreen(): void {
		const doc = this.containerEl.doc;
		if (doc.fullscreenElement) void doc.exitFullscreen();
		else void doc.documentElement.requestFullscreen().catch(() => undefined);
	}

	private onKey(evt: KeyboardEvent): void {
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && evt.key.toLowerCase() === "e") {
			evt.preventDefault();
			this.toggleFromKey(evt);
			return;
		}
		if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
		if (this.editing || this.isEditorTarget(evt.target)) return;
		let handled = true;
		switch (evt.key) {
			case "ArrowRight":
			case "ArrowDown":
			case "PageDown":
			case " ":
				this.plugin.manualNavigate(this, () => this.next());
				break;
			case "ArrowLeft":
			case "ArrowUp":
			case "PageUp":
			case "Backspace":
				this.plugin.manualNavigate(this, () => this.prev());
				break;
			case "Home":
				this.plugin.manualNavigate(this, () => this.first());
				break;
			case "End":
				this.plugin.manualNavigate(this, () => this.last());
				break;
			case "b":
			case "B":
			case ".":
				this.toggleBlackout();
				break;
			case "f":
			case "F":
				this.toggleFullscreen();
				break;
			case "+":
			case "=":
				this.zoomBy(0.05);
				break;
			case "-":
			case "_":
				this.zoomBy(-0.05);
				break;
			case "0":
				this.zoomBy(null);
				break;
			default:
				handled = false;
		}
		if (handled) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}

	/* ------------------------------------------------------------------ */
	/* Editing on the slide                                                */
	/* ------------------------------------------------------------------ */

	private isEditorTarget(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && typeof el.closest === "function" && !!el.closest(".onstage-editor");
	}

	private linkAt(target: EventTarget | null): HTMLAnchorElement | null {
		const el = target as HTMLElement | null;
		if (!el || typeof el.closest !== "function" || !this.slideEl.contains(el)) return null;
		return el.closest("a");
	}

	/**
	 * Links on the slide: web links open in the browser, links to notes open in the main
	 * window (never on the projection). Returns true when the click was a link.
	 */
	private handleLinkClick(evt: MouseEvent): boolean {
		const a = this.linkAt(evt.target);
		if (!a) return false;
		evt.preventDefault();
		evt.stopPropagation();
		if (!this.plugin.settings.clickableLinks || evt.detail > 1) return true;
		if (a.hasClass("internal-link")) {
			const target = a.getAttr("data-href") ?? a.getAttr("href");
			if (target) this.plugin.openNoteLink(target, this.sourcePath);
			return true;
		}
		const href = a.getAttr("href");
		if (href && /^(https?|mailto|obsidian|zotero):/i.test(href)) this.containerEl.win.open(href, "_blank");
		return true;
	}

	private updateEditButton(): void {
		if (!this.editBtn) return;
		this.editBtn.empty();
		const editing = this.finishEditing !== null;
		setIcon(this.editBtn.createSpan({ cls: "onstage-edit-icon" }), editing ? "check" : "pencil");
		this.editBtn.createSpan({ text: editing ? t("editDone") : t("editButton") });
		this.editBtn.toggleClass("is-active", editing);
		this.editBtn.toggleClass("is-hidden", !this.plugin.settings.editOnSlide);
	}

	private toggleFromKey(evt: KeyboardEvent): void {
		if (this.handledKeys.has(evt)) return;
		this.handledKeys.add(evt);
		this.toggleSourceEdit();
	}

	get isEditing(): boolean {
		return this.editing !== null;
	}

	/** Switch the current slide to its raw Markdown, or back to the rendered slide. */
	toggleSourceEdit(): void {
		if (this.finishEditing) {
			this.finishEditing(true);
			return;
		}
		if (!this.plugin.settings.editOnSlide) return;
		const m = this.models[this.current];
		if (!m) return;
		const src = this.plugin.sourceForSlide(this, m.key);
		if (!src) {
			new Notice(t("editNotEditable"));
			return;
		}
		const { from, text: initial } = src;
		// What the note currently holds for this slide; updated after every write.
		let to = src.to;
		let written = initial;
		let failed = false;
		let timer: number | null = null;
		let queue: Promise<void> = Promise.resolve();

		this.slideEl.empty();
		this.slideEl.className = "onstage-slide onstage-kind-source";
		const box = this.slideEl.createDiv({ cls: "onstage-source" });
		const ta = box.createEl("textarea", { cls: "onstage-editor onstage-source-editor" });
		ta.value = initial;
		ta.spellcheck = false;
		const hint = box.createDiv({ cls: "onstage-source-hint", text: t("editHint") });
		this.editing = ta;
		this.suggest = new SlideSuggest(this.app, ta, this.rootEl, this.sourcePath);

		/** Write the textarea content into the note (serialized, skips if unchanged). */
		const write = (text: string): Promise<void> => {
			queue = queue.then(async () => {
				if (failed || text === written) return;
				const ok = await this.plugin.applySlideEdit(this, { kind: "replace", from, to, expected: written, text });
				if (!ok) {
					failed = true;
					hint.setText(t("editFailed"));
					hint.addClass("is-error");
					return;
				}
				written = text;
				hint.setText(`${t("editSaved")} - ${t("editHint")}`);
				to = text === "" ? from - 1 : from + text.split("\n").length - 1;
			});
			return queue;
		};

		const finish = (commit: boolean) => {
			if (this.editing !== ta) return;
			if (timer !== null) window.clearTimeout(timer);
			this.editing = null;
			this.finishEditing = null;
			this.suggest?.destroy();
			this.suggest = null;
			this.updateEditButton();
			ta.blur();
			const final = commit ? ta.value.replace(/\s+$/, "") : written;
			void write(final).then(() => {
				this.show(false);
			});
			this.rootEl.focus({ preventScroll: true });
		};
		this.finishEditing = finish;
		this.updateEditButton();

		// Live: every pause in typing is written to the note.
		ta.addEventListener("input", () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				timer = null;
				void write(ta.value);
			}, 400);
		});
		ta.addEventListener("keydown", (e) => {
			const mod = e.metaKey || e.ctrlKey;
			if ((mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "e") || e.key === "Escape") {
				e.preventDefault();
				if (!this.handledKeys.has(e)) {
					this.handledKeys.add(e);
					finish(true);
				}
			} else if (e.key === "Tab") {
				e.preventDefault();
				const start = ta.selectionStart;
				ta.setRangeText("\t", start, ta.selectionEnd, "end");
				ta.dispatchEvent(new Event("input"));
			}
		});
		// Losing focus (Obsidian, another window...) only saves; the editor stays open
		// until Escape, Cmd/Ctrl+E or the button.
		ta.addEventListener("blur", () => {
			if (this.editing !== ta) return;
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
			void write(ta.value);
		});
		const focusEditor = () => {
			if (this.editing !== ta) return;
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
			ta.scrollTop = ta.scrollHeight;
		};
		focusEditor();
		// Obsidian may move the focus right after the key or click that opened the editor.
		window.setTimeout(focusEditor, 50);
	}

	/* ------------------------------------------------------------------ */
	/* Layout                                                              */
	/* ------------------------------------------------------------------ */

	private scaleSteps(): number[] {
		const min = Math.min(1, Math.max(0.3, this.plugin.settingsFor(this).minScale));
		const steps: number[] = [];
		for (let s = 1; s > min + 0.001; s -= 0.04) steps.push(Math.round(s * 1000) / 1000);
		steps.push(min);
		return steps;
	}

	/** Build the DOM of a slide page into a container (used for both measuring and display). */
	private build(container: HTMLElement, idx: number, page: number, blockIdx: number[]): HTMLElement {
		const m = this.models[idx];
		const kind = m.slide.kind;
		container.empty();
		container.className = container.hasClass("onstage-measure") ? "onstage-slide onstage-measure" : "onstage-slide";
		container.addClass(`onstage-kind-${kind}`);
		if (blockIdx.length === 0) container.addClass("is-title-only");
		// A slide that only holds images (one image or one row) shows them as large as possible.
		if (blockIdx.length === 1 && m.slide.blocks[blockIdx[0]].kind === "image") container.addClass("is-image-only");
		if (!m.title) container.addClass("is-untitled");

		const inner = container.createDiv({ cls: "onstage-inner" });

		if (kind === "cover") {
			inner.createDiv({ cls: "onstage-rule" });
			const h = inner.createEl("h1", { cls: "onstage-title" });
			if (m.title) h.appendChild(m.title.el);
			if (this.meta.length) {
				const metaEl = inner.createDiv({ cls: "onstage-meta" });
				this.meta.forEach((line) => metaEl.createDiv({ text: line }));
			}
		} else if (m.title) {
			const head = inner.createDiv({ cls: "onstage-head" });
			if (kind !== "section") head.createDiv({ cls: "onstage-rule" });
			const h = head.createEl(kind === "section" ? "h1" : "h2", { cls: "onstage-title" });
			h.appendChild(m.title.el);
			if (page > 0) h.createSpan({ cls: "onstage-continued", text: t("continued") });
		}

		const body = inner.createDiv({ cls: "onstage-body" });
		const flow = body.createDiv({ cls: "onstage-flow" });
		let prevKind: string | null = null;
		for (const i of blockIdx) {
			const b = m.slide.blocks[i];
			const wrap = flow.createDiv({ cls: `onstage-block onstage-block-${b.kind}` });
			wrap.setAttr("data-block", String(i));
			if (prevKind === "list-item" && b.kind === "list-item") wrap.addClass("is-list-continuation");
			wrap.appendChild(m.blocks[i].el);
			prevKind = b.kind;
		}

		this.applyImageWidths(flow);

		if (kind !== "cover") {
			const footer = container.createDiv({ cls: "onstage-footer" });
			// Same numbering as the status bar in the note window: position among all slides.
			const total = this.models.length;
			const n = idx + 1;
			footer.createDiv({
				cls: "onstage-counter",
				text: `${n} / ${total}`,
			});
			const bar = footer.createDiv({ cls: "onstage-progress" });
			bar.createDiv({ cls: "onstage-progress-fill" }).style.width = `${total ? (n / total) * 100 : 0}%`;
		}
		return body;
	}

	/**
	 * Obsidian's ![[image.png|400]] gives a width in pixels of the note. A note is about 700px
	 * wide, so the width is kept as the same share of the slide width.
	 */
	private applyImageWidths(root: HTMLElement): void {
		root.querySelectorAll("img[width]").forEach((img) => {
			const w = parseFloat(img.getAttribute("width") ?? "");
			if (!Number.isFinite(w) || w <= 0) return;
			(img as HTMLElement).setCssProps({ "--onstage-img-w": `${Math.min(100, (w / 700) * 100)}%` });
		});
	}

	private fits(container: HTMLElement, body: HTMLElement, scale: number, slack: number): boolean {
		container.style.setProperty("--onstage-scale", String(scale));
		return body.scrollHeight <= body.clientHeight - slack + 1 && body.scrollWidth <= body.clientWidth + 1;
	}

	private bestScale(idx: number, page: number, blockIdx: number[]): number {
		const key = `${this.models[idx].key}#${page}`;
		const prev = this.lastScale.get(key) ?? 0;
		const body = this.build(this.measureEl, idx, page, blockIdx);
		const steps = this.scaleSteps();
		let chosen = steps[steps.length - 1];
		for (const s of steps) {
			if (this.fits(this.measureEl, body, s, s > prev && prev > 0 ? GROW_SLACK : 0)) {
				chosen = s;
				break;
			}
		}
		this.lastScale.set(key, chosen);
		return chosen;
	}

	/** Greedy pagination of blocks at a given text size. */
	private paginate(idx: number, all: number[], scale: number): number[][] {
		const pages: number[][] = [];
		let current: number[] = [];
		for (const i of all) {
			current.push(i);
			const b = this.build(this.measureEl, idx, pages.length, current);
			if (current.length > 1 && !this.fits(this.measureEl, b, scale, 0)) {
				current.pop();
				pages.push(current);
				current = [i];
			}
		}
		if (current.length) pages.push(current);
		return pages;
	}

	private ensureLayout(m: SlideModel): Layout {
		if (m.layout) return m.layout;
		const idx = this.models.indexOf(m);
		const all = m.slide.blocks.map((_, i) => i);
		const steps = this.scaleSteps();
		const min = steps[steps.length - 1];

		let layout: Layout;
		const body = this.build(this.measureEl, idx, 0, all);
		if (all.length <= 1 || this.fits(this.measureEl, body, min, 0)) {
			layout = { pages: [all], scales: [this.bestScale(idx, 0, all)] };
		} else {
			// Find the largest text size that still needs the minimum number of pages,
			// so continuation slides share one comfortable size instead of one cramped page.
			const minPages = this.paginate(idx, all, min).length;
			let pages: number[][] = [];
			let scale = min;
			for (const s of steps) {
				const candidate = this.paginate(idx, all, s);
				if (candidate.length <= minPages) {
					pages = candidate;
					scale = s;
					break;
				}
			}
			layout = { pages, scales: pages.map(() => scale) };
		}
		this.measureEl.empty();
		m.layout = layout;
		return layout;
	}

	private show(animate: boolean): void {
		if (!this.slideEl) return;
		if (this.editing) {
			this.pendingShow = true;
			return;
		}
		this.pendingShow = false;
		if (!this.models.length) {
			this.slideEl.empty();
			return;
		}
		this.current = Math.min(Math.max(0, this.current), this.models.length - 1);
		const m = this.models[this.current];
		const layout = this.ensureLayout(m);
		this.page = Math.min(Math.max(0, this.page), layout.pages.length - 1);

		this.resizeObserver?.disconnect();
		const body = this.build(this.slideEl, this.current, this.page, layout.pages[this.page]);
		this.slideEl.style.setProperty("--onstage-scale", String(layout.scales[this.page]));

		const key = `${m.key}#${this.page}`;
		if (animate && key !== this.shownKey) {
			this.slideEl.removeClass("onstage-enter");
			void this.slideEl.offsetWidth;
			this.slideEl.addClass("onstage-enter");
		}
		this.shownKey = key;

		const flow = body.firstElementChild as HTMLElement | null;
		this.flowHeight = flow ? flow.scrollHeight : 0;
		if (flow) this.resizeObserver?.observe(flow);
		this.plugin.onSlideShown(this, this.current, this.models.length);
	}

	/** Content changed size on its own (image loaded, diagram rendered...): lay out again. */
	private onContentResize(): void {
		if (this.editing) return;
		const flow = this.slideEl.querySelector(".onstage-flow");
		if (!flow) return;
		const h = (flow as HTMLElement).scrollHeight;
		if (Math.abs(h - this.flowHeight) < 3) return;
		if (this.relayoutTimer !== null) window.clearTimeout(this.relayoutTimer);
		this.relayoutTimer = window.setTimeout(() => {
			this.relayoutTimer = null;
			const m = this.models[this.current];
			if (!m) return;
			m.layout = null;
			this.show(false);
		}, 80);
	}
}
