# Mockup Editor — Design Rotate Handle

## Problem

`frontend/app/dashboard/mockups/MockupsClient.tsx` (Template Editor canvas) already lets a user drag-move and corner-resize the print area box, and has a `designRotation` slider (-180°..180°, "Apply Design" panel) that rotates the placed design. There is no direct-manipulation way to rotate — only the numeric slider. Users expect to grab a handle on the canvas and spin the design like any standard design tool.

## Scope

Applies to the **primary single-area preview** only (`printArea` singular state + `designImgRef`/`designRotation`/`designScale`/`designOffsetX/Y`) — the same code path the existing scale/offset sliders already drive. The secondary `printAreas[]` array preview (multi-area static thumbnails, no live scale/rotate today) is untouched — out of scope, matches current feature parity.

No schema or backend change: `designRotation` is already sent as `renderPayload.rotation` at render time (`handleRender`, line ~1401). This only adds a second input method for the same value.

## Design

**Interaction:** a small circular handle appears above the placed design's bounding box (in the design's own rotated frame, so it visually orbits with the design). Dragging it computes the angle from the design center to the cursor and sets `designRotation` (rounded to whole degrees, clamped -180..180 — `atan2` already returns that range). The existing slider keeps working since both write to the same `designRotation` state.

**New state:** one boolean, `rotatingDesign` (drag-in-progress flag), mirroring the existing `dragging`/`resizingAreaId` pattern. Reset in `onMouseUp` alongside the others.

**Shared geometry helper:** extract a `getDesignBounds(canvas)` function (centerX, centerY, designW, designH in canvas-pixel space) — the same math currently inlined in `draw()` (lines ~1108-1116). Reused by:
- `draw()` — unchanged output, now calls the helper.
- `onMouseDown` — hit-tests the handle position (inverse-rotate the click point into the design's local frame, or equivalently rotate the handle's local point into world space and compare distance — implementation will do the latter, it's simpler).
- `onMouseMove` — while `rotatingDesign`, recompute the angle each frame.

**Drawing the handle:** inside `draw()`'s existing `if (designImgRef.current) { ... }` block, after `ctx.drawImage(...)` but before `ctx.restore()` — so it inherits the same `translate` + `rotate` already applied for the design itself. Draw a short line from the top edge of the design bounding box outward, plus a filled circle at the end (radius/offset proportional to `canvas.width` so it scales with zoom, matching the existing resize-handle sizing convention). Circle fill color reflects hover/active state for affordance.

**Hit-testing / angle math:**
- Handle's local point (before rotation): `(0, -designH/2 - handleOffset)`.
- World position: rotate that local point by `designRotation` around `(centerX, centerY)`.
- `onMouseDown`: if the click is within a small pixel radius of that world point, start rotating (`setRotatingDesign(true)`) instead of falling through to the existing move/resize checks.
- `onMouseMove` (while rotating): `angleDeg = atan2(pxX - centerX, -(pxY - centerY)) * 180/π` — this convention already matches the slider's sign/range (0° = handle straight up, clockwise-positive, same direction `ctx.rotate(designRotation)` already rotates).
- Cursor: show a distinct cursor (e.g. `grab`/`grabbing`) when hovering/dragging the handle, same pattern as existing `se-resize`/`move` cursor hints.

**Out of scope / explicitly not doing:** no rotation for the print-area box itself (that stays axis-aligned — it maps to real print-file production coordinates, rotating it wouldn't be meaningful). No changes to `printAreas[]` multi-area preview. No new persisted config field.

## Testing

Manual verification only (this is a canvas interaction, no existing test harness for this component): drag the handle through a full 360° sweep, confirm the slider value updates live and matches; confirm slider edits move the handle to the matching position; confirm render output (`handleRender`) still uses the correct final `designRotation`.
