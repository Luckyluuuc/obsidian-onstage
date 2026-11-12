# Obsidian in dark mode (its button styles) with a light slide: the Edit button must stay readable.
import asyncio, pathlib
from playwright.async_api import async_playwright
root = pathlib.Path(__file__).resolve().parent
OBSIDIAN_LIKE = "body{--interactive-normal:#2a2a2a;--interactive-hover:#303030;--text-normal:#dadada} button:not(.clickable-icon){background-color:var(--interactive-normal);color:var(--text-normal)} button:not(.clickable-icon):hover{background-color:var(--interactive-hover)}"
def lum(c):
    import re
    v = [float(x) for x in re.findall(r"[\d.]+", c)[:3]]
    if c.startswith("color("): v = [x * 255 for x in v]
    r, g, b = v
    return (0.2126*r+0.7152*g+0.0722*b)/255
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1280, "height": 720})
        await pg.goto((root / ".out/index.html").as_uri())
        await pg.add_style_tag(content=OBSIDIAN_LIKE)
        await pg.evaluate("window.ready")
        await pg.evaluate("([s,l]) => present(s,l)", [(root/"sample.md").read_text(), 8])
        await pg.mouse.move(640, 360); await pg.hover(".onstage-edit-btn"); await pg.wait_for_timeout(250)
        bg = await pg.evaluate("getComputedStyle(document.querySelector('.onstage-edit-btn')).backgroundColor")
        fg = await pg.evaluate("getComputedStyle(document.querySelector('.onstage-edit-btn')).color")
        print("button bg", bg, "text", fg, "| contrast ok:", abs(lum(bg) - lum(fg)) > 0.5)
        await b.close()
asyncio.run(main())
