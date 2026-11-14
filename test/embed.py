# An embedded note scrolls, keeps its position when the slide is refreshed, and clicks do not change slides.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
LINES = "".join(f"<p>Ligne {i} de la note intégrée</p>" for i in range(60))
NOTE = f"""## Avec une note intégrée
Texte avant.

<div class="internal-embed markdown-embed"><div class="markdown-embed-content">{LINES}</div></div>

## Suite
- x
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s]) => present(s, 1)", [NOTE])
        await pg.wait_for_timeout(300)
        sel = ".onstage-slide:not(.onstage-measure) .markdown-embed-content"
        box = await pg.locator(sel).bounding_box()
        await pg.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
        await pg.mouse.wheel(0, 600)
        await pg.wait_for_timeout(300)
        top1 = await pg.evaluate(f"document.querySelector('{sel}').scrollTop")
        print("scrolls with the wheel:", top1 > 0, top1)
        # Refresh (as when typing in the note elsewhere).
        await pg.evaluate("([s]) => present(s, null)", [NOTE.replace("- x", "- x y")])
        await pg.wait_for_timeout(300)
        top2 = await pg.evaluate(f"document.querySelector('{sel}').scrollTop")
        print("position kept after refresh:", top2 == top1, top2)
        t0 = await pg.locator(".onstage-slide:not(.onstage-measure) .onstage-title").inner_text()
        await pg.mouse.click(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
        await pg.wait_for_timeout(300)
        print("click inside does not change slide:", t0 == await pg.locator(".onstage-slide:not(.onstage-measure) .onstage-title").inner_text())
        await pg.screenshot(path=str(root / ".out/embed.png"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
