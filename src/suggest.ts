import { App, TFile, getAllTags, prepareFuzzySearch } from "obsidian";

interface Item {
	label: string;
	detail: string;
	insert: string;
}

interface Trigger {
	kind: "link" | "tag";
	start: number;
	query: string;
}

const MAX_ITEMS = 8;

/**
 * Autocompletion for the Markdown editor on the slide: [[ for notes and files, # for tags.
 * Obsidian's own suggestions only exist in its editors, so this is a small equivalent.
 */
export class SlideSuggest {
	private popup: HTMLElement;
	private items: Item[] = [];
	private selected = 0;
	private trigger: Trigger | null = null;
	private tags: string[] | null = null;

	constructor(
		private app: App,
		private ta: HTMLTextAreaElement,
		private host: HTMLElement,
		private sourcePath: string
	) {
		this.popup = host.createDiv({ cls: "onstage-suggest" });
		this.popup.hide();
		// Capture phase: runs before the editor's own key handling.
		ta.addEventListener("keydown", (e) => this.onKeyDown(e), true);
		ta.addEventListener("input", () => this.update());
		ta.addEventListener("click", () => this.update());
		ta.addEventListener("blur", () => this.close());
		this.popup.addEventListener("mousedown", (e) => {
			// Keep the focus in the editor and pick the clicked item.
			e.preventDefault();
			const row = (e.target as HTMLElement).closest("[data-index]");
			if (row) this.choose(Number(row.getAttribute("data-index")));
		});
	}

	get isOpen(): boolean {
		return this.trigger !== null && this.items.length > 0;
	}

	destroy(): void {
		this.popup.detach();
	}

	close(): void {
		this.trigger = null;
		this.items = [];
		this.popup.hide();
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (!this.isOpen) return;
		const stop = () => {
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		if (e.key === "ArrowDown") {
			stop();
			this.select(this.selected + 1);
		} else if (e.key === "ArrowUp") {
			stop();
			this.select(this.selected - 1);
		} else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
			stop();
			this.choose(this.selected);
		} else if (e.key === "Escape") {
			stop();
			this.close();
		}
	}

