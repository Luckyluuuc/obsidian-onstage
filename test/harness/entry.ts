import { ProjectionView } from "../../src/view";
import { applyEditToLines, parseDeck, slideSource } from "../../src/parser";
import { DEFAULT_SETTINGS } from "../../src/settings";

const plugin: any = {
	settings: { ...DEFAULT_SETTINGS, ...(window as any).SETTINGS },
	get presentSettings() { return this.settings; },
	onProjectionClosed() {},
	async saveSettings() { view.applyAppearance(); },
	openNoteLink(t: string) { console.log("OPEN NOTE " + t); },
	onSlideShown() {},
	manualNavigate(_v: unknown, fn: () => void) { fn(); },
	settingsFor() { return this.settings; },
	sourceForSlide(_v: unknown, key: string) {
		return slideSource((window as any).SRC, OPTS, key);
	},
	async applySlideEdit(_v: unknown, edit: any) {
		const next = applyEditToLines((window as any).SRC.split("\n"), edit);
		if (!next) return false;
		(window as any).SRC = next.join("\n");
		await (window as any).present((window as any).SRC, null);
		return true;
	},
};
const OPTS = {
	splitLevel: 2, cover: true, agenda: true, 
	fallbackTitle: "Note", agendaTitle: "",
};
const view = new ProjectionView({} as any, plugin);
if (!location.search.includes("late")) document.body.appendChild(view.containerEl);
const FILES = ["Méthodes numériques", "Bibliographie", "Projets/Article SIAM", "Réunion 12 novembre"].map((p, i) => ({
	path: p + ".md", basename: p.split("/").pop(), name: p.split("/").pop() + ".md", extension: "md",
	parent: { path: p.includes("/") ? p.split("/")[0] : "/" }, stat: { mtime: i },
}));
(view as any).app = {
	workspace: { containerEl: document.body },
	vault: { getFiles: () => FILES, getMarkdownFiles: () => FILES },
	metadataCache: {
		fileToLinktext: (f: any) => f.basename,
		getFileCache: (f: any) => ({ tags: f.basename.startsWith("M") ? ["#these", "#maths"] : ["#these"] }),
	},
};
(window as any).view = view;
(window as any).present = async (src: string, line: number | null) => {
	(window as any).SRC = src;
	const deck = parseDeck(src, OPTS);
	await view.update({ deck, sourcePath: "x.md", meta: ["12 novembre 2026", "Marie Dupont, Jean Martin"], line });
	return deck.slides.length;
};
(window as any).ready = view.onOpen();
