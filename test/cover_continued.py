# Content before the first slide heading that overflows the cover continues with a "continued" label.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
NOTE = "\n".join(f"- Ligne {i} d'introduction assez longue pour remplir la page de garde" for i in range(30)) + "\n## Diapo\n- x\n"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s]) => present(s, 0)", [NOTE])
        await pg.evaluate("view.next()"); await pg.wait_for_timeout(200)
        print("cover page 2 has the continued label:", await pg.locator(".onstage-slide:not(.onstage-measure) .onstage-continued").count() == 1)
        await b.close()
asyncio.run(main())
