// Lay out the slides listed in deck/build/redesign/spec.json as HTML and export each with headless Chromium:
// a 2880x1620 PNG (for the PowerPoint file), a one-page PDF, and the slide text and link boxes (for deck.py splice).
// Run through deck/redesign/build.sh, which writes spec.json first.
/* global document -- page.evaluate callbacks run in the browser */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "deck/build/redesign");
const spec = JSON.parse(readFileSync(join(out, "spec.json"), "utf8"));
mkdirSync(out, { recursive: true });
copyFileSync(join(here, "style.css"), join(out, "style.css"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escape text, then wrap code phrases in <code> and link phrases in <a>. */
function rich(text, { links = true } = {}) {
  let html = esc(text);
  html = html.replace(new RegExp(spec.code, "g"), (m) => `<code>${m}</code>`);
  if (links) {
    const phrases = Object.keys(spec.links).sort((a, b) => b.length - a.length);
    const seen = new Set();
    for (const phrase of phrases) {
      if ([...seen].some((p) => p.includes(phrase))) continue;
      if (!html.includes(esc(phrase))) continue;
      seen.add(phrase);
      html = html.split(esc(phrase)).join(`<a href="${esc(spec.links[phrase])}">${esc(phrase)}</a>`);
    }
  }
  for (const phrase of spec.keep_together) html = html.split(esc(phrase)).join(esc(phrase).replace(/ /g, "&nbsp;"));
  return html;
}

const pageNo = (n) => `${String(n).padStart(2, "0")} / ${String(spec.total).padStart(2, "0")}`;
const top = (s) => `<div class="top mono"><span>${esc(s.label)}</span><span>${pageNo(s.n)}</span></div>`;
const bottom = (s) => `<div class="bottom mono"><span>${esc(spec.footer)}</span><span>${esc(s.section)}</span></div>`;

const layouts = {
  title: (s) => `<div class="slide dark">
    <div class="brand"><div class="big">${s.brand.map(esc).join("<br>")}</div><div class="small">${esc(s.brand_small)}</div></div>
    <p class="lede">${esc(s.subtitle)}</p>
    <div class="stats">${s.stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${l.split("\n").map(esc).join("<br>")}</span></div>`).join("")}</div>
    <div class="facts">${s.facts.map(([t, u]) => `<div><a href="${esc(u)}">${esc(t)}</a></div>`).join("")}</div>
    <div class="shot"><img src="${pathToFileURL(join(root, s.image)).href}" style="${s.image_style}" alt=""></div>
    <div class="foot3 mono">${s.footer3.map((col) => `<div>${col.map((l) => (spec.links[l] ? `<a class="keep" href="${esc(spec.links[l])}">${esc(l)}</a>` : esc(l))).join("<br>")}</div>`).join("")}</div>
  </div>`,
  table: (s) => `<div class="slide light" style="--h1-top:${s.h1_top}px;--h1-size:${s.h1_size}px">${top(s)}
    <h1>${esc(s.title)}</h1>
    <div class="sheet" style="top:${s.table_top}px">
    <table style="font-size:${s.cell_size}px;line-height:${s.cell_line}px">
      <colgroup><col style="width:${s.first_col}px"><col></colgroup>
      <tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>
      ${s.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:${s.cell_pad}">${rich(c)}</td>`).join("")}</tr>`).join("")}
    </table>
    ${s.note ? `<p class="note" style="margin-top:${s.note_gap}px">${rich(s.note, { links: false })}</p>` : ""}
    </div>
    ${s.end ? `<div class="thanks">${esc(s.end.title)}</div><div class="repo"><p>${esc(s.end.lines[0])}</p>${rich(s.end.lines[1])}</div>` : ""}
    ${bottom(s)}
  </div>`,
  columns: (s) => `<div class="slide dark">${top(s)}
    <h1>${esc(s.title)}</h1>
    <div class="cols">${s.columns.map((c, i) => `<div class="col${i === s.columns.length - 1 ? " hot" : ""}"><h2 class="mono">${esc(c.label)}</h2>${c.paragraphs.map((p) => `<p>${rich(p)}</p>`).join("")}</div>`).join("")}</div>
    ${bottom(s)}
  </div>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
const results = [];
for (const s of spec.slides) {
  const name = `slide-${String(s.n).padStart(2, "0")}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(spec.title)}</title>
    <link rel="stylesheet" href="style.css"><style>:root{${Object.entries(spec.colours).map(([k, v]) => `--${k}:#${v}`).join(";")}}</style>
    </head><body>${layouts[s.layout](s)}</body></html>`;
  const file = join(out, `${name}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".slide *")]
      .filter((e) => { const r = e.getBoundingClientRect(); return e.tagName !== "IMG" && !e.closest(".shot") && (r.right > 1440.5 || r.bottom > 810.5); })
      .map((e) => e.textContent.slice(0, 40)));
  if (overflow.length) throw new Error(`${name}: text runs off the slide: ${overflow.join(" | ")}`);
  await page.screenshot({ path: join(out, `${name}.png`) });
  // 1440 x 810 pt pages, the size of the other slides in docs/deck.pdf.
  await page.pdf({ path: join(out, `${name}.pdf`), width: "1920px", height: "1080px", scale: 4 / 3, printBackground: true });
  const meta = await page.evaluate(() => ({
    lines: document.body.innerText.replace(/\u00a0/g, " ").split("\n").map((l) => l.trim()).filter(Boolean),
    links: [...document.querySelectorAll("a[href]")].flatMap((a) =>
      [...a.getClientRects()].map((r) => ({ href: a.href, x: r.x, y: r.y, w: r.width, h: r.height }))),
  }));
  results.push({ n: s.n, png: `${name}.png`, pdf: `${name}.pdf`, ...meta });
}
await browser.close();
writeFileSync(join(out, "rendered.json"), JSON.stringify(results, null, 2));
console.log(`rendered ${results.length} slides to deck/build/redesign/`);
