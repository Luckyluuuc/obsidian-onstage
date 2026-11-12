/* Minimal stand-in for the Obsidian API, enough to run the projection view in a browser. */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

function installDomHelpers(): void {
	const P = HTMLElement.prototype as any;
	const apply = (el: HTMLElement, o: any) => {
		if (!o) return el;
		if (typeof o === "string") o = { cls: o };
		if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
		if (o.text) el.textContent = o.text;
		return el;
	};
	P.createEl = function (tag: string, o?: any) { const el = this.ownerDocument.createElement(tag); apply(el, o); this.appendChild(el); return el; };
	P.createDiv = function (o?: any) { return this.createEl("div", o); };
	P.createSpan = function (o?: any) { return this.createEl("span", o); };
	P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	P.addClass = function (...c: string[]) { this.classList.add(...c); };
	P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
	P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
	P.hasClass = function (c: string) { return this.classList.contains(c); };
	P.setAttr = function (k: string, v: string) { this.setAttribute(k, v); };
	P.detach = function () { this.remove(); };
	P.hide = function () { this.style.display = "none"; };
	P.show = function () { this.style.display = ""; };
	P.setCssStyles = function (st: Record<string, string>) { Object.assign(this.style, st); };
	P.getAttr = function (k: string) { return this.getAttribute(k); };
	P.setText = function (v: string) { this.textContent = v; };
	P.setCssProps = function (props: Record<string, string>) { for (const k in props) this.style.setProperty(k, props[k]); };
	Object.defineProperty(P, "doc", { get() { return this.ownerDocument; } });
	Object.defineProperty(P, "win", { get() { return this.ownerDocument.defaultView; } });
}
installDomHelpers();

export class Component {
	private cbs: (() => void)[] = [];
	private kids: Component[] = [];
	load(): void {}
	unload(): void { this.kids.forEach((k) => k.unload()); this.cbs.forEach((f) => f()); }
	addChild<T extends Component>(c: T): T { this.kids.push(c); c.load(); return c; }
	removeChild<T extends Component>(c: T): T { this.kids = this.kids.filter((k) => k !== c); c.unload(); return c; }
	register(cb: () => void): void { this.cbs.push(cb); }
	registerDomEvent(el: any, type: string, cb: any, o?: any): void { el.addEventListener(type, cb, o); this.register(() => el.removeEventListener(type, cb, o)); }
	registerEvent(): void {}
	registerInterval(id: number): number { this.register(() => window.clearInterval(id)); return id; }
}

export class ItemView extends Component {
	app: any = { workspace: { containerEl: document.body } };
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	constructor(public leaf: any) {
		super();
		this.containerEl = document.createElement("div");
		this.containerEl.className = "workspace-leaf-content";
		this.containerEl.setAttribute("data-type", "onstage-projection");
		this.contentEl = document.createElement("div");
		this.contentEl.className = "view-content";
		this.containerEl.appendChild(this.contentEl);
	}
}

export class WorkspaceLeaf {}

function obsidianize(html: string): string {
	// Mimic Obsidian task list markup.
	return html.replace(/<li>\[( |x)\] ?/g, (_m, c) =>
		`<li class="task-list-item${c === "x" ? " is-checked" : ""}" data-task="${c}"><input type="checkbox" class="task-list-item-checkbox"${c === "x" ? " checked" : ""}>`)
		.replace(/<ul>(\s*<li class="task-list-item)/g, '<ul class="contains-task-list">$1');
}

export const MarkdownRenderer = {
	async render(_app: unknown, src: string, el: HTMLElement): Promise<void> {
		el.innerHTML = obsidianize(md.render(src));
	},
};

export async function finishRenderMath(): Promise<void> {}
export const moment = { locale: () => "fr" };
export class PluginSettingTab {}
export class Setting {}
export type App = unknown;
export type ViewStateResult = unknown;

export class Notice {
	constructor(msg: string) {
		console.log("NOTICE " + msg);
	}
}

export class Scope {
	constructor(_parent?: unknown) {}
	register(): void {}
}

export function setIcon(el: HTMLElement, name: string): void {
	el.textContent = "";
	el.setAttribute("data-icon", name);
}

export function prepareFuzzySearch(q: string) {
	const query = q.toLowerCase();
	return (text: string) => {
		const t = text.toLowerCase();
		let i = 0;
		for (const ch of t) if (ch === query[i]) i++;
		return i === query.length ? { score: -t.length, matches: [] } : null;
	};
}
export function getAllTags(cache: { tags?: string[] }): string[] | null {
	return cache.tags ?? null;
}
export class TFile {}

export const Platform = { isMacOS: true };
