import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path("/home/claude/onstage/test")
VIS = ".onstage-slide:not(.onstage-measure)"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        logs=[]; pg.on("pageerror", lambda e: logs.append("ERR "+str(e))); pg.on("console", lambda m: logs.append(m.text))
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        await pg.evaluate("([s,l]) => present(s,l)", [(root/"sample.md").read_text(), 8])
        await pg.wait_for_timeout(200)
        t0 = await pg.locator(f"{VIS} .onstage-title").inner_text()
        await pg.mouse.move(640, 360)
        await pg.screenshot(path=str(root/".out/btn-hover.png"))
        await pg.click(".onstage-edit-btn")
        await pg.wait_for_timeout(300)
        print("button opens:", await pg.locator(".onstage-source-editor").count()==1, "| same slide:", (await pg.input_value(".onstage-source-editor")).startswith("## "+t0), "| btn:", await pg.inner_text(".onstage-edit-btn"))
        await pg.keyboard.type("\n- via bouton")
        await pg.evaluate("document.querySelector('.onstage-source-editor').blur()")
        await pg.wait_for_timeout(300)
        print("blur keeps open:", await pg.locator(".onstage-source-editor").count()==1, "| saved on blur:", "- via bouton" in await pg.evaluate("window.SRC"), "| hint:", await pg.inner_text(".onstage-source-hint"))
        await pg.click(".onstage-edit-btn")
        await pg.wait_for_timeout(300)
        print("button closes:", await pg.locator(".onstage-source-editor").count()==0, "| slide:", await pg.locator(f"{VIS} .onstage-title").inner_text(), "| btn:", await pg.inner_text(".onstage-edit-btn"))
        # Ctrl+E
        await pg.evaluate("view.rootEl.focus()")
        await pg.keyboard.press("Control+e"); await pg.wait_for_timeout(200)
        o = await pg.locator(".onstage-source-editor").count()==1
        await pg.keyboard.press("Control+e"); await pg.wait_for_timeout(300)
        print("ctrl+e open/close:", o, await pg.locator(".onstage-source-editor").count()==0)
        # agenda slide -> notice
        await pg.evaluate("view.first(); view.next()")
        await pg.click(".onstage-edit-btn"); await pg.wait_for_timeout(200)
        print("agenda notice:", [l for l in logs if "NOTICE" in l][-1:])
        print("errors:", [l for l in logs if l.startswith("ERR")])
        await b.close()
asyncio.run(main())
