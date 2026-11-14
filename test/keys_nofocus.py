# Arrow keys work right after the projection opens, without clicking it first.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
VIS = ".onstage-slide:not(.onstage-measure) .onstage-counter"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s,l]) => present(s,l)", [(root/"sample.md").read_text(), 8])
        await pg.evaluate("document.activeElement && document.activeElement.blur()")
        print("focus on:", await pg.evaluate("document.activeElement.tagName"))
        c0 = await pg.locator(VIS).inner_text()
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(100)
        c1 = await pg.locator(VIS).inner_text()
        print("arrow without click:", c0, "->", c1)
        await pg.evaluate("view.focusStage()")
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(100)
        print("one press = one slide:", c1, "->", await pg.locator(VIS).inner_text())
        await b.close()
asyncio.run(main())
