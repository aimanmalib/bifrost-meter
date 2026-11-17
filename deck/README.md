# Slides

The slide text lives in `slides.yaml`. The submitted deck (`bifrost-meter.pptx` here and `docs/deck.pdf`) is that text
laid out in HTML and exported with headless Chromium; the PowerPoint file holds one image per slide with clickable links
on top. The closing slide repeats the judging criteria table from the README.

`npm run deck` runs `redesign/build.sh`. It lays out the slides listed under `redesign.slides` in `slides.yaml` as HTML
(`redesign/render.mjs`, `redesign/style.css`), exports each one as an image and a PDF page, and puts them into
`bifrost-meter.pptx` and `docs/deck.pdf` in place of the same slide numbers (`redesign/deck.py`). The other slides in
the two files are left as they are. The closing slide takes its rows from the criteria table in `README.md`. The
rendered pages and the HTML are in `deck/build/redesign/` for checking as images. It needs Node 22, `uv`, npm (for the
two font packages) and the Playwright Chromium browser.

`npm run deck:plain` runs `build.py` and `render.sh`, which produce a plain PowerPoint from the same YAML. They are kept
for checking the text. Running them overwrites `bifrost-meter.pptx` and `docs/deck.pdf` with the plain deck, so do not
run them before a release.
