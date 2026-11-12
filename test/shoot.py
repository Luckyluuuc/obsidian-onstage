import asyncio, sys, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
async def main():
    theme = sys.argv[1] if len(sys.argv) > 1 else "light"
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        msgs = []
        pg.on("console", lambda m: msgs.append(m.text))
        pg.on("pageerror", lambda e: msgs.append("ERR " + str(e)))
        await pg.add_init_script(f"window.SETTINGS = {{theme: '{theme}'}}")
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.evaluate("window.ready")
        src = (root / "sample.md").read_text()
        n = await pg.evaluate("([s]) => present(s, 0)", [src])
        await pg.wait_for_timeout(300)
        i = 0
        while True:
            await pg.wait_for_timeout(350)
            await pg.screenshot(path=str(root / f".out/{theme}-{i:02d}.png"))
            moved = await pg.evaluate("view.next()")
            i += 1
            if not moved or i > 20: break
        print("slides", n, "shots", i)
        print("\n".join(msgs))
        await b.close()
asyncio.run(main())
