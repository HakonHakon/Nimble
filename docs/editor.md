# The v2 editor

Open `/editor.html`. A site made with the classic builder is converted to the v2 format the first time you edit it here, and the classic builder can no longer open it after that.

## Canvas

- The page is laid out at the real width of the chosen breakpoint and scaled to fit the window.
- **Selecting.** Click selects the innermost element under the pointer. Esc selects its parent. The breadcrumb in the inspector shows the path from the page down to the element.
- **Moving.** Drag any element.
  - In a **grid** container, the element stays in the grid cell under the pointer, pinned to the cell's top-left corner and offset by margins (freeform positioning).
  - In a **stack**, dragging changes the order of the elements. On desktop this changes the element order everywhere. On smaller breakpoints it changes the order only at that breakpoint and smaller.
  - Dropping over another container moves the element into it. The receiving container is outlined in green.
  - Sections are reordered by dragging them up or down.
- **Resizing.** Drag one of the 8 handles. Shift keeps the proportions; Alt resizes from the centre. A section has a single bottom handle that sets its minimum height.
- **Rotating.** Drag the round handle above the element. Shift turns in 15° steps.
- **Nudging.** Arrow keys move the selected element by 1 px; Shift+arrow moves it by 10 px. Repeated nudges count as one undo step.
- **Snapping.** Edges and centres snap to the parent's edges and centre, to sibling elements, to grid lines, to ruler guides, and to equal spacing between neighbours. Pink lines show the match and distance labels show the gaps. Hold Ctrl (⌘ on Mac) to move without snapping, or switch **Snap** off in the top bar.
- **Rulers and guides.** Drag from the top ruler to create a horizontal guide, or from the left ruler for a vertical one. Drag a guide back onto its ruler to remove it. Guides are saved per page and breakpoint in your browser and are never published.
- **Grid** in the top bar shows the tracks of the selected grid, or of the grid the selected element is in.
- **Locked elements** can still be selected and edited in the inspector, but they cannot be moved, resized or rotated.
- Esc cancels a drag that is still in progress.

## Layout (Layout tab)

Sections and containers arrange their content in one of two ways:

- **Grid**: rows and columns.
  - Use the column presets (1–4 equal columns, 1:2, 2:1, auto-fit cards), or set each column and row in `fr`, `px`, `%` or `auto`.
  - Adding or removing a track moves elements in removed cells back inside the grid.
  - With a grid container selected, drag the pink dividers on the canvas to resize two neighbouring columns. Flexible (`fr`) columns keep their total.
  - The preview shows which element sits in which cell; click one to select it.
- **Stack**: elements follow each other vertically or horizontally, with direction, wrap, distribution and alignment controls.

Every container has **gaps** (row and column can be linked) and **padding**. Padding sides are linked when they are equal; use the chain button to link or unlink them.

Sections also have:

- **Content width:** *Full width*, or *Boxed*, where the content stays centred within a maximum width while the background spans the page.
- **Height:** fit the content, half screen, full screen, or a custom value.

For the selected element, the Layout tab shows how it is positioned in its parent:

- **In a grid:**
  - **Docking:** 9-point docking, plus stretch width and height. Docking resets the margins, which are measured from the docked edge.
  - **Grid cell:** row and column, row and column span, and *Span all columns*.
- **In a stack:** alignment across the stack, and order. Below desktop, order applies only to that breakpoint and smaller.
- **Size:** width and height in px, %, vw, vh, rem, em or auto, plus *Stretch to full width* and min/max size limits.
- **Margin:** px, other units or `auto`.
- **Rotation** and **layer order (z)**.

Values are saved for the breakpoint you are editing. A dot marks a value set at this breakpoint, and × resets it to the inherited value.

The **Add** panel includes layout presets:

- Sections: boxed, full width, full screen and two-column. The two-column section switches to one column on mobile.
- Grids: two columns and three columns. The three-column grid uses two columns on tablet and one on mobile.
- Vertical and horizontal stacks, and a plain box.

## Breakpoints

- **Base design.** Desktop is the base. Every other breakpoint applies at its maximum width and below, and stores only what you change on it.
- **Managing breakpoints.** The ⋯ button next to the breakpoint switcher opens the breakpoint manager, where you can add (up to 5), rename, resize or remove breakpoints.
  - The manager shows how many elements each breakpoint changes.
  - Removing a breakpoint also removes its changes. Undo restores both.
- **Preview width.** Drag the handle on the right of the page to preview any width between 320 and 1920 px. The active breakpoint follows the width; choosing a breakpoint in the top bar resets the preview to its usual width.
- **Changed and inherited values.** Below desktop:
  - The inspector shows how many values the selected element changes on that breakpoint, with **Reset to inherited** to clear them all.
  - Single values have a dot and ×.
  - Inherited values show as grey placeholders.
  - Layers marks changed elements with ◆.
- **Hide per breakpoint.** Hide an element on any breakpoint with the eye in Layers, in Settings › Visible on, or with Ctrl/⌘+Shift+H.
- **Reading order.** Screen readers, and stacks on smaller screens, follow the Layers order. On Desktop, **Sort layers by position** (Layout tab of a container, or the right-click menu) reorders the content top to bottom and left to right as it appears on the page.

## Selecting several elements and arranging them

