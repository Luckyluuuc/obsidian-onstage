import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
VIS = ".onstage-slide:not(.onstage-measure)"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        logs = []
        pg.on("console", lambda m: logs.append(m.text))
        pg.on("pageerror", lambda e: logs.append("ERR " + str(e)))
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        src = (root / "sample.md").read_text().replace("## Questions diverses", "## Questions diverses\n%% prive %%")
        lines = src.split("\n")
        line = next(i for i, l in enumerate(lines) if l.startswith("- Les simulations"))
        await pg.evaluate("([s,l]) => present(s,l)", [src, line])
        await pg.wait_for_timeout(200)
        await pg.evaluate("view.rootEl.focus()")

        # 1. Ctrl+E opens the raw Markdown of the slide
        await pg.keyboard.press("Control+e")
        await pg.wait_for_timeout(250)
        val = await pg.input_value(".onstage-source-editor")
        print("1 source:\n" + val)
        await pg.screenshot(path=str(root / ".out/source-mode.png"))

        # 2. Edit and go back with Ctrl+E
        await pg.keyboard.type("\n- Ajout en Markdown **gras**")
        await pg.keyboard.press("Control+e")
        await pg.wait_for_timeout(300)
        s = await pg.evaluate("window.SRC")
        print("2 written:", "- Ajout en Markdown **gras**" in s, "| editor gone:", await pg.locator(".onstage-source-editor").count() == 0)
        body = await pg.locator(f"{VIS} .onstage-flow").inner_text()
        print("  slide shows it:", "Ajout en Markdown gras" in body)
        idx = s.split("\n").index("- Ajout en Markdown **gras**")
        print("  context:", s.split("\n")[idx-1:idx+3])

        # 3. Escape also goes back, unchanged text writes nothing
        before = s
        await pg.evaluate("view.rootEl.focus()")
        await pg.keyboard.press("Control+e")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(200)
        print("3 escape, unchanged:", (await pg.evaluate("window.SRC")) == before)

        # 4. Rename title in Markdown mode
        await pg.evaluate("view.rootEl.focus()")
        await pg.keyboard.press("Control+e")
        await pg.evaluate("""() => { const ta = document.querySelector('.onstage-source-editor'); ta.value = ta.value.replace('## Résultats du chapitre 2', '## Résultats'); }""")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(300)
        print("4 title:", await pg.locator(f"{VIS} .onstage-title").inner_text())

        # 5. A slide with a %% comment can be edited too
        while "Questions diverses" not in (await pg.locator(f"{VIS} .onstage-title").inner_text()):
            await pg.evaluate("view.next()")
        await pg.evaluate("view.rootEl.focus()")
        await pg.keyboard.press("Control+e")
        await pg.wait_for_timeout(150)
        print("5 slide with a comment opens too:", await pg.locator(".onstage-source-editor").count() == 1)
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(200)

        # 6. Navigation keys still work
        t0 = await pg.locator(f"{VIS} .onstage-title").inner_text()
        await pg.keyboard.press("ArrowLeft")
        print("6 nav:", t0, "->", await pg.locator(f"{VIS} .onstage-title").inner_text())
        print("logs:", [l for l in logs if "proxy" not in l.lower()])
        await b.close()
asyncio.run(main())
