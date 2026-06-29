#!/usr/bin/env node
/* CJK / Unicode Failure Corpus - static generator. Zero dependencies.
   Reads data/corpus.json, writes index.html, e/<id>.html, sitemap.xml,
   robots.txt and .nojekyll. Run: node build.mjs */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = "https://greymoth-jp.github.io/cjk-failure-corpus";
const TODAY = new Date().toISOString().slice(0, 10);

const data = JSON.parse(readFileSync(join(ROOT, "data", "corpus.json"), "utf8"));
const { meta, categories, entries } = data;

const CAT_ORDER = [
  "ime-composition",
  "kana-romaji",
  "width-normalization",
  "surrogate-emoji",
  "segmentation",
  "numeral",
  "locale-leftover",
  "unicode-range",
  "regex-roundtrip",
  "codegen-escape",
  "encoding",
];

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const attr = (s = "") => esc(s).replace(/'/g, "&#39;");

// --- integrity check: every entry must carry the fields we publish ----------
const REQUIRED = ["id", "title", "library", "repo", "url", "status", "category", "symptom", "repro", "fix"];
const seen = new Set();
for (const e of entries) {
  for (const k of REQUIRED) {
    if (!e[k] || String(e[k]).trim() === "") throw new Error(`entry ${e.id || "?"} missing field: ${k}`);
  }
  if (!categories[e.category]) throw new Error(`entry ${e.id} has unknown category: ${e.category}`);
  if (!/^https:\/\/github\.com\/.+\/(pull|issues)\/\d+$/.test(e.url)) throw new Error(`entry ${e.id} has a non-PR url: ${e.url}`);
  if (!["open", "merged", "closed"].includes(e.status)) throw new Error(`entry ${e.id} bad status: ${e.status}`);
  if (seen.has(e.id)) throw new Error(`duplicate id: ${e.id}`);
  seen.add(e.id);
}

const mergedCount = entries.filter((e) => e.status === "merged").length;
const libCount = new Set(entries.map((e) => e.repo)).size;
const libraries = [...new Set(entries.map((e) => e.library))].sort((a, b) =>
  a.toLowerCase().localeCompare(b.toLowerCase())
);

// --- shared fragments -------------------------------------------------------
const head = (title, desc, canonical, extraLd = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${attr(meta.title)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(desc)}">
<link rel="preload" href="/cjk-failure-corpus/fonts/CourierPrime-Regular.ttf" as="font" type="font/ttf" crossorigin>
${extraLd}
<link rel="stylesheet" href="${canonical.includes("/e/") ? "../assets/style.css" : "assets/style.css"}">
</head>`;

function statusBadge(status) {
  return `<span class="badge badge--${status}">${status}</span>`;
}

function entryCard(e, { heading = "h3", link = true } = {}) {
  const stackTags = (e.stack || [])
    .map((s) => `<span class="tag tag--stack">${esc(s)}</span>`)
    .join("");
  const titleInner = link
    ? `<a href="e/${esc(e.id)}.html">${esc(e.title)}</a>`
    : esc(e.title);
  const authored = e.authored !== false;
  const citedTag = authored ? "" : `<span class="tag tag--cited">cited</span>`;
  const linkLabel = authored
    ? (e.status === "merged" ? "Merged PR" : e.status === "closed" ? "Closed PR" : "Fix PR")
    : "Upstream issue";
  const repoUrl = `https://github.com/${esc(e.repo)}`;
  const searchHay = attr(
    [e.title, e.library, e.repo, e.symptom, e.repro, e.fix, categories[e.category].label, (e.stack || []).join(" "), authored ? "pull request" : "cited upstream issue"]
      .join(" ")
      .toLowerCase()
  );
  return `<article class="entry" id="${esc(e.id)}" data-cat="${esc(e.category)}" data-lib="${attr(e.library)}" data-search="${searchHay}">
  <div class="entry-top">
    <span class="tag">${esc(categories[e.category].label)}</span>
    ${stackTags}
    ${citedTag}
    ${statusBadge(e.status)}
  </div>
  <${heading} class="entry-title">${titleInner}</${heading}>
  <p class="lib-line"><span class="lib">${esc(e.library)}</span> &middot; <a href="${repoUrl}">${esc(e.repo)}</a></p>
  <div class="field">
    <span class="field-label">Symptom</span>
    <p>${esc(e.symptom)}</p>
  </div>
  <div class="field">
    <span class="field-label">Minimal repro</span>
    <pre class="repro">${esc(e.repro)}</pre>
  </div>
  <div class="field">
    <span class="field-label">Fix</span>
    <p>${esc(e.fix)}</p>
  </div>
  <div class="entry-foot">
    <a class="pr-link" href="${esc(e.url)}">${linkLabel} &rarr;</a>
    <a class="anchor-link" href="#${esc(e.id)}">#${esc(e.id)}</a>
  </div>
</article>`;
}

// --- index ------------------------------------------------------------------
const idxDesc =
  `${entries.length} real CJK, IME, and Unicode/text-handling bugs in open-source libraries, ` +
  `each with a minimal repro, the affected library, and the fix. Searchable, filterable.`;

const idxLd = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: meta.title,
  description: idxDesc,
  url: BASE + "/",
  isPartOf: { "@type": "WebSite", name: meta.title, url: BASE + "/" },
})}</script>`;

const catSections = CAT_ORDER.filter((c) => entries.some((e) => e.category === c))
  .map((cat) => {
    const list = entries.filter((e) => e.category === cat);
    const cards = list.map((e) => entryCard(e)).join("\n");
    return `<section class="cat-section" data-cat-section="${esc(cat)}">
  <div class="wrap">
    <div class="cat-head">
      <h2 id="cat-${esc(cat)}">${esc(categories[cat].label)}</h2>
      <span class="cat-n">${list.length} ${list.length === 1 ? "entry" : "entries"}</span>
    </div>
    <p class="cat-blurb">${esc(categories[cat].blurb)}</p>
    ${cards}
  </div>
