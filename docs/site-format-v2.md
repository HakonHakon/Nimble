# Site document v2

v2 replaces the fixed block list with an element tree whose layout, placement and style can differ per breakpoint. It is the format the new editor will save. The classic builder keeps editing v1 documents. Both formats are accepted by `/api/site`, templates, preview and publishing.

## Files

| File | Role |
| --- | --- |
| `lib/nimble-spec.json` | Single source of truth: limits, patterns, element types, and the allowed layout/placement/style properties with their value types. Read by both editions. |
| `lib/site-model-v2.mjs` | `normalizeSiteV2` validates and canonicalizes a document. `normalizeSite` dispatches on `version: 2`. |
| `lib/render-v2.mjs` | Renders a page to HTML and generates per-element CSS with `@media` rules. `pageHtml` dispatches on `version: 2`. |
| `lib/migrate-v1.mjs` | `migrateV1` converts a v1 document into a v2 tree that looks the same. The v2 editor runs it when it opens a v1 site. |
| `assets/public-v2.css` | Neutral base styles for published v2 pages. |
| `php-backend/lib/site-model-v2.php`, `render-v2.php` | 1:1 PHP ports. `test/v2-parity.test.mjs` requires byte-identical output from both. |

## Shape

```text
{ version: 2, site, design: { colors, fonts, textStyles, body }, breakpoints, assets,
  header?, footer?, pages: [{ id, name, path, children, title?, description?, showHeader, showFooter }],
  nodes: { <id>: { id, type, name?, tag?, props?, children?, layout?, place?, style?, hidden?, locked? } } }
```

- **Tree.** Pages, `header` and `footer` contain sections only. Sections and containers hold other elements. Every element appears once. Unreachable elements are dropped on save. The depth limit is 12.
- **Breakpoints.** Desktop is the base. `breakpoints` are ordered widest first (default tablet ≤1000 px, mobile ≤750 px; up to 5). `layout`, `place`, `style`, `hidden` and each text style are maps keyed by breakpoint id. They hold only the overrides, which cascade desktop → tablet → mobile.
- **Layout (containers).** `mode: grid | stack`, tracks (`1fr`, `240px`, `auto`, `minmax(a,b)`, `repeat(auto-fit,minmax(a,1fr))`), gaps, `padding`, `minHeight`, and `contentWidth` (keeps content centred while the background stays full width).
- **Placement (children).** For grid children: `cell` = [row, column, rowSpan, columnSpan], plus `justifySelf`/`alignSelf`. Freeform positioning puts several children in the same cell and offsets them with `margin`. For stack children: `alignSelf` and `order`. Shared: width/height/min/max, `rotate`, `z`.
- **Style.** `color`, `background` (colour/gradient/image with overlay), `opacity`, `border` (per side), `radius`, `shadow`, typography, `padding`, `linkUnderline`. Colours are hex or `@paletteKey`. Fonts are referenced by id.
- **Rich text.** `props.doc` is a list of blocks (`p`, `h1`–`h6`, `ul`, `ol`) made of runs with `b/i/u/s`, `color`, `link`, or a `token` (`year`, `siteName`).
- **Links** are structured: `page` (+ optional anchor), `anchor`, `url`, `asset`, `email`, `phone`, plus `newTab`. Links to deleted pages or elements are dropped.
- **Security.** No raw CSS or HTML is accepted. Every value is checked against the spec types before it reaches the CSS or HTML output.

## Not in v2 yet

Google Fonts (planned as self-hosted fonts in P6), hover states, animations, form field builder, and the remaining element types from P8. Add each one to `nimble-spec.json` and to both implementations, then add a parity fixture.
