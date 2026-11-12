import { parseDeck, slideForLine } from "../src/parser";
import assert from "node:assert/strict";

const opts = { splitLevel: 2, cover: true, agenda: true, fallbackTitle: "File", agendaTitle: "Agenda" };
const src = `---
date: 2026-11-12
participants: [A, B]
---
# Réunion de suivi
Intro line

## Résultats
- point a
  continued
- point b

  para in b
- [ ] envoyer le draft @A
%% secret %% visible
\`\`\`python
## not a heading
---
\`\`\`
$$
x^2
$$
---
Après break
## Planning
> [!private] mine
> hidden
> [!note] shown
### Sous-titre
1. un
2. deux
`;
const d = parseDeck(src, opts);
console.log(JSON.stringify(d.slides.map(s => ({ k: s.kind, t: s.title, r: [s.start, s.end], b: s.blocks.map(b => [b.kind, b.text]) })), null, 1));
assert.equal(d.slides[0].kind, "cover");
assert.equal(d.slides[0].title, "Réunion de suivi");
assert.equal(d.slides[1].kind, "agenda");
assert.equal(d.slides[2].title, "Résultats");
assert.ok(d.slides.every((s) => (s.kind as string) !== "actions"));
const shown = JSON.stringify(d.slides.map((s) => [s.title, s.blocks.map((b) => b.text)]));
assert.ok(!shown.includes("secret"));
assert.ok(shown.includes("hidden")); // callouts are ordinary content now
// Blocks keep their original source so they can be edited from the slide.
const withComment = d.slides.flatMap((s) => s.blocks).find((b) => b.raw.includes("secret"));
assert.ok(withComment && withComment.raw !== withComment.text);
assert.equal(d.slides[2].titleLine, 7);
assert.equal(slideForLine(d, 9), 2);

// Default since v2: the note title is the cover, each H1 is a slide.
const d1 = parseDeck("---\ndate: 2026-11-12\n---\nIntro\n# Résultats\n- a\n## Détail\n- b\n# Planning\n", { ...opts, splitLevel: 1, fallbackTitle: "Réunion" });
assert.deepEqual(d1.slides.map((s) => [s.kind, s.title]), [["cover", "Réunion"], ["agenda", "Agenda"], ["content", "Résultats"], ["content", "Planning"]]);
assert.equal(d1.slides[0].blocks[0].text, "Intro");
assert.equal(d1.slides[2].blocks[1].kind, "heading");
// The Markdown of a slide is its source lines, comments included.
import { slideSource, slideKeys } from "../src/parser";
const o1 = { ...opts, splitLevel: 1, fallbackTitle: "N" };
const note = "# A\net \n\n## ici aussi ?\n# B\nx %% secret %%\n";
const dk = parseDeck(note, o1);
const keyOf = (title: string) => slideKeys(dk)[dk.slides.findIndex((s) => s.title === title)];
assert.equal(slideSource(note, o1, keyOf("A"))!.text, "# A\net \n\n## ici aussi ?");
assert.equal(slideSource(note, o1, keyOf("B"))!.text, "# B\nx %% secret %%");
console.log("OK");
