// Editing a slide from the projection must not make the projection jump to the note cursor.
(globalThis as any).window = globalThis;
import assert from "node:assert/strict";
import OnStagePlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { parseDeck, slideForLine } from "../src/parser";

const p = new (OnStagePlugin as any)();
p.settings = { ...DEFAULT_SETTINGS, mode: "calm" };
p.app = { workspace: { iterateAllLeaves() {} } };
p.updateStatus = () => {};

let text = "# A\n- a1\n\n# B\n- b1\n\n# C\n- c1\n";
const FILE = { basename: "Note", path: "n.md" };
const opts = () => p.parseOptions({ file: FILE, overrides: {} });
let deck = parseDeck(text, opts());
const jumps: number[] = [];
let shown = slideForLine(deck, 6); // the projection shows slide C
const view = {
	isEditing: false,
	slideIndexForLine: (l: number) => slideForLine(deck, l),
	goToLine: (l: number) => { shown = slideForLine(deck, l); jumps.push(l); },
	update: async (u: any) => { deck = u.deck; },
	applyAppearance() {},
};
p.projection = () => view;
let sess: any;
// The note editor: cursor on line 1 (slide A). Writing to it fires an editor update, like CodeMirror does.
const editor = {
	getValue: () => text,
	offsetToPos: (o: number) => o,
	replaceRange(ins: string, from: number, to: number) {
		text = text.slice(0, from) + ins + text.slice(to);
		p.onEditorUpdate(sess, text, 1);
	},
};
p.editorFor = () => ({ editor, leaf: {} });
sess = p.bind(view, FILE, text, 1);

void (async () => {
const ok = await p.applySlideEdit(view, { kind: "replace", from: 6, to: 7, expected: "# C\n- c1", text: "# C\n- c1\n- c2" });
assert.equal(ok, true);
assert.ok(text.includes("- c2"));
assert.deepEqual(jumps, [], "projection jumped to the note cursor: " + JSON.stringify(jumps));
assert.equal(shown, slideForLine(deck, 6));
// Then the presenter types in the note (slide A): the projection must come back to A.
p.onEditorUpdate(sess, text.replace("- a1", "- a1 x"), 1);
assert.equal(shown, slideForLine(deck, 1), "typing in the note must bring the projection to the slide being written");
// Manual navigation, then cursor moves inside the same slide without typing: stays paused.
p.manualNavigate(view, () => { shown = 99; });
p.onEditorUpdate(sess, null, 1);
assert.equal(shown, 99);
p.clearTimer(sess);

// Two presentations: each note drives only its own tab.
const pushed: string[] = [];
const mkView = (name: string) => ({ isEditing: false, slideIndexForLine: () => 0, goToLine() {}, applyAppearance() {}, update: async () => { pushed.push(name); } });
const v1 = mkView("one"), v2 = mkView("two");
const s1 = p.bind(v1, { basename: "One", path: "one.md" }, "# X\n", 0);
const s2 = p.bind(v2, { basename: "Two", path: "two.md" }, "# Y\n", 0);
assert.equal(p.sessionForFile("two.md"), s2);
pushed.length = 0;
p.settings.mode = "direct";
p.onEditorUpdate(p.sessionForFile("two.md"), "# Y\n- new", 1);
p.pushNow(s2, false);
assert.deepEqual(pushed, ["two"]);
p.onProjectionClosed(v2);
assert.equal(p.sessionForFile("two.md"), undefined);
assert.equal(p.sessionForFile("one.md"), s1);
p.clearTimer(s1);
console.log("OK follow");
})();
