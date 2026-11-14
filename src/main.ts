import {
	MarkdownView,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	editorInfoField,
	moment,
	parseYaml,
	setIcon,
} from "obsidian";
import type { Moment } from "moment";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { ParseOptions, SlideEdit, applyEditToLines, frontmatterText, parseDeck, slideSource } from "./parser";
import { t } from "./i18n";
import { DEFAULT_SETTINGS, OnStageSettings, OnStageSettingTab } from "./settings";
import { ProjectionView, VIEW_TYPE_ONSTAGE } from "./view";

export type { SlideEdit };

type MomentFn = (input: string, format: unknown, strict: boolean) => Moment;
const parseMoment = moment as unknown as MomentFn;

/** Live link between a note and one projection tab. */
interface Session {
	view: ProjectionView;
	file: TFile;
	/** Settings overridden by the note's onstage-* properties. */
	overrides: Partial<OnStageSettings>;
	slide: { current: number; total: number };
	latestText: string;
	displayedText: string;
	cursorLine: number;
	lastEditLine: number;
	firstPendingEdit: number;
	/** The projection follows the note (toggled from the status bar; starts from the setting). */
	follow: boolean;
	/** Temporary pause after a manual change of slide while following. */
	paused: boolean;
	pausedSlide: number;
	timer: number | null;
	lastEditorEvent: number;
	/** True while OnStage itself writes to the note (edits made on the slide). */
	writing: boolean;
}

export default class OnStagePlugin extends Plugin {
	settings: OnStageSettings = { ...DEFAULT_SETTINGS };
	/** One session per projection tab. */
	private sessions = new Map<ProjectionView, Session>();
	/** The projection that commands and keys act on: the last one used. */
	private currentView: ProjectionView | null = null;
	private statusEl: HTMLElement | null = null;

	/** Development install (Hot Reload marker present): write diagnostics about the shown slide. */
	devMode = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		const dir = this.manifest.dir;
		this.devMode = !!dir && (await this.app.vault.adapter.exists(`${dir}/.hotreload`));

		this.registerView(VIEW_TYPE_ONSTAGE, (leaf) => new ProjectionView(leaf, this));

		this.addRibbonIcon("presentation", t("ribbon"), () => {
			void this.startPresentation();
		});

		this.addCommand({
			id: "present-current-note",
			name: t("cmdOpen"),
			checkCallback: (checking) => {
				if (!this.noteView()) return false;
				if (!checking) void this.startPresentation();
				return true;
			},
		});
		this.addCommand({
			id: "stop-presenting",
			name: t("cmdClose"),
			checkCallback: (checking) => this.withView(checking, (v) => v.leaf.detach()),
		});
		this.addCommand({
			id: "next-slide",
			name: t("cmdNext"),
			checkCallback: (checking) => this.withView(checking, (v) => this.manualNavigate(v, () => v.next())),
		});
		this.addCommand({
			id: "previous-slide",
			name: t("cmdPrev"),
			checkCallback: (checking) => this.withView(checking, (v) => this.manualNavigate(v, () => v.prev())),
		});
		this.addCommand({
			id: "toggle-follow-cursor",
			name: t("cmdToggleFollow"),
			callback: () => this.toggleFollow(),
		});
		this.addCommand({
			id: "push-changes",
			name: t("cmdPush"),
			checkCallback: (checking) => {
				const cur = this.currentSession();
				if (!cur) return false;
				if (!checking) this.pushNow(cur, true);
				return true;
			},
		});
		this.addCommand({
			id: "toggle-markdown-editing",
			name: t("cmdEdit"),
			checkCallback: (checking) => this.withView(checking, (v) => v.toggleSourceEdit()),
		});
		this.addCommand({
			id: "toggle-black-screen",
			name: t("cmdBlackout"),
			checkCallback: (checking) => this.withView(checking, (v) => v.toggleBlackout()),
		});
		this.addCommand({
			id: "toggle-fullscreen",
			name: t("cmdFullscreen"),
			checkCallback: (checking) => this.withView(checking, (v) => v.toggleFullscreen()),
		});

		this.addSettingTab(new OnStageSettingTab(this.app, this));

