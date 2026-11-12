# Like Obsidian: the view is created and opened outside the projection window, then moved into it.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto((root / ".out/index.html").as_uri() + "?late=1")
        await pg.evaluate("window.ready")
        await pg.evaluate("([s,l]) => present(s,l)", [(root/"sample.md").read_text(), 8])
        await pg.evaluate("""() => new Promise((res) => {
            const f = document.createElement('iframe');
            f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
            document.body.appendChild(f);
            const d = f.contentDocument;
            d.open(); d.write('<!doctype html><html><head><link rel="stylesheet" href="' + new URL('../../styles.css', location.href).href + '"><style>html,body{margin:0;height:100%}.workspace-leaf-content,.view-content{position:absolute;inset:0}</style></head><body></body></html>'); d.close();
            setTimeout(() => { d.body.appendChild(view.containerEl); res(); }, 200);
        })""")
        await pg.wait_for_timeout(1200)
        box = await pg.frame_locator("iframe").locator(".onstage-canvas").bounding_box()
        print("canvas in the moved window:", [round(v) for v in (box["x"], box["y"], box["width"], box["height"])], "errors:", errs)
        await pg.screenshot(path=str(root/".out/popout.png"))
        await b.close()
asyncio.run(main())
