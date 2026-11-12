# The slide must fill the window even when the window gets its size after the view opened.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        # Hide the view while it opens (size 0), like a window not laid out yet.
        await pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.id='zero'; s.textContent='.workspace-leaf-content{display:none}'; document.head.appendChild(s); });")
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s,l]) => present(s,l)", [(root/"sample.md").read_text(), 8])
        await pg.evaluate("document.getElementById('zero').remove()")  # the window gets its size, no resize event
        await pg.wait_for_timeout(300)
        box = await pg.locator(".onstage-canvas").bounding_box()
        print("canvas after late sizing:", [round(v) for v in (box["x"], box["y"], box["width"], box["height"])])
        await b.close()
asyncio.run(main())