	private findTrigger(): Trigger | null {
		const caret = this.ta.selectionStart;
		if (caret !== this.ta.selectionEnd) return null;
		const before = this.ta.value.slice(0, caret);
		const link = /\[\[([^[\]|#\n]*)$/.exec(before);
		if (link) return { kind: "link", start: caret - link[1].length, query: link[1] };
		const tag = /(^|[\s(])#([^\s#,;:!?()[\]{}"']*)$/.exec(before);
		// "#" alone at the start of a line is probably a heading: wait for a character.
		if (tag && (tag[2].length > 0 || tag[1] !== "")) {
			if (tag[1] === "" && tag[2].length === 0) return null;
			return { kind: "tag", start: caret - tag[2].length, query: tag[2] };
		}
		return null;
	}

	private update(): void {
		const trigger = this.findTrigger();
		if (!trigger) {
			this.close();
			return;
		}
		this.trigger = trigger;
		this.items = trigger.kind === "link" ? this.linkItems(trigger.query) : this.tagItems(trigger.query);
		this.selected = 0;
		this.render();
	}

	private linkItems(query: string): Item[] {
		const files = this.app.vault.getFiles().filter((f) => f.path !== this.sourcePath);
		const toItem = (f: TFile): Item => ({
			label: f.extension === "md" ? f.basename : f.name,
			detail: f.parent && f.parent.path !== "/" ? f.parent.path : "",
			insert: this.app.metadataCache.fileToLinktext(f, this.sourcePath, true),
		});
		if (!query.trim()) {
			return files
				.slice()
				.sort((a, b) => b.stat.mtime - a.stat.mtime)
				.slice(0, MAX_ITEMS)
				.map(toItem);
		}
		const match = prepareFuzzySearch(query.trim());
		const scored: { f: TFile; score: number }[] = [];
		for (const f of files) {
			const r = match(f.extension === "md" ? f.path.replace(/\.md$/, "") : f.path);
			if (r) scored.push({ f, score: r.score });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, MAX_ITEMS).map((x) => toItem(x.f));
	}

	private tagItems(query: string): Item[] {
		if (!this.tags) {
			const counts = new Map<string, number>();
			for (const f of this.app.vault.getMarkdownFiles()) {
				const cache = this.app.metadataCache.getFileCache(f);
				const tags = cache ? getAllTags(cache) : null;
				for (const tag of tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
			this.tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
		}
		const toItem = (tag: string): Item => ({ label: tag, detail: "", insert: tag.replace(/^#/, "") });
		if (!query) return this.tags.slice(0, MAX_ITEMS).map(toItem);
		const match = prepareFuzzySearch(query);
		return this.tags
			.map((tag) => ({ tag, r: match(tag.replace(/^#/, "")) }))
			.filter((x) => x.r !== null)
			.sort((a, b) => (b.r?.score ?? 0) - (a.r?.score ?? 0))
			.slice(0, MAX_ITEMS)
			.map((x) => toItem(x.tag));
	}

	private select(i: number): void {
		if (!this.items.length) return;
		this.selected = (i + this.items.length) % this.items.length;
		const rows = this.popup.querySelectorAll(".onstage-suggest-item");
		rows.forEach((row, k) => row.toggleClass("is-selected", k === this.selected));
	}

	private choose(i: number): void {
		const t = this.trigger;
		const item = this.items[i];
		if (!t || !item) return;
		const value = this.ta.value;
		const caret = this.ta.selectionStart;
		let insert = item.insert;
		let end = caret;
		if (t.kind === "link") {
			// Complete the link, reusing closing brackets that are already there.
			if (value.slice(caret, caret + 2) === "]]") end = caret + 2;
			insert = `${insert}]]`;
		} else {
			insert = `${insert} `;
		}
		this.ta.setRangeText(insert, t.start, end, "end");
		this.close();
		this.ta.dispatchEvent(new Event("input"));
		this.close();
	}

	private render(): void {
		if (!this.items.length) {
			this.popup.hide();
			return;
		}
		this.popup.empty();
		this.items.forEach((item, i) => {
			const row = this.popup.createDiv({ cls: "onstage-suggest-item" });
			row.setAttr("data-index", String(i));
			row.toggleClass("is-selected", i === this.selected);
			row.createSpan({ cls: "onstage-suggest-label", text: item.label });
			if (item.detail) row.createSpan({ cls: "onstage-suggest-detail", text: item.detail });
		});
		this.popup.show();
		this.position();
	}

	/** Place the list under the caret, using a hidden copy of the editor to measure it. */
	private position(): void {
		const ta = this.ta;
		const doc = ta.doc;
		const win = ta.win;
		const style = win.getComputedStyle(ta);
		const mirror = doc.createElement("div");
		const props = [
			"boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
			"borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
			"fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize", "wordSpacing",
		] as const;
		for (const p of props) mirror.style[p] = style[p];
		mirror.className = "onstage-suggest-mirror";
		mirror.textContent = ta.value.slice(0, ta.selectionStart);
		const marker = mirror.createSpan({ text: "​" });
		ta.parentElement?.appendChild(mirror);
		const taRect = ta.getBoundingClientRect();
		const mRect = mirror.getBoundingClientRect();
		const kRect = marker.getBoundingClientRect();
		mirror.remove();
		// The mirror sits at the editor's top-left corner (in screen pixels, after scaling).
		const scaleY = taRect.height / Math.max(1, ta.offsetHeight);
		const x = taRect.left + (kRect.left - mRect.left);
		const y = taRect.top + (kRect.bottom - mRect.top) - ta.scrollTop * scaleY;
		const hostRect = this.host.getBoundingClientRect();
		const left = Math.min(x - hostRect.left, hostRect.width - 320);
		let top = y - hostRect.top + 6;
		const height = this.popup.offsetHeight;
		if (top + height > hostRect.height) top = Math.max(0, y - hostRect.top - (kRect.height || 30) - height - 6);
		this.popup.setCssStyles({ left: `${Math.max(8, left)}px`, top: `${top}px` });
	}
}
