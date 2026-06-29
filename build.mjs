#!/usr/bin/env node
/* CJK / Unicode Failure Corpus - static generator. Zero dependencies.
   Reads data/corpus.json (verified bug data) + data/seo.json (search-intent
   title layer), writes index.html, e/<id>.html, category/<cat>.html,
   stack/<slug>.html, sitemap.xml, robots.txt and .nojekyll.
   Run: node build.mjs */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = "https://greymoth-jp.github.io/cjk-failure-corpus";
const TODAY = new Date().toISOString().slice(0, 10);

const data = JSON.parse(readFileSync(join(ROOT, "data", "corpus.json"), "utf8"));
const { meta, categories, entries } = data;
const seo = JSON.parse(readFileSync(join(ROOT, "data", "seo.json"), "utf8")).titles;

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

// Stacks that earn their own landing page (>= 2 entries). Friendlier URL slug
// and label than the raw tag where it helps a search ("JS" -> "javascript").
const STACK_META = {
  React: { slug: "react", label: "React" },
  JS: { slug: "javascript", label: "JavaScript" },
  Vue: { slug: "vue", label: "Vue" },
  Python: { slug: "python", label: "Python" },
  TS: { slug: "typescript", label: "TypeScript" },
  Rust: { slug: "rust", label: "Rust" },
  Angular: { slug: "angular", label: "Angular" },
  i18n: { slug: "i18n", label: "Localization (i18n)" },
  Windows: { slug: "windows", label: "Windows" },
  spec: { slug: "web-platform", label: "Web platform specs" },
  Zed: { slug: "zed", label: "Zed" },
};

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const attr = (s = "") => esc(s).replace(/'/g, "&#39;");
const clip = (s = "", n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
const seoTitle = (e) => seo[e.id] || e.title;

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
  if (!seo[e.id]) throw new Error(`entry ${e.id} missing a search title in data/seo.json`);
  seen.add(e.id);
}

const mergedCount = entries.filter((e) => e.status === "merged").length;
const libCount = new Set(entries.map((e) => e.repo)).size;
const libraries = [...new Set(entries.map((e) => e.library))].sort((a, b) =>
  a.toLowerCase().localeCompare(b.toLowerCase())
);

const presentCats = CAT_ORDER.filter((c) => entries.some((e) => e.category === c));

// Stack tag -> entries, then keep only the ones with a landing page.
const stackCounts = {};
for (const e of entries) for (const s of e.stack || []) stackCounts[s] = (stackCounts[s] || 0) + 1;
const landingStacks = Object.keys(STACK_META)
  .filter((s) => (stackCounts[s] || 0) >= 2)
  .sort((a, b) => (stackCounts[b] || 0) - (stackCounts[a] || 0));

const catUrl = (c, prefix = "") => `${prefix}category/${c}.html`;
const stackUrl = (s, prefix = "") => `${prefix}stack/${STACK_META[s].slug}.html`;
const entryUrl = (id, prefix = "") => `${prefix}e/${id}.html`;

// --- shared <head> ----------------------------------------------------------
function head(title, desc, canonical, { ld = "", cssPrefix = "", ogType = "website" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${attr(meta.title)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(desc)}">
<link rel="preload" href="/cjk-failure-corpus/fonts/CourierPrime-Regular.ttf" as="font" type="font/ttf" crossorigin>
${ld}
<link rel="stylesheet" href="${cssPrefix}assets/style.css">
</head>`;
}

const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

function breadcrumbLd(trail) {
  return jsonld({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  });
}

function statusBadge(status) {
  return `<span class="badge badge--${status}">${status}</span>`;
}

// Full card (index + detail). Heading text is the search-intent title.
function entryCard(e, { heading = "h3", link = true, linkPrefix = "" } = {}) {
  const display = seoTitle(e);
  const stackTags = (e.stack || []).map((s) => `<span class="tag tag--stack">${esc(s)}</span>`).join("");
  const titleInner = link
    ? `<a href="${entryUrl(e.id, linkPrefix)}">${esc(display)}</a>`
    : esc(display);
  const authored = e.authored !== false;
  const citedTag = authored ? "" : `<span class="tag tag--cited">cited</span>`;
  const linkLabel = authored
    ? e.status === "merged" ? "Merged PR" : e.status === "closed" ? "Closed PR" : "Fix PR"
    : "Upstream issue";
  const repoUrl = `https://github.com/${esc(e.repo)}`;
  const searchHay = attr(
    [display, e.title, e.library, e.repo, e.symptom, e.repro, e.fix, categories[e.category].label, (e.stack || []).join(" "), authored ? "pull request" : "cited upstream issue"]
      .join(" ")
      .toLowerCase()
  );
  // The original verbatim label, kept as context under the search-intent heading.
  const subtitle = !link && e.title !== display
    ? `<p class="entry-subtitle">${esc(e.title)}</p>`
    : "";
  return `<article class="entry" id="${esc(e.id)}" data-cat="${esc(e.category)}" data-lib="${attr(e.library)}" data-search="${searchHay}">
  <div class="entry-top">
    <span class="tag">${esc(categories[e.category].label)}</span>
    ${stackTags}
    ${citedTag}
    ${statusBadge(e.status)}
  </div>
  <${heading} class="entry-title">${titleInner}</${heading}>
  ${subtitle}
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

// Compact row for the caniuse-style category / stack landing lists.
function entryRow(e, prefix) {
  const display = seoTitle(e);
  const tags = (e.stack || []).map((s) => `<span class="tag tag--stack">${esc(s)}</span>`).join("");
  return `<li class="row">
  <a class="row-title" href="${entryUrl(e.id, prefix)}">${esc(display)}</a>
  <p class="row-meta"><span class="lib">${esc(e.library)}</span> ${tags} ${statusBadge(e.status)}</p>
  <p class="row-sym">${esc(e.symptom)}</p>
</li>`;
}

// A "browse" band of links to every landing page (category + stack).
function browseBand(prefix) {
  const cats = presentCats
    .map((c) => `<a class="chip" href="${catUrl(c, prefix)}">${esc(categories[c].label)} <span class="chip-n">${entries.filter((e) => e.category === c).length}</span></a>`)
    .join("");
  const stacks = landingStacks
    .map((s) => `<a class="chip" href="${stackUrl(s, prefix)}">${esc(STACK_META[s].label)} <span class="chip-n">${stackCounts[s]}</span></a>`)
    .join("");
  return `<nav class="browse" aria-label="Browse the corpus">
  <div class="wrap">
    <p class="browse-h">Browse by category</p>
    <div class="chips">${cats}</div>
    <p class="browse-h">Browse by stack</p>
    <div class="chips">${stacks}</div>
  </div>
</nav>`;
}

// --- index ------------------------------------------------------------------
const idxDesc =
  `${entries.length} real CJK, IME, and Unicode/text-handling bugs in open-source libraries, ` +
  `each with a minimal repro, the affected library, and the fix. Searchable and filterable.`;

const idxLd = jsonld({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: meta.title,
  description: idxDesc,
  url: BASE + "/",
  inLanguage: "en",
  isPartOf: { "@type": "WebSite", name: meta.title, url: BASE + "/" },
});

const catSections = presentCats
  .map((cat) => {
    const list = entries.filter((e) => e.category === cat);
    const cards = list.map((e) => entryCard(e)).join("\n");
    return `<section class="cat-section" data-cat-section="${esc(cat)}">
  <div class="wrap">
    <div class="cat-head">
      <h2 id="cat-${esc(cat)}"><a href="${catUrl(cat)}">${esc(categories[cat].label)}</a></h2>
      <span class="cat-n">${list.length} ${list.length === 1 ? "entry" : "entries"}</span>
      <a class="cat-all" href="${catUrl(cat)}">open category page &rarr;</a>
    </div>
    <p class="cat-blurb">${esc(categories[cat].blurb)}</p>
    ${cards}
  </div>
</section>`;
  })
  .join("\n");

const catOptions = presentCats
  .map((c) => `<option value="${esc(c)}">${esc(categories[c].label)}</option>`)
  .join("");
const libOptions = libraries.map((l) => `<option value="${attr(l)}">${esc(l)}</option>`).join("");

const indexHtml = `${head(meta.title, idxDesc, BASE + "/", { ld: idxLd })}
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

${browseBand("")}
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
  const canonical = entryUrl(e.id, BASE + "/");
  const title = seoTitle(e);
  const catLabel = categories[e.category].label;
  const desc = clip(`${e.library}: ${e.symptom}`, 158);
  const kw = [...new Set([...(e.stack || []), e.library, catLabel, "CJK", "Unicode", "i18n", "Japanese"])].join(", ");

  const article = jsonld({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    alternativeHeadline: e.title,
    name: title,
    about: catLabel,
    articleSection: catLabel,
    keywords: kw,
    inLanguage: "en",
    description: desc,
    url: canonical,
    mainEntityOfPage: canonical,
    dateModified: TODAY,
    citation: e.url,
    author: { "@type": "Organization", name: "greymoth", url: BASE + "/" },
    publisher: { "@type": "Organization", name: "greymoth", url: BASE + "/" },
    isPartOf: { "@type": "CollectionPage", name: meta.title, url: BASE + "/" },
  });
  const crumbs = breadcrumbLd([
    { name: meta.title, url: BASE + "/" },
    { name: catLabel, url: catUrl(e.category, BASE + "/") },
    { name: title, url: canonical },
  ]);

  // related: same category + shared stack, a handful, for internal linking
  const related = entries
    .filter((x) => x.id !== e.id && (x.category === e.category || (x.stack || []).some((s) => (e.stack || []).includes(s))))
    .slice(0, 5);
  const relatedHtml = related.length
    ? `<section class="related">
    <p class="related-h">Related failures</p>
    <ul class="related-list">
      ${related.map((r) => `<li><a href="${entryUrl(r.id, "../")}">${esc(seoTitle(r))}</a></li>`).join("\n      ")}
    </ul>
  </section>`
    : "";
  const stackLinks = (e.stack || [])
    .filter((s) => STACK_META[s] && (stackCounts[s] || 0) >= 2)
    .map((s) => `<a href="${stackUrl(s, "../")}">${esc(STACK_META[s].label)}</a>`)
    .join(" &middot; ");

  return `${head(`${title} — CJK Failure Corpus`, desc, canonical, { ld: article + "\n" + crumbs, cssPrefix: "../", ogType: "article" })}
<body class="detail">
<header class="masthead">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="../">CJK / Unicode Failure Corpus</a> <span>/</span>
      <a href="${catUrl(e.category, "../")}">${esc(catLabel)}</a>
    </nav>
  </div>
</header>
<main>
  <div class="wrap">
    ${entryCard(e, { heading: "h1", link: false })}
    ${stackLinks ? `<p class="also-in">Also in: ${stackLinks}</p>` : ""}
    ${relatedHtml}
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

// --- category landing pages -------------------------------------------------
function categoryPage(cat) {
  const list = entries.filter((e) => e.category === cat);
  const label = categories[cat].label;
  const canonical = catUrl(cat, BASE + "/");
  const title = `${label} — CJK / Unicode bugs, repros & fixes (${list.length} cases)`;
  const desc = clip(`${list.length} real ${label.toLowerCase()} bugs in open-source libraries. ${categories[cat].blurb}`, 158);

  const ld =
    jsonld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${label} — CJK / Unicode Failure Corpus`,
      description: desc,
      url: canonical,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: meta.title, url: BASE + "/" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: list.length,
        itemListElement: list.map((e, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: seoTitle(e),
          url: entryUrl(e.id, BASE + "/"),
        })),
      },
    }) +
    "\n" +
    breadcrumbLd([
      { name: meta.title, url: BASE + "/" },
      { name: label, url: canonical },
    ]);

  const otherCats = presentCats
    .filter((c) => c !== cat)
    .map((c) => `<a class="chip" href="${catUrl(c, "../")}">${esc(categories[c].label)}</a>`)
    .join("");

  return `${head(title, desc, canonical, { ld, cssPrefix: "../" })}
<body class="landing">
<header class="masthead">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">CJK / Unicode Failure Corpus</a> <span>/</span> <span>${esc(label)}</span></nav>
    <p class="kicker">Category</p>
    <h1 class="landing-title">${esc(label)}</h1>
    <p class="lede">${esc(categories[cat].blurb)}</p>
    <p class="counts"><b>${list.length}</b> ${list.length === 1 ? "case" : "cases"} in the corpus</p>
  </div>
</header>
<div class="rule"></div>
<main>
  <div class="wrap">
    <ul class="rows">
      ${list.map((e) => entryRow(e, "../")).join("\n      ")}
    </ul>
    <p class="browse-h">Other categories</p>
    <div class="chips">${otherCats}</div>
    <a class="detail-back" href="../">&larr; back to all ${entries.length} entries</a>
  </div>
</main>
<div class="rule"></div>
<footer>
  <div class="wrap"><p class="mark">greymoth</p><p>Part of the <a href="../">CJK / Unicode Failure Corpus</a>. CI fixtures: <a href="${esc(meta.fixturesRepo)}">cjk-agent-fixtures</a>.</p></div>
</footer>
</body>
</html>`;
}

