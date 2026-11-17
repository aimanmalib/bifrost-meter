"""Redesigned deck: build the render spec from deck/slides.yaml, then put the rendered slides into the deck files.

    python deck/redesign/deck.py spec     # deck/slides.yaml + README criteria table -> deck/build/redesign/spec.json
    python deck/redesign/deck.py splice   # rendered slides -> deck/bifrost-meter.pptx and docs/deck.pdf

`splice` replaces only the slides listed under `redesign.slides` in the YAML. Every other slide in the two files
stays as it is. Run both through deck/redesign/build.sh.
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "deck/build/redesign"
EMU_PER_PX = 12191695 / 1440


def load_yaml() -> dict:
    import yaml

    return yaml.safe_load((ROOT / "deck/slides.yaml").read_text(encoding="utf-8"))


def readme_criteria() -> list[list[str]]:
    """Rows of the README judging criteria table, as plain text.

    Links keep their text. Inside a bracketed group, links into this repository (such as "[Tests](#tests)") are
    dropped, and a group left empty is dropped with its brackets.
    """
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    start = text.index("| Criterion | Evidence |")
    rows = []
    for line in text[start:].splitlines()[2:]:
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.strip("|").split("|")]
        rows.append([cells[0], plain(cells[1])])
    return rows


LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
LOCAL_LINK = re.compile(r"\[([^\]]+)\]\((?!https?://)[^)]+\)")


def plain(md: str) -> str:
    def group(m: re.Match) -> str:
        inner = LINK.sub(r"\1", LOCAL_LINK.sub("", m.group(1)))
        inner = re.sub(r"^[\s,;]*(and\s+)?", "", inner).strip(" ,;")
        return f" ({inner})" if inner else ""

    md = re.sub(r"\s*\(((?:[^()]|\([^()]*\))*)\)", lambda m: group(m) if LINK.search(m.group(1)) else m.group(0), md)
    md = LINK.sub(r"\1", md)
    return md.replace("`", "").strip()


def spec() -> None:
    y = load_yaml()
    r = y["redesign"]
    theme = y["theme"]
    total = len(y["slides"])
    slides = []
    for n in r["slides"]:
        s = dict(y["slides"][n - 1])
        extra = s.pop("redesign")
        s.update(extra, n=n)
        s["label"] = extra.get("label") or s.get("tag", "")
        if s["layout"] == "title":
            brand = s["title"].split(" (")
            s["brand"] = brand[0].split()
            s["brand_small"] = "(" + brand[1]
            left, top, right, _ = s["crop"]
            scale = extra["image_width"] / ((1 - left - right) * extra["image_size"][0])
            nx, ny = extra.get("image_nudge", (0, 0))
            s["image_style"] = (
                f"width:{extra['image_size'][0] * scale:.2f}px;"
                f"left:{-left * extra['image_size'][0] * scale + nx:.2f}px;top:{-top * extra['image_size'][1] * scale + ny:.2f}px"
            )
        elif s["layout"] == "text":
            s["layout"] = "columns"
            cols = []
            for label, body in zip(extra["columns"], s["body"]):
                if body.lower().startswith(label.lower() + ":"):
                    body = body[len(label) + 1 :].strip()
                    body = body[0].upper() + body[1:]
                cols.append({"label": label, "paragraphs": re.split(r"\s(?=Next: )", body)})
            s["columns"] = cols
        elif s["layout"] == "end":
            end = {"title": s["title"], "lines": s["lines"]}
            s.update(layout="table", title=extra["heading"], columns=extra["table_columns"], rows=readme_criteria(), end=end)
        slides.append(s)
    data = {
        "title": r["title"],
        "total": total,
        "footer": y["footer"],
        "links": y["links"],
        "code": r["code"],
        "keep_together": r.get("keep_together", []),
        "colours": {
            "dark": theme["background"],
            "accent": theme["accent"],
            "panel": theme["panel"],
            "panel-ink": theme["panel_ink"],
            "rule-dark": theme["rule"],
        },
        "slides": slides,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "spec.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"spec for slides {r['slides']}")


def set_lines(text_frame, lines: list[str]) -> None:
    """Keep the first run's formatting, one paragraph per line."""
    from copy import deepcopy

    body = text_frame._txBody
    paras = body.findall("{http://schemas.openxmlformats.org/drawingml/2006/main}p")
    template = next((p for p in paras if len(p)), paras[0])
    for p in paras:
        body.remove(p)
    for line in lines:
        p = deepcopy(template)
        runs = p.findall("{http://schemas.openxmlformats.org/drawingml/2006/main}r")
        for extra in runs[1:]:
            p.remove(extra)
        if runs:
            runs[0].find("{http://schemas.openxmlformats.org/drawingml/2006/main}t").text = line
        body.append(p)


def splice() -> None:
    from pptx import Presentation
    from pptx.dml.color import RGBColor  # noqa: F401  (python-pptx loads its oxml types on import)
    from pptx.enum.shapes import MSO_SHAPE
    from pypdf import PdfReader, PdfWriter

    rendered = json.loads((OUT / "rendered.json").read_text(encoding="utf-8"))
    pptx_path = ROOT / "deck/bifrost-meter.pptx"
    prs = Presentation(str(pptx_path))
    for r in rendered:
        slide = prs.slides[r["n"] - 1]
        pic = next(sh for sh in slide.shapes if sh.shape_type == 13)
        _, rid = slide.part.get_or_add_image_part(io.BytesIO((OUT / r["png"]).read_bytes()))
        old_rid = pic._element.blipFill.blip.rEmbed
        pic._element.blipFill.blip.rEmbed = rid
        if old_rid != rid:
            slide.part.drop_rel(old_rid)
        pic._element.nvPicPr.cNvPr.set("descr", "\n".join(r["lines"]))
        box = next(sh for sh in slide.shapes if sh.name == "Slide text")
        set_lines(box.text_frame, r["lines"])
        if slide.has_notes_slide:
            set_lines(slide.notes_slide.notes_text_frame, r["lines"])
        for sh in [sh for sh in slide.shapes if sh.click_action.hyperlink.address]:
            sh._element.getparent().remove(sh._element)
        for link in r["links"]:
            rect = slide.shapes.add_shape(
                MSO_SHAPE.RECTANGLE,
                round(link["x"] * EMU_PER_PX),
                round(link["y"] * EMU_PER_PX),
                round(link["w"] * EMU_PER_PX),
                round(link["h"] * EMU_PER_PX),
            )
            rect.fill.background()
            rect.line.fill.background()
            rect.shadow.inherit = False
            rect.click_action.hyperlink.address = link["href"]
    prs.save(str(pptx_path))

    pdf_path = ROOT / "docs/deck.pdf"
    base = PdfReader(str(pdf_path))
    new = {r["n"]: PdfReader(str(OUT / r["pdf"])).pages[0] for r in rendered}
    writer = PdfWriter()
    for i, page in enumerate(base.pages, start=1):
        writer.add_page(new.get(i, page))
    writer.add_metadata({k: v for k, v in (base.metadata or {}).items() if k in ("/Title", "/Creator", "/Producer")})
    with pdf_path.open("wb") as f:
        writer.write(f)
    print(f"replaced slides {[r['n'] for r in rendered]} in deck/bifrost-meter.pptx and docs/deck.pdf")


if __name__ == "__main__":
    {"spec": spec, "splice": splice}[sys.argv[1]]()
