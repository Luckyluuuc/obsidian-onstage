import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        src = (root / "sample.md").read_text()
        lines = src.split("\n")
        # Cursor in "Article en préparation"
        line = next(i for i,l in enumerate(lines) if l.startswith("- Choix du journal"))
        await pg.evaluate("([s,l]) => present(s,l)", [src, line])
        title = await pg.evaluate("document.querySelector('.onstage-slide:not(.onstage-measure) .onstage-title').textContent")
        print("follow ->", title)
        # Simulate typing a new bullet char by char under this topic
        base = lines[:line+1]; rest = lines[line+1:]
        typed = "- Marie propose de viser JCP, Jean préfère SIAM"
        import time
        t0 = time.time()
        for k in range(1, len(typed)+1, 3):
            s = "\n".join(base + [typed[:k]] + rest)
            await pg.evaluate("([s,l]) => present(s,l)", [s, line+1])
        dt = (time.time()-t0)/(len(typed)/3)
        body = await pg.evaluate("document.querySelector('.onstage-slide:not(.onstage-measure) .onstage-flow').innerText")
        print("avg update ms", round(dt*1000,1))
        print("contains typed:", "Jean préfère" in body)
        frags = await pg.evaluate("document.querySelectorAll('.onstage-fragment').length")
        print("fragments in DOM", frags)
        # follow to the long notes, page 2 (line of 'quatorze')
        l2 = next(i for i,l in enumerate(lines) if "quatorze" in l)
        await pg.evaluate("([s,l]) => present(s,l)", [src, l2])
        await pg.wait_for_timeout(200)
        cont = await pg.evaluate("!!document.querySelector('.onstage-slide:not(.onstage-measure) .onstage-continued')")
        print("follow to continued page:", cont)
        # go to cover line 0
        await pg.evaluate("view.goToLine(0)")
        k = await pg.evaluate("document.querySelector('.onstage-slide:not(.onstage-measure)').className")
        print("line 0 ->", k)
        print("errors:", errs)
        await b.close()
asyncio.run(main())
