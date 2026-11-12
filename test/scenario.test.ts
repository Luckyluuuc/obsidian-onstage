// Realistic sequences on the follow logic, printed step by step to spot odd behaviour.
(globalThis as any).window = globalThis;
import OnStagePlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { parseDeck, slideForLine } from "../src/parser";
import assert from "node:assert/strict";

const p = new (OnStagePlugin as any)();
p.settings = { ...DEFAULT_SETTINGS, mode: "calm", calmDelay: 50 };
p.app = { workspace: { iterateAllLeaves() {} } };
p.saveData = async () => {};
let status = "";
p.updateStatus = function () {
	const s = this.currentSession();
	status = s ? `${this.settings.follow ? (s.paused ? "PAUSED" : "FOLLOW") : "FREE"}` : "-";
};
const FILE = { basename: "Note", path: "n.md" };
let text = "# A\n- a1\n\n# B\n- b1\n\n# C\n- c1\n";
let deck = parseDeck(text, p.parseOptions({ file: FILE, overrides: {} }));
let shown = 0;
let pushes = 0;
const names = () => deck.slides.map((s) => s.title ?? s.kind);
const view: any = {
	isEditing: false,
	slideIndexForLine: (l: number) => slideForLine(deck, l),
	goToLine: (l: number) => { shown = slideForLine(deck, l); },
	next: () => { shown = Math.min(shown + 1, deck.slides.length - 1); },
	update: async (u: any) => { pushes++; deck = u.deck; if (u.line !== null) shown = slideForLine(deck, u.line); },
	applyAppearance() {},
};
p.projection = () => view;
p.currentView = view;
const sess = p.bind(view, FILE, text, 1);
const log = (what: string) => console.log(`${what.padEnd(48)} shows ${names()[shown]}  [${status}]`);
const type = (line: number, newText: string) => { text = newText; p.onEditorUpdate(sess, text, line); };
const move = (line: number) => p.onEditorUpdate(sess, null, line);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
	p.pushNow(sess, true); await wait(5); p.updateStatus(); log("start, cursor in A");
	move(4); log("cursor moves to B (click in note)");
	p.manualNavigate(view, () => view.next()); log("presenter clicks projection: next slide");
	move(5); log("cursor moves inside B (same slide)");
	move(1); log("cursor moves to A");
	p.manualNavigate(view, () => view.next()); log("click next again");
	type(1, text.replace("- a1", "- a1 z")); await wait(80); log("types in A");
	assert.equal(names()[shown], "A");
	p.togglePause(); log("clicks status bar");
	assert.ok(sess.paused && p.settings.follow, "status click pauses, never turns the setting off");
	p.togglePause(); log("clicks status bar again");
	assert.ok(!sess.paused);

	// Calm mode: a character typed after moving to another line must not appear at once.
	pushes = 0;
	move(7);
	type(7, text.replace("- c1", "- c1 q"));
	assert.equal(pushes, 0, "first character on another line leaked to the projection");
	await wait(80);
	assert.equal(pushes, 1);
	log("typed on C, shown after the pause");
	// Enter: new empty line, the finished line is shown at once.
	pushes = 0;
	type(8, text.replace("- c1 q", "- c1 q\n"));
	assert.equal(pushes, 1, "after Enter the finished line should be shown at once");
	log("Enter: previous line shown at once");
	console.log("OK scenario");
	p.clearTimer(sess);
})();
