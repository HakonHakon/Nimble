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