</section>`;
  })
  .join("\n");

const catOptions = CAT_ORDER.filter((c) => entries.some((e) => e.category === c))
  .map((c) => `<option value="${esc(c)}">${esc(categories[c].label)}</option>`)
  .join("");
const libOptions = libraries.map((l) => `<option value="${attr(l)}">${esc(l)}</option>`).join("");

const indexHtml = `${head(meta.title, idxDesc, BASE + "/", idxLd)}
<body>
<header class="masthead">
  <div class="wrap">
    <p class="kicker">A field guide to the Japan-shaped holes</p>
    <h1 class="title">CJK / Unicode<br>Failure Corpus</h1>
    <p class="lede">${esc(meta.tagline)} Each entry links to its fix and to <a class="fixtures-link" href="${esc(meta.fixturesRepo)}">cjk-agent-fixtures</a>, the CI fixtures that keep these regressions from coming back.</p>
    <p class="counts"><b>${entries.length}</b> entries &nbsp;/&nbsp; <b>${libCount}</b> libraries &nbsp;/&nbsp; <b>${mergedCount}</b> already merged</p>
    <p class="source-note">${esc(meta.sourceNote)}</p>
  </div>
</header>
<div class="rule"></div>

<div class="controls">
  <div class="wrap">
    <input id="q" type="search" placeholder="Search symptom, library, repro, fix..." aria-label="Search the corpus" autocomplete="off">
    <select id="f-cat" class="filter" aria-label="Filter by category">
      <option value="">All categories</option>
      ${catOptions}
    </select>
    <select id="f-lib" class="filter" aria-label="Filter by library">
      <option value="">All libraries</option>
      ${libOptions}
    </select>
    <span class="result-count" id="rc"></span>
  </div>
</div>

<main>
${catSections}
  <div class="wrap"><p class="empty" id="empty">No entries match. Try a shorter query.</p></div>
</main>

