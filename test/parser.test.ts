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
// The cover always takes the note title; every heading up to H2 is a slide.
assert.equal(d.slides[0].kind, "cover");
assert.equal(d.slides[0].title, "File");
assert.equal(d.slides[1].kind, "agenda");
assert.deepEqual(d.slides.filter((s) => s.kind === "content" && s.title).map((s) => s.title), ["Réunion de suivi", "Résultats", "Planning"]);
// Table of contents: a single # is skipped, so it lists the ## headings.
assert.deepEqual(d.slides[1].blocks.map((b) => b.text), ["1. Résultats", "2. Planning"]);
assert.ok(d.slides.every((s) => (s.kind as string) !== "actions"));
const shown = JSON.stringify(d.slides.map((s) => [s.title, s.blocks.map((b) => b.text)]));
assert.ok(!shown.includes("secret"));
assert.ok(shown.includes("hidden")); // callouts are ordinary content now
// Blocks keep their original source so they can be edited from the slide.
const withComment = d.slides.flatMap((s) => s.blocks).find((b) => b.raw.includes("secret"));
assert.ok(withComment && withComment.raw !== withComment.text);
const res = d.slides.findIndex((s) => s.title === "Résultats");
assert.equal(d.slides[res].titleLine, 7);
assert.equal(slideForLine(d, 9), res);

// Default since v2: the note title is the cover, each H1 is a slide.
const d1 = parseDeck("---\ndate: 2026-11-12\n---\nIntro\n# Résultats\n- a\n## Détail\n- b\n# Planning\n", { ...opts, splitLevel: 1, fallbackTitle: "Réunion" });
assert.deepEqual(d1.slides.map((s) => [s.kind, s.title]), [["cover", "Réunion"], ["agenda", "Agenda"], ["content", "Résultats"], ["content", "Planning"]]);
assert.equal(d1.slides[0].blocks[0].text, "Intro");
assert.equal(d1.slides[2].blocks[1].kind, "heading");
// Up to H2: # and ## both make slides; the table of contents lists only the highest level present.
const mixed = parseDeck("# Partie 1\n## A\n- a\n## B\n# Partie 2\n## C\n", { ...opts, splitLevel: 2 });
assert.deepEqual(mixed.slides.filter((s) => s.kind === "content").map((s) => s.title), ["Partie 1", "A", "B", "Partie 2", "C"]);
assert.deepEqual(mixed.slides.find((s) => s.kind === "agenda")!.blocks.map((b) => b.text), ["1. Partie 1", "2. Partie 2"]);
const only2 = parseDeck("Intro\n## A\n## B\n### détail\n", { ...opts, splitLevel: 2 });
assert.deepEqual(only2.slides.find((s) => s.kind === "agenda")!.blocks.map((b) => b.text), ["1. A", "2. B"]);
assert.equal(only2.slides.find((s) => s.title === "B")!.blocks[0].kind, "heading");

// Images: image-only paragraphs, consecutive ones merged into one row; note embeds are not images.
import { isImageOnly } from "../src/parser";
assert.ok(isImageOnly("![[a.png]]"));
assert.ok(isImageOnly("![[a.png|400]] ![](https://x.org/b.jpg)"));
assert.ok(!isImageOnly("![[Une autre note]]"));
assert.ok(!isImageOnly("Voir ![[a.png]]"));
const imgs = parseDeck("## A\n![[a.png]]\n\n![[b.png]]\n\nTexte\n\n![[c.png]]\n![[Note]]\n", { ...opts, splitLevel: 2 });
const a = imgs.slides.find((s) => s.title === "A")!;
assert.deepEqual(a.blocks.map((b) => b.kind), ["image", "paragraph", "paragraph"]);
assert.equal(a.blocks[0].text, "![[a.png]]\n\n![[b.png]]");

// The Markdown of a slide is its source lines, comments included.
import { slideSource, slideKeys } from "../src/parser";
const o1 = { ...opts, splitLevel: 1, fallbackTitle: "N" };
const note = "# A\net \n\n## ici aussi ?\n# B\nx %% secret %%\n";
const dk = parseDeck(note, o1);
const keyOf = (title: string) => slideKeys(dk)[dk.slides.findIndex((s) => s.title === title)];
assert.equal(slideSource(note, o1, keyOf("A"))!.text, "# A\net \n\n## ici aussi ?");
assert.equal(slideSource(note, o1, keyOf("B"))!.text, "# B\nx %% secret %%");
console.log("OK");
