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
{ version: 2, site, design: { colors, fonts, textStyles, body, presets? }, breakpoints, assets,
  header?, footer?, pages: [{ id, name, path, children, title?, description?, showHeader, showFooter }],
  nodes: { <id>: { id, type, name?, tag?, props?, children?, layout?, place?, style?, hover?, hidden?, locked? } } }
```

- **Tree.** Pages, `header` and `footer` contain sections only. Sections and containers hold other elements. Every element appears once. Unreachable elements are dropped on save. The depth limit is 12.
- **Breakpoints.** Desktop is the base. `breakpoints` are ordered widest first (default tablet ≤1000 px, mobile ≤750 px; up to 5). `layout`, `place`, `style`, `hidden` and each text style are maps keyed by breakpoint id. They hold only the overrides, which cascade desktop → tablet → mobile.
- **Layout (containers).** `mode: grid | stack`, tracks (`1fr`, `240px`, `auto`, `minmax(a,b)`, `repeat(auto-fit,minmax(a,1fr))`), gaps, `padding`, `minHeight`, and `contentWidth` (keeps content centred while the background stays full width).
- **Placement (children).** For grid children: `cell` = [row, column, rowSpan, columnSpan], plus `justifySelf`/`alignSelf`. Freeform positioning puts several children in the same cell and offsets them with `margin`. For stack children: `alignSelf` and `order`. Shared: width/height/min/max, `rotate`, `z`.
- **Style.** `color`, `background`, `opacity`, `border` (per side), `radius` (per corner: top-left, top-right, bottom-right, bottom-left), `shadow` (up to 4, optionally `inset`), typography, `padding`, `linkUnderline`, `blendMode` (CSS `mix-blend-mode` values), `scrollEffect` (`none`, `parallax`, `reveal`). Colours are hex (`#rrggbb` or `#rrggbbaa`), `transparent` or `@paletteKey`. Fonts are referenced by id.
- **Backgrounds.**
  - `color`
  - `gradient`: `linear` or `radial`, an angle, and 2–8 stops of `{ color, at }`
  - `image`: `src`, `size`, `position` or a `focal` point `[x%, y%]` (which wins), an optional `overlay` colour
  - `video`: sections and containers only. `src` must be an MP4 or WebM file; optional `poster` and `overlay`. It renders as a muted, looping `<video>` behind the content, and is hidden when the visitor prefers reduced motion.
- **Hover.** `hover` is one map for all breakpoints: `color`, `background` (no video), `borderColor`, `shadow`, `opacity`, `scale` (0.5–2), `translateY`, and `duration` (ms, default 200). It renders as `:hover` rules plus a `transition` on the changed properties.
- **Scroll effects.** `parallax` moves the background image at a slower speed; the runtime is in `assets/public.js`. `reveal` fixes the background so content scrolls over it. Both are turned off when the visitor prefers reduced motion. Elements with an effect carry a `data-fx` attribute.
- **Fonts.**
  - `{ id, source: 'system', family: sans | serif | mono }`
  - `{ id, source: 'custom', family, src }` for one uploaded file (WOFF2, WOFF, TTF or OTF)
  - `{ id, source: 'custom', family, files: [{ src, weight, style }] }` for self-hosted Google fonts (up to 12 files)

  `heading` and `body` always exist. Each `@font-face` is declared once, even when several ids share a family.
- **Icons.** `spec.icons` maps names to 24×24 stroke paths. `icon` elements have `{ icon, label?, link?, weight? }`. Buttons accept `icon`, `iconPosition` (`start`/`end`) and `hideLabel`. Both backends render the same `<svg>` markup from the spec.
- **Lines.** `divider` props are `orientation` (`horizontal`/`vertical`), `thickness` and `lineStyle`.
- **Saved designs.** `design.presets` is a list of `{ id, name, type, style? }` (up to 50). `style` is a normal breakpoint style map. Applying one copies it to the element.
- **Rich text.** `props.doc` is a list of blocks (`p`, `h1`–`h6`, `ul`, `ol`).
  - **Blocks** can have:
    - `style`, a text style key; it sets the look independently of the HTML tag
    - `align`
    - `lineHeight`
    - `letterSpacing`
  - **Runs** carry:
    - `b`, `i`, `u`, `s`
    - `color` and `highlight`
    - `font` (a font id), `size` and `weight`
    - `link`, or a `token` (`year`, `siteName`)
  - Run formatting renders as one `<span style>` per run, and block spacing as a `style` attribute. Both are built from validated values only.
- **Links** are structured: `page` (+ optional anchor), `anchor`, `url`, `asset`, `email`, `phone`, plus `newTab`. Links to deleted pages or elements are dropped.
- **Security.** No raw CSS or HTML is accepted. Every value is checked against the spec types before it reaches the CSS or HTML output.

## Not in v2 yet

Entrance animations, the form field builder, and the remaining element types from P8. Add each one to `nimble-spec.json` and to both implementations, then add a parity fixture.
