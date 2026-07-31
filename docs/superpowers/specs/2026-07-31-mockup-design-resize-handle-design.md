# Mockup Editor — Design Resize Handle (separate from print-area resize)

## Problem

In `frontend/app/dashboard/mockups/MockupsClient.tsx`'s Template Editor canvas, the
only corner-drag resize handle currently belongs to the print area itself
(`printArea`/`printAreas[]` — the fixed physical print region, set up once per
template). There is no way to resize the *placed design* (`designScale`) by
dragging on canvas — only via the "Size" slider (20%–150%). Users instinctively
grab the print-area's corner handle expecting to resize their design, and end up
resizing the print region instead, which is meant to stay fixed.

## Scope

Mirrors the rotate-handle feature (`docs/superpowers/plans/2026-07-30-mockup-rotate-handle.md`)
exactly: same file, same `getDesignBounds`-derived geometry, same "own
save/restore scope so opacity/blend never hides it" pattern, same
`activeAreaBox`-resolution (post Task 6 fix) so it works correctly for both
single- and multi-print-area templates. Print-area's own resize/move handles
(template setup) are untouched.

## Design

**New handle position:** the design's bounding-box bottom-right corner in its
own rotated frame — local point `(designW/2, designH/2)` (before rotation),
rotated by `designRotation` around `(centerX, centerY)`, same rotation matrix
`getRotateHandleWorldPos` already uses for its top-center point. A new
`getDesignResizeHandleWorldPos` helper mirrors `getRotateHandleWorldPos` with
this different local point.

**Drag behavior:** on `onMouseMove` while `resizingDesign` is true, compute the
Euclidean distance from the design center to the current mouse position in
canvas-pixel space. Divide by the *unscaled* half-diagonal (`hypot(designW /
designScale, designH / designScale) / 2` — dividing the current, already-scaled
`designW`/`designH` by the current `designScale` recovers the design's
half-diagonal length at `designScale = 1`, no new geometry helper needed for
this). The ratio is the new `designScale`, rotation-invariant by construction
(distance-from-center doesn't care about angle) — clamp to `[0.2, 1.5]`,
matching the existing Size slider's `min="20" max="150"`.

**New state:** `resizingDesign` boolean, mirroring `rotatingDesign` — no drag-start
ref needed since, like rotation, the new scale is recomputed fresh from the
absolute mouse position on every move (not a delta from drag-start).

**Drawing:** a small filled square (not a circle, to read as visually distinct
from the rotate handle) at the corner, drawn inside the same second
`ctx.save()`/`ctx.restore()` block already used for the rotate handle (after
the design's own restore) — so it inherits the same translate+rotate and is
immune to the design's opacity/blend mode, matching the Task 6 fix.

**Hit-testing / cursor:** same pattern as the rotate handle — `onMouseDown`
checks the corner's world position (via `getDesignResizeHandleWorldPos`)
against a pixel-radius hit zone, `onMouseMove`'s cursor-hint section shows a
resize cursor (`nwse-resize`) on hover. Checked at the same priority tier as
the rotate-handle hit-test (before the print-area move/resize checks), since
the two design handles must never be shadowed by an overlapping print-area
drag zone.

**Out of scope:** print-area's own resize handle and drag logic — completely
unchanged. Non-uniform (width-only or height-only) design resize — this is
uniform/proportional scale only, matching the existing Size slider's behavior.

## Testing

Manual only (same canvas component, no automated test framework, as
established in the rotate-handle work). Verify: dragging the new corner
handle changes `designScale` (Size slider updates in sync) without moving or
resizing `printArea`/the active `printAreas[]` entry; rotate handle and resize
handle don't interfere with each other at any rotation angle; works correctly
for both single- and multi-area templates (the Task 6 regression class);
render output matches the live preview.
