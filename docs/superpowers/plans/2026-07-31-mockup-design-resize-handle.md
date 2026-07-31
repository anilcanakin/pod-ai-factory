# Mockup Editor — Design Resize Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable corner resize handle on the placed-design preview, separate from the print-area's own resize handle, so dragging it changes `designScale` (not `printArea`/`printAreas[]`).

**Architecture:** All changes are in one file, `frontend/app/dashboard/mockups/MockupsClient.tsx` (the `TemplateEditor` component) — same file as the rotate-handle feature, following the exact same pattern (module-level geometry helper, boolean drag-state, own save/restore scope for drawing, priority hit-test in the mouse handlers). A new `getDesignResizeHandleWorldPos` helper computes the corner's world position; a new `resizingDesign` boolean state tracks the drag; `draw()`, `onMouseDown`, `onMouseMove`, `onMouseUp` each get a small additive branch, mirroring the rotate handle's structure exactly.

**Tech Stack:** React (client component, raw `<canvas>` 2D context), TypeScript.

**Prior art:** `docs/superpowers/plans/2026-07-30-mockup-rotate-handle.md` (the rotate-handle feature this mirrors) and `docs/superpowers/specs/2026-07-31-mockup-design-resize-handle-design.md` (this feature's design doc).

---

### Task 1: Geometry helper + `resizingDesign` state

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Add `getDesignResizeHandleWorldPos` after `getRotateHandleWorldPos`**

Find (the end of `getRotateHandleWorldPos`, currently ~line 891-909):

```ts
function getRotateHandleWorldPos(
    canvas: HTMLCanvasElement,
    printArea: { x: number; y: number; width: number; height: number },
    designImg: HTMLImageElement,
    designScale: number,
    designOffsetX: number,
    designOffsetY: number,
    designRotation: number
) {
    const { centerX, centerY, designH } = getDesignBounds(canvas, printArea, designImg, designScale, designOffsetX, designOffsetY);
    const handleOffset = Math.max(24, canvas.width * 0.03);
    const localX = 0;
    const localY = -designH / 2 - handleOffset;
    const rad = (designRotation * Math.PI) / 180;
    return {
        x: centerX + localX * Math.cos(rad) - localY * Math.sin(rad),
        y: centerY + localX * Math.sin(rad) + localY * Math.cos(rad),
    };
}
```

Insert immediately after it (same file, still before the `TemplateEditor` component):

```ts

// World-space (canvas pixel) position of the design's own bottom-right resize
// handle — the local point (designW/2, designH/2), rotated by designRotation
// around the design center. Separate from the print-area's own resize handle:
// dragging this changes designScale, never printArea/printAreas[].
function getDesignResizeHandleWorldPos(
    canvas: HTMLCanvasElement,
    printArea: { x: number; y: number; width: number; height: number },
    designImg: HTMLImageElement,
    designScale: number,
    designOffsetX: number,
    designOffsetY: number,
    designRotation: number
) {
    const { centerX, centerY, designW, designH } = getDesignBounds(canvas, printArea, designImg, designScale, designOffsetX, designOffsetY);
    const localX = designW / 2;
    const localY = designH / 2;
    const rad = (designRotation * Math.PI) / 180;
    return {
        x: centerX + localX * Math.cos(rad) - localY * Math.sin(rad),
        y: centerY + localX * Math.sin(rad) + localY * Math.cos(rad),
    };
}
```

- [ ] **Step 2: Add the `resizingDesign` drag-state**

Find (currently ~line 1046):

```ts
    // Drag state (rotate handle on the placed design)
    const [rotatingDesign, setRotatingDesign] = useState(false);
```

Replace with:

```ts
    // Drag state (rotate handle on the placed design)
    const [rotatingDesign, setRotatingDesign] = useState(false);
    // Drag state (resize handle on the placed design — separate from print-area resize)
    const [resizingDesign, setResizingDesign] = useState(false);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output (new function/state aren't used yet — that's fine).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: add design resize-handle geometry helper and drag state"
```

---

### Task 2: Draw the resize handle

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Draw a square handle at the design's corner, in the same isolated scope as the rotate handle**

Find (in `draw()`, the rotate handle's own save/restore block, currently ~line 1174-1194):

```ts
            // Rotate handle — own transform/opacity scope so low design opacity or
            // multiply blend mode never hides the handle itself
            ctx.save();
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            const handleOffset = Math.max(24, canvas.width * 0.03);
            const handleRadius = Math.max(7, canvas.width * 0.009);
            ctx.beginPath();
            ctx.moveTo(0, -designH / 2);
            ctx.lineTo(0, -designH / 2 - handleOffset);
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = Math.max(1.5, canvas.width * 0.002);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, -designH / 2 - handleOffset, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = rotatingDesign ? '#3b82f6' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }
```

Replace with:

```ts
            // Rotate handle — own transform/opacity scope so low design opacity or
            // multiply blend mode never hides the handle itself
            ctx.save();
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            const handleOffset = Math.max(24, canvas.width * 0.03);
            const handleRadius = Math.max(7, canvas.width * 0.009);
            ctx.beginPath();
            ctx.moveTo(0, -designH / 2);
            ctx.lineTo(0, -designH / 2 - handleOffset);
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = Math.max(1.5, canvas.width * 0.002);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, -designH / 2 - handleOffset, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = rotatingDesign ? '#3b82f6' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Design resize handle — bottom-right corner of the design's own bounding
            // box, square (vs. the rotate handle's circle) so the two read as distinct.
            // Separate from the print-area's own bottom-right resize handle.
            const resizeHandleSize = Math.max(12, canvas.width * 0.016);
            ctx.fillStyle = resizingDesign ? '#3b82f6' : '#ffffff';
            ctx.fillRect(designW / 2 - resizeHandleSize / 2, designH / 2 - resizeHandleSize / 2, resizeHandleSize, resizeHandleSize);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.strokeRect(designW / 2 - resizeHandleSize / 2, designH / 2 - resizeHandleSize / 2, resizeHandleSize, resizeHandleSize);
            ctx.restore();
        }
```

- [ ] **Step 2: Add `resizingDesign` to `draw()`'s dependency array**

Find (currently ~line 1263):

```ts
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designScale, designOffsetX, designOffsetY, designRotation, rotatingDesign]);
```

Replace with:

```ts
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designScale, designOffsetX, designOffsetY, designRotation, rotatingDesign, resizingDesign]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: render design resize handle on placed design preview"
```

---

### Task 3: Hit-test and drag behavior

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Start resizing on handle mousedown**

Find (in `onMouseDown`, the rotate-handle hit-test block, currently ~line 1305-1320):

```ts
        // Rotate handle (only when a design is placed in the primary print area)
        const canvasForHandle = canvasRef.current;
        const activeDesignImgForHandle = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
        if (canvasForHandle && activeDesignImgForHandle) {
            const pxX = x * canvasForHandle.width, pxY = y * canvasForHandle.height;
            const activeAreaBoxForHandle = printAreas.find(a => a.id === activeAreaId) ?? printArea;
            const handlePos = getRotateHandleWorldPos(
                canvasForHandle, activeAreaBoxForHandle, activeDesignImgForHandle, designScale, designOffsetX, designOffsetY, designRotation
            );
            const hitR = Math.max(12, canvasForHandle.width * 0.015);
            if (Math.hypot(pxX - handlePos.x, pxY - handlePos.y) <= hitR) {
                setRotatingDesign(true);
                e.preventDefault();
                return;
            }
        }

        // Check additional print areas first (topmost = last in array)
```

Replace with:

```ts
        // Rotate handle (only when a design is placed in the primary print area)
        const canvasForHandle = canvasRef.current;
        const activeDesignImgForHandle = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
        if (canvasForHandle && activeDesignImgForHandle) {
            const pxX = x * canvasForHandle.width, pxY = y * canvasForHandle.height;
            const activeAreaBoxForHandle = printAreas.find(a => a.id === activeAreaId) ?? printArea;
            const handlePos = getRotateHandleWorldPos(
                canvasForHandle, activeAreaBoxForHandle, activeDesignImgForHandle, designScale, designOffsetX, designOffsetY, designRotation
            );
            const hitR = Math.max(12, canvasForHandle.width * 0.015);
            if (Math.hypot(pxX - handlePos.x, pxY - handlePos.y) <= hitR) {
                setRotatingDesign(true);
                e.preventDefault();
                return;
            }

            // Design resize handle (bottom-right corner of the design's own box)
            const resizeHandlePos = getDesignResizeHandleWorldPos(
                canvasForHandle, activeAreaBoxForHandle, activeDesignImgForHandle, designScale, designOffsetX, designOffsetY, designRotation
            );
            const resizeHitR = Math.max(12, canvasForHandle.width * 0.015);
            if (Math.hypot(pxX - resizeHandlePos.x, pxY - resizeHandlePos.y) <= resizeHitR) {
                setResizingDesign(true);
                e.preventDefault();
                return;
            }
        }

        // Check additional print areas first (topmost = last in array)
```

- [ ] **Step 2: Compute new `designScale` while dragging the resize handle**

Find (in `onMouseMove`, the rotate-drag branch, currently ~line 1363-1375):

```ts
        // Rotating the placed design via the handle
        if (rotatingDesign) {
            const canvas = canvasRef.current;
            const activeDesignImgForRotate = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
            if (canvas && activeDesignImgForRotate) {
                const pxX = x * canvas.width, pxY = y * canvas.height;
                const activeAreaBoxForRotate = printAreas.find(a => a.id === activeAreaId) ?? printArea;
                const { centerX, centerY } = getDesignBounds(canvas, activeAreaBoxForRotate, activeDesignImgForRotate, designScale, designOffsetX, designOffsetY);
                const angleDeg = Math.atan2(pxX - centerX, -(pxY - centerY)) * 180 / Math.PI;
                setDesignRotation(Math.round(angleDeg));
            }
            return;
        }

        // Drag/resize additional print areas
```

Replace with:

```ts
        // Rotating the placed design via the handle
        if (rotatingDesign) {
            const canvas = canvasRef.current;
            const activeDesignImgForRotate = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
            if (canvas && activeDesignImgForRotate) {
                const pxX = x * canvas.width, pxY = y * canvas.height;
                const activeAreaBoxForRotate = printAreas.find(a => a.id === activeAreaId) ?? printArea;
                const { centerX, centerY } = getDesignBounds(canvas, activeAreaBoxForRotate, activeDesignImgForRotate, designScale, designOffsetX, designOffsetY);
                const angleDeg = Math.atan2(pxX - centerX, -(pxY - centerY)) * 180 / Math.PI;
                setDesignRotation(Math.round(angleDeg));
            }
            return;
        }

        // Resizing the placed design via its own corner handle (never touches printArea)
        if (resizingDesign) {
            const canvas = canvasRef.current;
            const activeDesignImgForResize = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
            if (canvas && activeDesignImgForResize) {
                const pxX = x * canvas.width, pxY = y * canvas.height;
                const activeAreaBoxForResize = printAreas.find(a => a.id === activeAreaId) ?? printArea;
                const { centerX, centerY, designW, designH } = getDesignBounds(canvas, activeAreaBoxForResize, activeDesignImgForResize, designScale, designOffsetX, designOffsetY);
                const distMouse = Math.hypot(pxX - centerX, pxY - centerY);
                const unscaledHalfDiag = Math.hypot(designW / designScale, designH / designScale) / 2;
                const newScale = distMouse / unscaledHalfDiag;
                setDesignScale(Math.max(0.2, Math.min(1.5, newScale)));
            }
            return;
        }

        // Drag/resize additional print areas
```

- [ ] **Step 3: Show a resize cursor when hovering the handle**

Find (in `onMouseMove`'s cursor-hint section, currently ~line 1424-1436):

```ts
        const activeDesignImgForCursor = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
        if (activeDesignImgForCursor) {
            const pxX = x * canvas.width, pxY = y * canvas.height;
            const activeAreaBoxForCursor = printAreas.find(a => a.id === activeAreaId) ?? printArea;
            const handlePos = getRotateHandleWorldPos(
                canvas, activeAreaBoxForCursor, activeDesignImgForCursor, designScale, designOffsetX, designOffsetY, designRotation
            );
            const hitR = Math.max(12, canvas.width * 0.015);
            if (Math.hypot(pxX - handlePos.x, pxY - handlePos.y) <= hitR) {
                canvas.style.cursor = 'grab';
                return;
            }
        }

        const hs = 0.02;
```

Replace with:

```ts
        const activeDesignImgForCursor = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
        if (activeDesignImgForCursor) {
            const pxX = x * canvas.width, pxY = y * canvas.height;
            const activeAreaBoxForCursor = printAreas.find(a => a.id === activeAreaId) ?? printArea;
            const handlePos = getRotateHandleWorldPos(
                canvas, activeAreaBoxForCursor, activeDesignImgForCursor, designScale, designOffsetX, designOffsetY, designRotation
            );
            const hitR = Math.max(12, canvas.width * 0.015);
            if (Math.hypot(pxX - handlePos.x, pxY - handlePos.y) <= hitR) {
                canvas.style.cursor = 'grab';
                return;
            }

            const resizeHandlePos = getDesignResizeHandleWorldPos(
                canvas, activeAreaBoxForCursor, activeDesignImgForCursor, designScale, designOffsetX, designOffsetY, designRotation
            );
            const resizeHitR = Math.max(12, canvas.width * 0.015);
            if (Math.hypot(pxX - resizeHandlePos.x, pxY - resizeHandlePos.y) <= resizeHitR) {
                canvas.style.cursor = 'nwse-resize';
                return;
            }
        }

        const hs = 0.02;
```

- [ ] **Step 4: Reset `resizingDesign` on mouseup**

Find (currently ~line 1461-1466):

```ts
    const onMouseUp = () => {
        setDragging(null);
        setDraggingAreaId(null);
        setResizingAreaId(null);
        setRotatingDesign(false);
    };
```

Replace with:

```ts
    const onMouseUp = () => {
        setDragging(null);
        setDraggingAreaId(null);
        setResizingAreaId(null);
        setRotatingDesign(false);
        setResizingDesign(false);
    };
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: wire design resize-handle drag interaction and cursor hint"
```

---

### Task 4: Manual verification

Per project rule ([[feedback_asset_testing_endpoint]]): asset-dependent visual tests
use `http://100.96.119.102:3000`, or a temporary seeded `MockupTemplate` pointing at
a base image already present on whichever machine you're testing on (do NOT use a
wildcard/glob delete on any shared `assets/` path when cleaning up afterward —
delete only the specific file(s)/rows you created, by exact name/id).

**Files:** none (verification only).

- [ ] **Step 1: Single print-area case**

Open a template, assign a design. Drag the new square corner handle outward:
confirm `designScale` increases (Size slider updates in sync) and the print
area's own boundary (dashed border / blue corner square, template-setup mode)
does NOT move or resize. Drag inward: confirm scale decreases, clamped at 20%.
Drag far past the edge: confirm it clamps at 150%, doesn't error.

- [ ] **Step 2: Interaction with rotation**

Rotate the design ~45°/90°/135° via the rotate handle, then drag the resize
handle: confirm it still scales correctly (the corner handle should visually
follow the rotated corner, and dragging it should not snap rotation back to 0
or otherwise fight with `designRotation`).

- [ ] **Step 3: Multi-area case**

Repeat Task 6's multi-area setup (2+ `printAreas`, design assigned to the
non-default/second area). Confirm the resize handle appears at the correct
area's design corner (not the wrong area's), and dragging it only changes
`designScale` for that area's design — the OTHER area's print region is
unaffected.

