# CJK / i18n Bug Taxonomy

A small, citation-backed reference of the failure patterns that keep breaking CJK and localized software: IME composition, full-width/half-width normalization, kinsoku line-breaking, un-keyed strings, key drift, font fallback, RTL leakage, pluralization, locale-naive date/number formatting, encoding, grapheme segmentation, word segmentation, a Japanese legal-disclosure gap, and collation.

This is a pattern taxonomy, not a bug database. Each entry describes one recurring failure mode, ties it to at least one primary source (a Unicode technical report, a W3C Internationalization page, official library documentation, a government law text, or a real GitHub issue/pull request), and gives a minimal repro, how to detect it, and the fix. Nothing here is a hypothetical "this could happen" bug: every source URL was checked and returns a live page as of this dataset's build date.

It sits inside [cjk-failure-corpus](../) as a companion layer to [`../data/corpus.json`](../data/corpus.json): see [Related](#related) below for how the two fit together.

## Files

- `dataset.jsonl` - one JSON object per entry (machine-readable).
- `README.md` - this file, human-readable.
- `LICENSE` - CC BY 4.0.

## Entries

| Category | Failure mode | Fix | Source |
|---|---|---|---|
| ime-composition | onChange/keydown handlers act before IME composition finishes, so confirming a kana-to-kanji conversion also submits the form | Guard on `event.isComposing` (or `keyCode 229` as legacy fallback); act only after `compositionend` | [React #3926](https://github.com/react/react/issues/3926) |
| width-normalization | Full-width (zenkaku) and half-width (hankaku) forms of the same character compare or index as different strings | Normalize with `String.prototype.normalize('NFKC')` or a purpose-built converter before comparing | [jaconv #12](https://github.com/ikegami-yukino/jaconv/issues/12) |
| line-breaking | CJK text wraps at forbidden points (a line starts with 。、」) because there are no spaces to hint word breaks | CSS `line-break: strict` + `word-break: keep-all`, or a model-based segmenter (BudouX) | [BudouX](https://github.com/google/budoux), [UAX #14](https://www.unicode.org/reports/tr14/) |
| unkeyed-strings | Hardcoded English text ships inside an otherwise localized UI | Lint rule that bans raw text nodes outside a translation call | [eslint-plugin-i18next](https://github.com/edvardchen/eslint-plugin-i18next) |
| key-drift | A translation key added to the base locale is never added to other locale files | CI step that diffs key sets across locale files; type-check `t()` calls | [i18next TypeScript guide](https://www.i18next.com/overview/typescript) |
| font-fallback | Missing `lang` attribute or CJK font stack renders empty boxes (tofu) or the wrong Han-unified glyph | Set `lang` explicitly and include a real CJK web font in the stack | [W3C: why lang matters](https://www.w3.org/International/questions/qa-lang-why) |
| rtl-layout | Physical CSS properties (`margin-left`) put content on the wrong side once `dir="rtl"` is set | Use CSS logical properties, or transform the stylesheet with a tool built for it | [RTLCSS](https://github.com/MohammadYounes/rtlcss) |
| pluralization | A binary ternary (`count === 1 ? ... : ...`) mis-grammars languages with more than two plural forms | ICU MessageFormat plural blocks driven by CLDR plural rules | [FormatJS](https://formatjs.io/docs/react-intl/), [CLDR](https://cldr.unicode.org/) |
| date-number-format | Hand-built date/number strings ignore locale and calendar, including 令和-era dates | `Intl.DateTimeFormat` / `Intl.NumberFormat` with an explicit locale, `calendar: 'japanese'` where needed | [MDN Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl) |
| encoding-mojibake | Server and client disagree on charset (Shift-JIS vs UTF-8), or `<meta charset>` is missing | Declare UTF-8 explicitly at every layer: HTTP header, meta tag, DB connection | [W3C: encoding declarations](https://www.w3.org/International/questions/qa-html-encoding-declarations) |
| encoding-bom | A stray UTF-8 byte-order-mark glues itself to the first parsed field | Strip a leading BOM before parsing, everywhere the file is read | [Unicode BOM FAQ](https://www.unicode.org/faq/utf_bom.html) |
| grapheme-segmentation | Cursor/backspace/truncate logic walks UTF-16 code units, splitting a surrogate pair, combining mark, or conjunct cluster | `Intl.Segmenter` with `granularity: 'grapheme'` for any operation that touches user-facing text | [Slate #6074](https://github.com/ianstormtaylor/slate/pull/6074), [UAX #29](https://www.unicode.org/reports/tr29/#Grapheme_Cluster_Boundaries) |
| word-segmentation | A whitespace-split word counter treats an entire CJK paragraph as one word | `Intl.Segmenter` with `granularity: 'word'`, or a dedicated tokenizer, instead of splitting on spaces | [UAX #29 word boundaries](https://www.unicode.org/reports/tr29/#Word_Boundaries) |
| legal-disclosure | A checkout satisfies a US-style Terms of Service but omits Japan's required 特定商取引法 disclosure | Add a dedicated 特定商取引法に基づく表記 page with the required fields, linked from checkout | [e-Gov: Act on Specified Commercial Transactions](https://elaws.e-gov.go.jp/document?lawid=351AC0000000057) |
| collation | Default `.sort()` orders Japanese/CJK text by code unit, not by linguistically correct reading order | `Intl.Collator` with the correct locale, instead of the default comparator | [MDN Intl.Collator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator) |

Each row above is a summary. `dataset.jsonl` carries the full text for every field: `id`, `category`, `title`, `description`, `minimal_repro`, `detection`, `fix`, `source_urls`, `frameworks`, `source_quality`.

## On sourcing

Every URL in this dataset was checked by hand before publishing, not carried over from a draft on faith. Three of the citations in the original research draft pointed at the wrong repository (an ESLint plugin under the wrong GitHub org, `rtlcss` under an org that does not exist), and one entry - the Tokushoho legal-disclosure gap - was flagged in the draft as an unverified claim with no real source. All four are fixed here: the ESLint and RTLCSS entries now point at the real, maintained projects that do what the entry describes, and the legal-disclosure entry cites the actual government law text (e-Gov, law ID 351AC0000000057) instead of a general claim.

`source_quality` on every entry is `primary`: a Unicode technical report, a W3C page, official project documentation, a government law database, or a real, checkable GitHub issue or pull request. Nothing in this dataset is a synthesized or hypothetical example.

## Related

[`../data/corpus.json`](../data/corpus.json) is the parent repo's main dataset: real, specific bug instances mined from merged pull requests across dozens of open-source repositories, rather than the general patterns catalogued here. Two categories share a name with this file exactly (`ime-composition`, `width-normalization`); a few more cover the same underlying issue at a different granularity — the corpus's `segmentation` and `surrogate-emoji` buckets correspond to this file's `word-segmentation` and `grapheme-segmentation`. The rest of this taxonomy (line-breaking, unkeyed strings, key drift, font fallback, RTL layout, pluralization, date/number formatting, legal disclosure, collation) covers patterns the corpus has not caught a live PR for yet. Read this file for the pattern, the corpus for a specific instance of it in someone else's codebase.

## Attribution

Maintained by greymoth. Corrections and additional citation-backed entries are welcome as long as every claim ties to a real, checkable source.
