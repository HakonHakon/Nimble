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

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl/⌘+Y | Undo, redo |
| Ctrl/⌘+S | Save now |
| Delete / Backspace | Delete the selected element |
| Esc | Cancel the current drag, close a dialog, or select the parent |
| Arrows, Shift+arrows | Nudge by 1 px / 10 px |
| Layers: ↑ ↓ ← →, F2 / Enter, Alt+↑ / Alt+↓ | Navigate, rename, reorder |

Each drag or edit is saved as a single undo step. Edits apply to the breakpoint shown in the top bar.