- [ ] **Step 4: No interference with existing handles**

Confirm the print-area's own bottom-right resize handle (template setup mode)
still works exactly as before — grabbing near IT (not the design's corner)
still resizes `printArea`/the active `printAreas[]` entry, not `designScale`.
Confirm rotate handle and resize handle each only respond to their own hit
zone (dragging one doesn't accidentally trigger the other).

- [ ] **Step 5: Render output matches preview**

Click "Place Design & Render" after resizing via the handle: confirm the
rendered output's design size matches what the live preview showed.

- [ ] **Step 6: Clean up**

Delete any temporary `MockupTemplate` row / rendered output file created for
this test, by exact id/filename only.

---

## Self-Review Notes

- **Spec coverage:** new handle at design's own corner (not print-area's) ✓, distance-based rotation-invariant scale computation ✓, clamped to slider's existing 20–150% range ✓, drawn in the rotate-handle's existing isolated opacity/blend-immune scope ✓, uses the Task-6-fixed `activeAreaBox` resolution so multi-area templates work correctly ✓, print-area's own resize/move logic completely untouched (no edits to those code paths) ✓.
- **Type consistency:** `getDesignResizeHandleWorldPos` signature matches `getRotateHandleWorldPos`'s exactly (`canvas, printArea, designImg, designScale, designOffsetX, designOffsetY, designRotation`) for consistency; both are called with `activeAreaBoxFor*`-style locals at each call site, matching the established Task 6 convention.
- No automated test framework exists for this canvas component — Task 4 is deliberately manual, matching prior plans' Testing sections.