		this.registerEditorExtension([
			EditorView.updateListener.of((update) => {
				if (this.sessions.size === 0) return;
				if (!update.docChanged && !update.selectionSet) return;
				const info = update.state.field(editorInfoField, false);
				const file = info?.file;
				const sess = file ? this.sessionForFile(file.path) : undefined;
				if (!sess) return;
				const head = update.state.selection.main.head;
				const line = update.state.doc.lineAt(head).number - 1;
				const text = update.docChanged ? update.state.doc.toString() : null;
				this.onEditorUpdate(sess, text, line);
			}),
			Prec.highest(
				keymap.of([
					{ key: "PageDown", run: () => this.clickerKey(1) },
					{ key: "PageUp", run: () => this.clickerKey(-1) },
				])
			),
		]);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				const sess = this.sessionForFile(file.path);
				if (!sess || Date.now() - sess.lastEditorEvent < 1500) return;
				void this.app.vault.cachedRead(file).then((text) => {
					if (this.sessions.get(sess.view) !== sess) return;
					sess.latestText = text;
					this.pushNow(sess, false);
				});
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile) => {
				for (const sess of this.sessions.values()) if (sess.file === file) this.pushNow(sess, false);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				for (const sess of [...this.sessions.values()]) if (sess.file === file) sess.view.leaf.detach();
			})
		);
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				for (const sess of this.sessions.values()) sess.view.applyAppearance();
			})
		);
		// Switching tabs in the projection window changes which presentation keys act on.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof ProjectionView && this.sessions.has(leaf.view)) {
					this.currentView = leaf.view;
					this.updateStatus();
				}
			})
		);

		this.statusEl = this.addStatusBarItem();
		this.statusEl.addClass("onstage-status");
		this.registerDomEvent(this.statusEl, "click", (evt) => this.onStatusClick(evt));
		this.updateStatus();
	}

	onunload(): void {
		for (const sess of this.sessions.values()) this.clearTimer(sess);
		this.sessions.clear();
	}

	async loadSettings(): Promise<void> {
		const saved = ((await this.loadData()) ?? {}) as Partial<OnStageSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		const version = saved.settingsVersion ?? 1;
		// v2: the cover takes the note title and every H1 starts a slide.
		if (version < 2) this.settings.splitLevel = DEFAULT_SETTINGS.splitLevel;
		// v3: general-purpose defaults for the cover (no meeting-specific fields).
		if (version < 3 && saved.coverFields === "subtitle, sous-titre, date, participants, attendees, location, lieu") {
			this.settings.coverFields = DEFAULT_SETTINGS.coverFields;
		}
		// v4: cover properties in the user's language.
		if (version < 4 && saved.coverFields === "subtitle, sous-titre, author, auteur, date") {
			this.settings.coverFields = DEFAULT_SETTINGS.coverFields;
		}
		// v5: headings "up to" the level make slides; H2 (# and ##) is the natural default.
		if (version < 5 && this.settings.splitLevel === 1) this.settings.splitLevel = 2;
		this.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
		const legacy = this.settings as Partial<OnStageSettings> & { actions?: unknown; privateCallout?: unknown };
		delete legacy.actions;
		delete legacy.privateCallout;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const sess of this.sessions.values()) {
			sess.view.applyAppearance();
			this.pushNow(sess, false);
		}
		this.updateStatus();
	}

	/* ------------------------------------------------------------------ */
	/* Session lifecycle                                                   */
	/* ------------------------------------------------------------------ */

	/** The projection that commands and keys act on: the last one used, else any open one. */
	projection(): ProjectionView | null {
		if (this.currentView && this.sessions.has(this.currentView)) return this.currentView;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ONSTAGE)) {
			if (leaf.view instanceof ProjectionView) return leaf.view;
		}
		return null;
	}

	private currentSession(): Session | undefined {
		const view = this.projection();
		return view ? this.sessions.get(view) : undefined;
	}

	private sessionForFile(path: string): Session | undefined {
		if (this.currentView) {
			const cur = this.sessions.get(this.currentView);
			if (cur?.file.path === path) return cur;
		}
		for (const sess of this.sessions.values()) if (sess.file.path === path) return sess;
		return undefined;
	}

	private bind(view: ProjectionView, file: TFile, text: string, cursorLine: number): Session {
		const old = this.sessions.get(view);
		if (old) this.clearTimer(old);
		const sess: Session = {
			view,
			file,
			overrides: {},
			slide: { current: 0, total: 0 },
			latestText: text,
			displayedText: "",
			cursorLine,
			lastEditLine: -1,
			firstPendingEdit: 0,
			follow: old ? old.follow : this.settings.follow,
			paused: false,
			pausedSlide: -1,
			timer: null,
			lastEditorEvent: 0,
			writing: false,
		};
		this.sessions.set(view, sess);
		return sess;
	}

	/**
	 * The note to present: the active one, or else the last note used in the main window
	 * (after a click in the projection, the projection is the active view).
	 */
	private noteView(): MarkdownView | null {
		const ws = this.app.workspace;
		const active = ws.getActiveViewOfType(MarkdownView);
		if (active?.file) return active;
		const recent = ws.getMostRecentLeaf(ws.rootSplit)?.view;
		if (recent instanceof MarkdownView && recent.file) return recent;
		const any = ws.getLeavesOfType("markdown").map((l) => l.view).find((v) => v instanceof MarkdownView && v.file);
		return any instanceof MarkdownView ? any : null;
	}

	/** Present the current note in the projection window (one presentation at a time). */
	async startPresentation(): Promise<void> {
		const ws = this.app.workspace;
		const mv = this.noteView();
		const file = mv?.file;
		if (!mv || !file) {
			new Notice(t("noNote"));
			return;
		}
		const text = mv.editor.getValue();
		const line = mv.editor.getCursor().line;

		// One presentation at a time: an open projection switches to this note and comes to the front.
		const existing = this.projection();
		if (existing) {
			existing.setSourcePath(file.path);
			const sess = this.bind(existing, file, text, line);
			this.currentView = existing;
			this.pushNow(sess, true);
			await ws.revealLeaf(existing.leaf);
			existing.focusStage();
			return;
		}

		// On a second screen: open it there, as large as the screen, and keep typing in the note.
		// On a single screen: open it in front.
		const other = await this.otherScreen();
		const leaf = ws.openPopoutLeaf(
			other
				? { x: other.availLeft, y: other.availTop, size: { width: other.availWidth, height: other.availHeight } }
				: { size: { width: 1280, height: 720 } }
		);
		await leaf.setViewState({ type: VIEW_TYPE_ONSTAGE, active: true, state: { file: file.path } });
		await leaf.loadIfDeferred();
		const view = leaf.view;
		if (!(view instanceof ProjectionView)) return;
		const sess = this.bind(view, file, text, line);
		this.currentView = view;
		this.pushNow(sess, true);

		if (!other) {
			await ws.revealLeaf(leaf);
			window.setTimeout(() => view.focusStage(), 250);
			return;
		}
		// Give the keyboard back to the note so you can keep typing.
		window.setTimeout(() => {
			window.focus();
			ws.setActiveLeaf(mv.leaf, { focus: true });
			mv.editor.focus();
		}, 250);
	}

	/** Another screen than the one showing Obsidian, when the system lets us list screens. */
	private async otherScreen(): Promise<{ availLeft: number; availTop: number; availWidth: number; availHeight: number } | null> {
		type ScreenInfo = { availLeft: number; availTop: number; availWidth: number; availHeight: number; left: number; top: number };
		const w = window as Window & { getScreenDetails?: () => Promise<{ screens: ScreenInfo[]; currentScreen: ScreenInfo }> };
		if (typeof w.getScreenDetails !== "function") return null;
		try {
			const details = await Promise.race([
				w.getScreenDetails(),
				new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
			]);
			if (!details || details.screens.length < 2) return null;
			const cur = details.currentScreen;
			return details.screens.find((sc) => sc.left !== cur.left || sc.top !== cur.top) ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Called by a projection view once it knows its note, including when Obsidian re-creates
	 * it (plugin update, workspace restore). Connects it to that note.
	 */
	onProjectionReady(view: ProjectionView, path: string): void {
		const known = this.sessions.get(view);
		if (known && known.file.path === path) {
			this.pushNow(known, true);
			return;
		}
		const file = path ? this.app.vault.getFileByPath(path) : null;
		if (!file) return;
		const ed = this.editorFor(file);
		if (ed) {
			this.pushNow(this.bind(view, file, ed.editor.getValue(), ed.editor.getCursor().line), true);
		} else {
			void this.app.vault.cachedRead(file).then((content) => {
				if (this.sessions.get(view)?.file.path === path) return;
				this.pushNow(this.bind(view, file, content, 0), false);
			});
		}
	}

	onProjectionClosed(view: ProjectionView): void {
		const sess = this.sessions.get(view);
		if (sess) this.clearTimer(sess);
		this.sessions.delete(view);
		if (this.currentView === view) this.currentView = null;
		this.updateStatus();
	}

	/** Development installs only: save the HTML of the shown slide, to debug rendering. */
	writeDiagnostics(slide: number, html: string): void {
		const dir = this.manifest.dir;
		if (!this.devMode || !dir) return;
		void this.app.vault.adapter.write(`${dir}/debug-slide-${slide}.html`, html).catch(() => undefined);
	}

	onSlideShown(view: ProjectionView, current: number, total: number): void {
		const sess = this.sessions.get(view);
		if (sess) sess.slide = { current, total };
		if (view === this.projection()) this.updateStatus();
	}

	/* ------------------------------------------------------------------ */
	/* Live sync                                                           */
	/* ------------------------------------------------------------------ */

	private onEditorUpdate(s: Session, text: string | null, line: number): void {
		if (s.writing) {
			// Our own edit from the slide: not the presenter typing, so no follow and no jump.
			if (text !== null) s.latestText = text;
			s.lastEditorEvent = Date.now();
			return;
		}
		s.cursorLine = line;
		s.lastEditorEvent = Date.now();

		if (text === null) {
			this.followCursor(s, line);
			return;
		}

		s.latestText = text;
		// Typing in the note always brings the projection back to where you write.
		if (s.paused) {
			s.paused = false;
			this.updateStatus();
		}
		switch (this.settings.mode) {
			case "direct":
				this.schedule(s, 90);
				break;
			case "calm": {
				const now = Date.now();
				const lineChanged = s.lastEditLine !== -1 && line !== s.lastEditLine;
				s.lastEditLine = line;
				const currentLine = text.split("\n")[line] ?? "";
				// A new, still empty line (after Enter): the previous line is finished, show it now.
				// Anything typed on a line waits for a pause, so the audience never sees half words.
				if (lineChanged && currentLine.trim() === "") {
					this.pushNow(s, false);
				} else {
					if (s.timer === null) s.firstPendingEdit = now;
					// Never hold an edit back for more than a few pauses' worth of time.
					const maxWait = this.settings.calmDelay * 4;
					const wait = Math.min(this.settings.calmDelay, Math.max(0, s.firstPendingEdit + maxWait - now));
					this.schedule(s, wait);
				}
				break;
			}
			case "manual":
				this.updateStatus();
				break;
		}
		this.followCursor(s, line);
	}

	private schedule(s: Session, ms: number): void {
		if (s.timer !== null) window.clearTimeout(s.timer);
		s.timer = window.setTimeout(() => {
			s.timer = null;
			this.pushNow(s, false);
		}, ms);
	}

	private clearTimer(s: Session): void {
		if (s.timer !== null) window.clearTimeout(s.timer);
		s.timer = null;
	}

	/** Parse the latest text of a session's note and send it to its projection. */
	pushNow(s: Session, forceFollow: boolean): void {
		if (this.sessions.get(s.view) !== s) return;
		this.clearTimer(s);
		const view = s.view;
		s.displayedText = s.latestText;
		const props = this.readProperties(s.latestText);
		const overrides = this.overridesFrom(props);
		if (JSON.stringify(overrides) !== JSON.stringify(s.overrides)) {
			s.overrides = overrides;
			view.applyAppearance();
		}
		const deck = parseDeck(s.latestText, this.parseOptions(s));
		const following = s.follow && !s.paused;
		view.update({
			deck,
			sourcePath: s.file.path,
			meta: this.metaLines(props),
			line: following || forceFollow ? s.cursorLine : null,
		}).catch((err: unknown) => this.reportError(err));
		this.updateStatus();
	}

	/** Settings of one presentation: plugin settings plus its note's onstage-* properties. */
	settingsFor(view: ProjectionView): OnStageSettings {
		return { ...this.settings, ...(this.sessions.get(view)?.overrides ?? {}) };
	}

	private parseOptions(s: Session): ParseOptions {
		const p = { ...this.settings, ...s.overrides };
		const file = s.file;
		return {
			splitLevel: p.splitLevel,
			cover: p.cover,
			agenda: p.agenda,
			fallbackTitle: file.basename,
			agendaTitle: "",
		};
	}

	/* ------------------------------------------------------------------ */
	/* Editing from the slide                                              */
	/* ------------------------------------------------------------------ */

	/** Current note text: the open editor if there is one, else the last known text. */
	private currentText(s: Session): string {
		return this.editorFor(s.file)?.editor.getValue() ?? s.latestText;
	}

	/**
	 * Markdown source of a slide, from its title line to its last non-empty line,
	 * computed on the current note text so that pending edits are taken into account.
	 */
	sourceForSlide(view: ProjectionView, key: string): { from: number; to: number; text: string } | null {
		const s = this.sessions.get(view);
		if (!s) {
			new Notice(t("editNoNote"));
			return null;
		}
		return slideSource(this.currentText(s), this.parseOptions(s), key);
	}

	private editorFor(file: TFile): MarkdownView | null {
		let found: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!found && leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) found = leaf.view;
		});
		return found;
	}

	/** Write an edit made on the slide back into the note. */
	async applySlideEdit(view: ProjectionView, edit: SlideEdit): Promise<boolean> {
		const s = this.sessions.get(view);
		if (!s) {
			new Notice(t("editNoNote"));
			return false;
		}
		// Stay on the edited slide: pause following before touching the note.
		if (s.follow) {
			s.paused = true;
			s.pausedSlide = view.slideIndexForLine(s.cursorLine);
		}
		s.writing = true;
		try {
			return await this.writeSlideEdit(s, edit);
		} finally {
			s.writing = false;
		}
	}

	private async writeSlideEdit(s: Session, edit: SlideEdit): Promise<boolean> {
		const mv = this.editorFor(s.file);
		let result: string | null = null;
		if (mv) {
			const editor = mv.editor;
			const before = editor.getValue();
			const next = applyEditToLines(before.split("\n"), edit);
			if (next) {
				// Replace only the characters that differ, so undo and the cursor behave naturally.
				const after = next.join("\n");
				let p = 0;
				const max = Math.min(before.length, after.length);
				while (p < max && before[p] === after[p]) p++;
				let q = 0;
				while (q < max - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
				editor.replaceRange(
					after.slice(p, after.length - q),
					editor.offsetToPos(p),
					editor.offsetToPos(before.length - q)
				);
				result = editor.getValue();
			}
		} else {
			let ok = true;
			result = await this.app.vault.process(s.file, (data) => {
				const next = applyEditToLines(data.replace(/\r\n?/g, "\n").split("\n"), edit);
				if (!next) {
					ok = false;
					return data;
				}
				return next.join("\n");
			});
			if (!ok) result = null;
		}
		if (result === null) {
			new Notice(t("editConflict"));
			return false;
		}
		s.latestText = result;
		this.pushNow(s, false);
		this.updateStatus();
		return true;
	}

	/** Open a [[link]] from the slide in the main window, next to the presented note. */
	openNoteLink(linktext: string, sourcePath: string): void {
		const file = this.app.vault.getFileByPath(sourcePath);
		const noteLeaf = file ? this.editorFor(file)?.leaf : null;
		if (noteLeaf) this.app.workspace.setActiveLeaf(noteLeaf, { focus: true });
		void this.app.workspace.openLinkText(linktext, sourcePath, "tab");
	}

	reportError(err: unknown): void {
		console.error("OnStage:", err);
		const msg = err instanceof Error ? err.message : String(err);
		new Notice(`OnStage: ${msg}`, 8000);
	}

	/** The note's properties, keyed by lower-case name (original name kept for labels). */
	private readProperties(text: string): Map<string, { name: string; value: unknown }> {
		const out = new Map<string, { name: string; value: unknown }>();
		const yaml = frontmatterText(text);
		if (!yaml) return out;
		let data: unknown;
		try {
			data = parseYaml(yaml);
		} catch {
			return out;
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) return out;
		for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
			out.set(name.trim().toLowerCase(), { name: name.trim(), value });
		}
		return out;
	}

	/** onstage-* properties that override the settings for this note. */
	private overridesFrom(props: Map<string, { name: string; value: unknown }>): Partial<OnStageSettings> {
		const get = (...keys: string[]) => {
			for (const k of keys) if (props.has(k)) return props.get(k)?.value;
			return undefined;
		};
		const bool = (v: unknown): boolean | undefined => {
			if (typeof v === "boolean") return v;
			if (typeof v === "string") {
				const x = v.trim().toLowerCase();
				if (["true", "yes", "oui", "on"].includes(x)) return true;
				if (["false", "no", "non", "off"].includes(x)) return false;
			}
			return undefined;
		};
		const o: Partial<OnStageSettings> = {};

		const theme = get("onstage-theme");
		if (typeof theme === "string" && ["light", "dark", "auto"].includes(theme.trim().toLowerCase())) {
			o.theme = theme.trim().toLowerCase() as OnStageSettings["theme"];
		}
		const accent = get("onstage-accent", "onstage-couleur");
		if (typeof accent === "string" && accent.trim()) o.accent = accent.trim();

		const split = get("onstage-split", "onstage-decoupage");
		const splitStr = typeof split === "number" ? String(split) : typeof split === "string" ? split.trim().toLowerCase() : "";
		const splitMap: Record<string, number> = { "0": 0, "---": 0, "1": 1, h1: 1, "2": 2, h2: 2, "3": 3, h3: 3 };
		if (splitStr in splitMap) o.splitLevel = splitMap[splitStr];

		const cover = bool(get("onstage-cover", "onstage-page-de-garde"));
		if (cover !== undefined) o.cover = cover;
		const toc = bool(get("onstage-toc", "onstage-sommaire"));
		if (toc !== undefined) o.agenda = toc;
		const progress = bool(get("onstage-progress"));
		if (progress !== undefined) o.progress = progress;

		const size = get("onstage-text-size", "onstage-taille");
		let n = typeof size === "number" ? size : typeof size === "string" ? parseFloat(size) : NaN;
		if (typeof size === "string" && size.trim().endsWith("%")) n = n / 100;
		if (Number.isFinite(n) && n >= 0.5 && n <= 2) o.fontSize = n;
		return o;
	}

	/** Lines shown under the cover title, from the properties listed in the settings. */
	private metaLines(props: Map<string, { name: string; value: unknown }>): string[] {
		const clean = (v: string) => v.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").trim();
		const fmt = (key: string, v: unknown): string => {
			if (Array.isArray(v)) return v.map((x) => fmt(key, x)).filter(Boolean).join(", ");
			if (v instanceof Date) return this.formatDate(v.toISOString().slice(0, 10));
			if (typeof v === "string") {
				if (key.includes("date") || /^\d{4}-\d{2}-\d{2}/.test(v.trim())) return this.formatDate(v.trim());
				return clean(v);
			}
			if (typeof v === "number") return String(v);
			return "";
		};
		const out: string[] = [];
		const keys = this.settings.coverFields
			.split(/[,\n]/)
			.map((k) => k.trim().toLowerCase())
			.filter((k) => k && !k.startsWith("onstage-"));
		for (const key of keys) {
			const prop = props.get(key);
			if (!prop) continue;
			const text = fmt(key, prop.value);
			if (!text || out.some((line) => line.endsWith(text))) continue;
			out.push(this.settings.coverLabels ? `${prop.name.charAt(0).toUpperCase()}${prop.name.slice(1)} : ${text}` : text);
		}
		return out;
	}

	private formatDate(raw: string): string {
		const m = parseMoment(raw, moment.ISO_8601, true);
		return m.isValid() ? m.format(raw.length > 10 ? "LLLL" : "LL") : raw;
	}

	/* ------------------------------------------------------------------ */
	/* Navigation and follow                                               */
	/* ------------------------------------------------------------------ */

	private withView(checking: boolean, run: (v: ProjectionView) => void): boolean {
		const view = this.projection();
		if (!view) return false;
		if (!checking) run(view);
		return true;
	}

	private followCursor(s: Session, line: number): void {
		const view = s.view;
		if (!s.follow || view.isEditing) return;
		const idx = view.slideIndexForLine(line);
		if (s.paused) {
			if (idx === s.pausedSlide) return;
			s.paused = false;
			this.updateStatus();
		}
		view.goToLine(line);
	}

	/**
	 * Run a manual navigation in a projection. Always navigates; also pauses cursor
	 * following until you type in the note or move the cursor to another slide.
	 */
	manualNavigate(view: ProjectionView, fn: () => unknown): void {
		try {
			fn();
		} catch (err) {
			this.reportError(err);
			return;
		}
		this.currentView = view;
		const s = this.sessions.get(view);
		if (s && s.follow) {
			s.paused = true;
			s.pausedSlide = view.slideIndexForLine(s.cursorLine);
		}
		this.updateStatus();
	}

	private clickerKey(dir: 1 | -1): boolean {
		const view = this.projection();
		if (!view || !this.settings.captureClicker) return false;
		this.manualNavigate(view, () => (dir > 0 ? view.next() : view.prev()));
		return true;
	}

	/**
	 * Follow on / off for the current presentation (status bar click, command).
	 * Off is sticky: the projection only moves when you change slides yourself.
	 * A temporary pause (after a manual change of slide) is simply resumed.
	 */
	private toggleFollow(): void {
		const s = this.currentSession();
		if (!s) {
			this.settings.follow = !this.settings.follow;
			void this.saveData(this.settings);
			return;
		}
		if (s.follow && s.paused) {
			s.paused = false;
		} else {
			s.follow = !s.follow;
			s.paused = false;
		}
		if (s.follow) s.view.goToLine(s.cursorLine);
		this.updateStatus();
	}

	private onStatusClick(evt: MouseEvent): void {
		const s = this.currentSession();
		if (!s) return;
		const act = (evt.target as HTMLElement | null)?.closest("[data-act]")?.getAttribute("data-act");
		if (act === "prev") this.manualNavigate(s.view, () => s.view.prev());
		else if (act === "next") this.manualNavigate(s.view, () => s.view.next());
		else this.toggleFollow();
	}

	private updateStatus(): void {
		const el = this.statusEl;
		if (!el) return;
		const s = this.currentSession();
		el.toggleClass("is-hidden", !s);
		if (!s) return;
		el.empty();
		const prev = el.createSpan({ cls: "onstage-status-nav", attr: { "data-act": "prev", "aria-label": t("cmdPrev") } });
		setIcon(prev, "chevron-left");
		const main = el.createSpan({ cls: "onstage-status-main" });
		main.setAttr("aria-label", !s.follow ? t("statusTipOff") : s.paused ? t("statusTipPaused") : t("statusTipFollow"));
		setIcon(main.createSpan({ cls: "onstage-status-icon" }), "presentation");
		const { current, total } = s.slide;
		let state = !s.follow ? t("statusOff") : s.paused ? t("statusPaused") : t("statusFollow");
		if (this.settings.mode === "manual" && s.latestText !== s.displayedText) state += ` - ${t("statusPending")}`;
		main.createSpan({ text: `${current + 1} / ${total}  ${state}` });
		const next = el.createSpan({ cls: "onstage-status-nav", attr: { "data-act": "next", "aria-label": t("cmdNext") } });
		setIcon(next, "chevron-right");
		el.toggleClass("is-paused", s.paused || !s.follow);
	}
}
