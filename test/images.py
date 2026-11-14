import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
NOTE = """## Une image seule
![](wide.png)

## Deux images à la suite
![](wide.png)

![](tall.png)

## Texte et image réduite
- Un point avant l'image
- Un autre point

![schéma|300](wide.png)
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s]) => present(s, 1)", [NOTE])
        for i in range(3):
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=str(root / f".out/img-{i}.png"))
            boxes = await pg.evaluate("[...document.querySelectorAll('.onstage-slide:not(.onstage-measure) .onstage-flow img')].map(i => { const r = i.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })")
            cls = await pg.evaluate("document.querySelector('.onstage-slide:not(.onstage-measure)').className")
            print(i, cls, boxes)
            await pg.evaluate("view.next()")
        print("errors:", errs)
        await b.close()
asyncio.run(main())