// --- stack landing pages ----------------------------------------------------
function stackPage(stack) {
  const list = entries.filter((e) => (e.stack || []).includes(stack));
  const label = STACK_META[stack].label;
  const canonical = stackUrl(stack, BASE + "/");
  const title = `${label} — CJK, IME & Unicode bugs and fixes (${list.length} cases)`;
  const desc = clip(
    `${list.length} real CJK, IME, and Unicode/text-handling bugs found in ${label} open-source projects, each with a minimal repro and the fix.`,
    158
  );

  const ld =
    jsonld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${label} — CJK / Unicode Failure Corpus`,
      description: desc,
      url: canonical,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: meta.title, url: BASE + "/" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: list.length,
        itemListElement: list.map((e, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: seoTitle(e),
          url: entryUrl(e.id, BASE + "/"),
        })),
      },
    }) +
    "\n" +
    breadcrumbLd([
      { name: meta.title, url: BASE + "/" },
      { name: label, url: canonical },
    ]);

  // group rows by category for readability
  const byCat = presentCats
    .filter((c) => list.some((e) => e.category === c))
    .map((c) => {
      const sub = list.filter((e) => e.category === c);
      return `<h2 class="row-cat"><a href="${catUrl(c, "../")}">${esc(categories[c].label)}</a> <span class="cat-n">${sub.length}</span></h2>
      <ul class="rows">
        ${sub.map((e) => entryRow(e, "../")).join("\n        ")}
      </ul>`;
    })
    .join("\n");

  const otherStacks = landingStacks
    .filter((s) => s !== stack)
    .map((s) => `<a class="chip" href="${stackUrl(s, "../")}">${esc(STACK_META[s].label)}</a>`)
    .join("");

  return `${head(title, desc, canonical, { ld, cssPrefix: "../" })}
<body class="landing">
<header class="masthead">
  <div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">CJK / Unicode Failure Corpus</a> <span>/</span> <span>${esc(label)}</span></nav>
    <p class="kicker">Stack</p>
    <h1 class="landing-title">${esc(label)}</h1>
    <p class="lede">CJK, IME, and Unicode/text-handling failures found in ${esc(label)} open-source projects. Each links to a minimal repro and the fix.</p>
    <p class="counts"><b>${list.length}</b> ${list.length === 1 ? "case" : "cases"} in the corpus</p>
  </div>
</header>
<div class="rule"></div>
<main>
  <div class="wrap">
    ${byCat}
    <p class="browse-h">Other stacks</p>
    <div class="chips">${otherStacks}</div>
    <a class="detail-back" href="../">&larr; back to all ${entries.length} entries</a>
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
function resetDir(name) {
  const d = join(ROOT, name);
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}
const eDir = resetDir("e");
const catDir = resetDir("category");
const stackDir = resetDir("stack");

writeFileSync(join(ROOT, "index.html"), indexHtml);
for (const e of entries) writeFileSync(join(eDir, `${e.id}.html`), entryPage(e));
for (const c of presentCats) writeFileSync(join(catDir, `${c}.html`), categoryPage(c));
for (const s of landingStacks) writeFileSync(join(stackDir, `${STACK_META[s].slug}.html`), stackPage(s));

const urls = [
  `${BASE}/`,
  ...presentCats.map((c) => catUrl(c, BASE + "/")),
  ...landingStacks.map((s) => stackUrl(s, BASE + "/")),
  ...entries.map((e) => entryUrl(e.id, BASE + "/")),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
writeFileSync(join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(join(ROOT, ".nojekyll"), "");

console.log(`built: index + ${entries.length} entries + ${presentCats.length} category pages + ${landingStacks.length} stack pages`);
console.log(`sitemap urls: ${urls.length} | libraries: ${libCount} | merged: ${mergedCount}`);
console.log(`stack pages: ${landingStacks.map((s) => `${STACK_META[s].slug}(${stackCounts[s]})`).join(", ")}`);
