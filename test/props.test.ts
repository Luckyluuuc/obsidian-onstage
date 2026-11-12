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
console.log("OK");