<div class="rule"></div>
<footer>
  <div class="wrap">
    <p class="mark">greymoth</p>
    <p>A running corpus of CJK, IME, and Unicode/text-handling failures found while reading global open-source code with a Japanese lens. Most entries are greymoth's own pull requests; a few are cited upstream issues that document the same failures. Data: <a href="data/corpus.json">corpus.json</a>. CI fixtures: <a href="${esc(meta.fixturesRepo)}">cjk-agent-fixtures</a>.</p>
  </div>
</footer>

<script>
(function(){
  var q = document.getElementById('q');
  var fc = document.getElementById('f-cat');
  var fl = document.getElementById('f-lib');
  var rc = document.getElementById('rc');
  var empty = document.getElementById('empty');
  var entries = Array.prototype.slice.call(document.querySelectorAll('.entry'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-cat-section]'));
  var total = entries.length;

  function apply(){
    var term = q.value.trim().toLowerCase();
    var cat = fc.value;
    var lib = fl.value;
    var shown = 0;
    entries.forEach(function(el){
      var ok = true;
      if (cat && el.getAttribute('data-cat') !== cat) ok = false;
      if (ok && lib && el.getAttribute('data-lib') !== lib) ok = false;
      if (ok && term && el.getAttribute('data-search').indexOf(term) === -1) ok = false;
      el.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    sections.forEach(function(sec){
      var any = sec.querySelectorAll('.entry').length &&
        Array.prototype.some.call(sec.querySelectorAll('.entry'), function(e){ return e.style.display !== 'none'; });
      sec.style.display = any ? '' : 'none';
    });
    empty.style.display = shown === 0 ? 'block' : 'none';
    rc.textContent = shown === total ? (total + ' entries') : (shown + ' / ' + total);
  }
  q.addEventListener('input', apply);
  fc.addEventListener('change', apply);
  fl.addEventListener('change', apply);
  apply();
})();
</script>
</body>
</html>`;

// --- per-entry pages --------------------------------------------------------
function entryPage(e) {
  const canonical = `${BASE}/e/${e.id}.html`;
  const desc = `${e.library}: ${e.symptom}`.slice(0, 300);
  const ld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: e.title,
    about: categories[e.category].label,
    description: desc,
    url: canonical,
    isPartOf: { "@type": "CollectionPage", name: meta.title, url: BASE + "/" },
  })}</script>`;
  return `${head(`${e.title} - ${meta.title}`, desc, canonical, ld)}
<body class="detail">
<header class="masthead">
  <div class="wrap">
    <p class="kicker"><a href="../" style="color:inherit;text-decoration:none">CJK / Unicode Failure Corpus</a> / ${esc(categories[e.category].label)}</p>
    <a class="detail-back" href="../#${esc(e.id)}">&larr; back to the corpus</a>
  </div>
</header>
<main>
  <div class="wrap">
    ${entryCard(e, { heading: "h1", link: false })}
    <a class="detail-back" href="../">&larr; all ${entries.length} entries</a>
  </div>
</main>
<div class="rule"></div>
<footer>
  <div class="wrap"><p class="mark">greymoth</p><p>Part of the <a href="../">CJK / Unicode Failure Corpus</a>. CI fixtures: <a href="${esc(meta.fixturesRepo)}">cjk-agent-fixtures</a>.</p></div>
</footer>
</body>
</html>`;
}

// --- write ------------------------------------------------------------------
const eDir = join(ROOT, "e");
if (existsSync(eDir)) rmSync(eDir, { recursive: true, force: true });
mkdirSync(eDir, { recursive: true });

writeFileSync(join(ROOT, "index.html"), indexHtml);
for (const e of entries) writeFileSync(join(eDir, `${e.id}.html`), entryPage(e));

const urls = [`${BASE}/`, ...entries.map((e) => `${BASE}/e/${e.id}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
writeFileSync(join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(join(ROOT, ".nojekyll"), "");

console.log(`built: index.html + ${entries.length} entry pages + sitemap (${urls.length} urls)`);
console.log(`categories: ${CAT_ORDER.filter((c) => entries.some((e) => e.category === c)).length}, libraries: ${libCount}, merged: ${mergedCount}`);