- Shift-click (or Ctrl/⌘-click) on the canvas or in Layers adds or removes elements. Dragging across empty section space draws a selection rectangle. Ctrl/⌘+A selects all elements that share the parent of the current one.
- A container and something inside it are never selected together: adding one replaces the other.
- With several elements selected, the inspector shows Align, Distribute, Match size, Arrange (layer order), Group, Duplicate, Lock and Delete. The same actions are in the right-click menu and on keyboard shortcuts.
  - **Align and distribute** work on elements in the same freeform grid. With one element selected, Align uses its container.
  - **Dragging** one of several selected elements in the same grid moves them all, and arrow keys nudge every selected element.
  - **Group** wraps elements of the same container in a new container and keeps their position. Below desktop, the group stacks its content so it stays readable on small screens. **Ungroup** puts the elements back where they were. Both work on Desktop only, because positions are measured there.
  - **Layer order** (bring forward / send backward) changes stacking within a grid.
- **Clipboard.** Copy, cut and paste work across pages and browser tabs, and pasted elements get new ids.
  - Pasting into the same container shifts the copy by 20 px; pasting into a different container drops the old grid position.
  - Sections paste after the current section.
  - **Copy design / Paste design** copies only the Design values.
- **Moving a section.** Drag its name tag above the selection box. Dragging inside a section draws a selection rectangle.

## Text editing

- **Start editing.** Double-click a text on the canvas, press Enter while it is selected, or click *Edit on canvas* in the Content tab. While you type, the resize handles are hidden. Changes save while you type; a burst of typing is one undo step.
- **Toolbar:**
  - **Text style:** Heading 1–6 or Paragraph 1–3, which sets the look and the matching tag. You can also choose a bulleted or numbered list.
  - **HTML tag:** P or H1–H6. Changing it does not change the look, so a heading can look like Paragraph 2 and still be an H2 for search engines.
  - **Font, size and weight** for the selected characters.
  - Bold, italic, underline and strikethrough (Ctrl+B / I / U).
  - Text colour and highlight, with the colour picker.
  - Alignment, line height and letter spacing for the selected paragraphs.
  - **Link** (Ctrl+K): page, section, web address, email, phone or file, optionally opening in a new tab. With the caret inside a link, you edit that link; *Remove link* removes it.
  - **Clear formatting:** removes character and paragraph formatting but keeps links.
- **Paste.** Pasted content keeps paragraphs, headings, lists, bold, italic, underline, strikethrough and http(s), mailto and tel links. Everything else is dropped: scripts, event handlers, styles, images and other links.
- **Stop editing.** Press Esc, click *Done*, or click anywhere else.

## Design tab

- **Colours.** Every colour field has a swatch that opens the picker:
  - theme colours and transparent
  - the last 10 colours you used (remembered in this browser)
  - a custom colour, with an opacity slider (saved as `#rrggbbaa`)
  - Eyedropper, in browsers that support it (Chrome, Edge)

  You can also type a hex value or `@name`.
- **Background:** colour, gradient, image or (sections and containers only) video.
  - Gradients take up to 8 colour stops with positions, and are linear or radial.
  - Images take a focal point: click the preview to choose the spot that stays visible when the image is cropped.
  - Images and videos accept an overlay colour.
- **Border, corners and shadows.** A border can apply to any sides. Corner radius is set per corner. You can stack up to four shadows, each of them outer or inner.
- **Blend mode and scroll effect** (parallax or reveal) are set per breakpoint, like every other Design value.
- **Hover** (collapsible group): text, background and border colour, shadow, opacity, scale, vertical movement and transition time. The hover design applies on every breakpoint. You can preview it by pointing at the element on the canvas.
- **Saved designs.** *Save design…* stores the element's design on all breakpoints under a name. *Apply saved design* copies it onto another element of the same type. You can remove saved designs in the Site panel.

## Site, media and templates

- **Media:** upload images and videos. Click an image to put it into the selected image element, or to add a new image after the selection.
- **Site:**
  - site name, description, language, social image, and visibility in search engines
  - theme colours: edit them, or add your own, which can be used as `@name`; every element that uses a colour updates
  - **Fonts:**
    - *Add a Google font*: the server downloads the WOFF2 files for the chosen weights, plus italics if you ask for them, and stores them with your uploads, so visitors never connect to Google.
    - *Upload font file*: WOFF2, WOFF, TTF or OTF.
    - Choose any font for headings or body text. You can remove a font only when nothing uses it.
  - **Text styles** (Heading 1–6, Paragraph 1–3): font, size, weight, line height, letter spacing, colour and case.
    - On Desktop they set the base design. On smaller breakpoints they override it, and empty fields inherit.
    - Every text that uses the style updates.
  - **Saved designs:** the list, with remove buttons.
- **Templates** (top bar):
  - built-in starting points and your saved templates; applying one replaces the draft, and Undo brings it back
  - save the current site as a template
  - export the draft as JSON, or import one; drafts from the classic builder are converted

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl/⌘+Y | Undo, redo |
| Ctrl/⌘+S | Save now |
| Delete / Backspace | Delete the selected element |
| Esc | Cancel the current drag, close a dialog, or select the parent |
| Arrows, Shift+arrows | Nudge by 1 px / 10 px |
| Layers: ↑ ↓ ← →, F2 / Enter, Alt+↑ / Alt+↓ | Navigate, rename, reorder |
| Ctrl/⌘+C, X, V, D | Copy, cut, paste, duplicate |
| Ctrl/⌘+Alt+C, Ctrl/⌘+Alt+V | Copy / paste design |
| Ctrl/⌘+G, Ctrl/⌘+Shift+G | Group, ungroup |
| Ctrl/⌘+] / [, with Shift | Bring forward / send backward, to front / to back |
| Ctrl/⌘+Shift+L, Ctrl/⌘+Shift+H | Lock / unlock, hide / show on this breakpoint |
| Ctrl/⌘+A | Select all siblings |
| ? | Shortcut list |

Each drag or edit is saved as a single undo step. Edits apply to the breakpoint shown in the top bar.
