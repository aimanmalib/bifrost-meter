# Slides

The slide text lives in `slides.yaml`. The submitted deck (`bifrost-meter.pptx` here and `docs/deck.pdf`) is that text
laid out in HTML and exported with headless Chromium; the PowerPoint file holds one image per slide with clickable links
on top. The closing slide repeats the judging criteria table from the README.
`build.py` and `render.sh` produce a plain PowerPoint from the same yaml and are kept for checking the text. Running them
overwrites `bifrost-meter.pptx` and `docs/deck.pdf`.
