// Tests the property handling of the plugin with a minimal Obsidian stub.
import assert from "node:assert/strict";
import OnStagePlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

const p = new (OnStagePlugin as any)();
p.settings = { ...DEFAULT_SETTINGS };
const note = `---
date: 2026-11-12
participants: ["[[Marie Dupont]]", Jean Martin]
Lieu: Salle B12
onstage-theme: dark
onstage-sommaire: non
onstage-split: h1
onstage-taille: 120%
tags: [these]
---
# Titre
`;
const props = p.readProperties(note);
const o = p.overridesFrom(props);
assert.deepEqual(o, { theme: "dark", splitLevel: 1, agenda: false, fontSize: 1.2 });
p.settings.coverFields = "sous-titre, date, participants, lieu";
assert.equal(DEFAULT_SETTINGS.coverFields, "subtitle, author, date"); // English by default
const meta = p.metaLines(props);
console.log(meta);
assert.equal(meta.length, 3);
assert.equal(meta[1], "Marie Dupont, Jean Martin");
assert.equal(meta[2], "Salle B12");
p.settings.coverLabels = true;
assert.equal(p.metaLines(props)[2], "Lieu : Salle B12");
const view = {};
p.sessions = new Map([[view, { overrides: o }]]);
assert.equal(p.settingsFor(view).theme, "dark");
assert.equal(p.settingsFor(view).follow, true);
// Settings from before v5 with H1 move to H2 (headings up to the level make slides).
void (async () => {
	const q = new (OnStagePlugin as any)();
	q.loadData = async () => ({ settingsVersion: 4, splitLevel: 1 });
	await q.loadSettings();
	assert.equal(q.settings.splitLevel, 2);
	const r = new (OnStagePlugin as any)();
	r.loadData = async () => ({ settingsVersion: 5, splitLevel: 1 });
	await r.loadSettings();
	assert.equal(r.settings.splitLevel, 1, "a choice made after v5 is kept");
	console.log("OK");
})();
