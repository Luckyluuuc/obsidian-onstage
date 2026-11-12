import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path("/home/claude/onstage/test")
VIS = ".onstage-slide:not(.onstage-measure)"
SRC = """## Liens
- Article : [le papier](https://example.com/paper)
- Note : <a class="internal-link" data-href="Autre note">Autre note</a>

## Suite
- x
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        logs=[]; pg.on("console", lambda m: logs.append(m.text)); pg.on("pageerror", lambda e: logs.append("ERR "+str(e)))
        await pg.add_init_script("window.open = (u) => console.log('WINDOW OPEN ' + u);")
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s]) => present(s, 1)", [SRC])
        await pg.wait_for_timeout(200)
        t0 = await pg.locator(f"{VIS} .onstage-title").inner_text()
        await pg.locator(f"{VIS} a", has_text="le papier").click(); await pg.wait_for_timeout(400)
        await pg.locator(f"{VIS} a", has_text="Autre note").click(); await pg.wait_for_timeout(400)
        await pg.locator(f"{VIS} a", has_text="le papier").dblclick(); await pg.wait_for_timeout(400)
        print("slide unchanged:", t0 == await pg.locator(f"{VIS} .onstage-title").inner_text(), "| no editor:", await pg.locator(".onstage-source-editor").count()==0)
        print([l for l in logs if "OPEN" in l or "ERR" in l])
        await b.close()
asyncio.run(main())
