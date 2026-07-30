# Mockup Editor — Design Rotate Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable rotate handle on the placed-design preview in the Mockup Template Editor canvas, so users can spin the design directly instead of only using the numeric slider.

**Architecture:** All changes are in one file, `frontend/app/dashboard/mockups/MockupsClient.tsx` (the `TemplateEditor` component). Two new module-level pure helper functions compute the design's on-canvas bounds and the handle's world position; a new `rotatingDesign` boolean drag-state mirrors the existing `dragging`/`resizingAreaId` pattern; `draw()`, `onMouseDown`, `onMouseMove`, and `onMouseUp` each get a small, additive branch. No backend, schema, or API changes — `designRotation` already flows to `handleRender`'s `renderPayload.rotation` (line ~1401).

**Tech Stack:** React (client component, raw `<canvas>` 2D context — not react-konva), TypeScript.

---

### Task 1: Geometry helpers + `rotatingDesign` state

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Add two module-level helper functions above the `TemplateEditor` component**

Find this comment (marks the start of the component, currently ~line 865):

```ts
// ─── Template Editor with Konva Canvas ───────────────────────────────────────
```

Insert the two helper functions immediately **before** that comment line:

```ts
// Computes the placed design's on-canvas pixel bounds (center + size), matching
// the exact math used in draw()'s design block. Shared by draw() and the mouse
// handlers so hit-testing/rotation math never drifts from what's rendered.
function getDesignBounds(
    canvas: HTMLCanvasElement,
    printArea: { x: number; y: number; width: number; height: number },
    designImg: HTMLImageElement,
    designScale: number,
    designOffsetX: number,
    designOffsetY: number
) {
    const paX = printArea.x * canvas.width;
    const paY = printArea.y * canvas.height;
    const paW = printArea.width * canvas.width;
    const paH = printArea.height * canvas.height;
    const baseScale = Math.min(paW / designImg.width, paH / designImg.height);
    const finalScale = baseScale * designScale;
    const designW = designImg.width * finalScale;
    const designH = designImg.height * finalScale;
    const designX = paX + (paW - designW) / 2 + (designOffsetX / 100 * paW);
    const designY = paY + (paH - designH) / 2 + (designOffsetY / 100 * paH);
    return { centerX: designX + designW / 2, centerY: designY + designH / 2, designW, designH };
}

// World-space (canvas pixel) position of the rotate handle — the local point
// (0, -designH/2 - handleOffset), rotated by designRotation around the design center.
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

- [ ] **Step 2: Add the `rotatingDesign` drag-state**

Find (currently ~line 995-998):

```ts
    // Drag state (additional print areas)
    const [draggingAreaId, setDraggingAreaId] = useState<string | null>(null);
    const [resizingAreaId, setResizingAreaId] = useState<string | null>(null);
    const dragAreaStart = useRef({ mx: 0, my: 0, ax: 0, ay: 0, aw: 0, ah: 0 });
```

Replace with:

```ts
    // Drag state (additional print areas)
    const [draggingAreaId, setDraggingAreaId] = useState<string | null>(null);
    const [resizingAreaId, setResizingAreaId] = useState<string | null>(null);
    const dragAreaStart = useRef({ mx: 0, my: 0, ax: 0, ay: 0, aw: 0, ah: 0 });

    // Drag state (rotate handle on the placed design)
    const [rotatingDesign, setRotatingDesign] = useState(false);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output (the new helpers/state aren't used yet, so nothing can be wrong beyond syntax — if there's output, fix the reported syntax issue before continuing).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: add rotate-handle geometry helpers and drag state"
```

---

### Task 2: Draw the handle

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Draw the handle inside the existing design block**

Find (currently ~line 1118-1124, inside `draw()`, inside `if (designImgRef.current) { ... }`):

```ts
            // Draw with rotation
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            ctx.drawImage(designImg, -designW / 2, -designH / 2, designW, designH);
            
            ctx.restore();
        }
```

Replace with:

```ts
            // Draw with rotation
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            ctx.drawImage(designImg, -designW / 2, -designH / 2, designW, designH);

            // Rotate handle — drawn in the same translated/rotated space so it orbits with the design
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

- [ ] **Step 2: Add `rotatingDesign` to `draw()`'s dependency array**

Find (currently ~line 1191):

```ts
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designScale, designOffsetX, designOffsetY, designRotation]);
```

Replace with:

```ts
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designScale, designOffsetX, designOffsetY, designRotation, rotatingDesign]);
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: render rotate handle on placed design preview"
```

---

### Task 3: Hit-test and drag behavior

**Files:**
- Modify: `frontend/app/dashboard/mockups/MockupsClient.tsx`

- [ ] **Step 1: Start rotating on handle mousedown**

Find (currently ~line 1229-1234, start of `onMouseDown`):

```ts
    const onMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);
        const hs = 0.02;

        // Check additional print areas first (topmost = last in array)
```

Replace with:

```ts
    const onMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);
        const hs = 0.02;

        // Rotate handle (only when a design is placed in the primary print area)
        const canvasForHandle = canvasRef.current;
        if (canvasForHandle && designImgRef.current) {
            const pxX = x * canvasForHandle.width, pxY = y * canvasForHandle.height;
            const handlePos = getRotateHandleWorldPos(
                canvasForHandle, printArea, designImgRef.current, designScale, designOffsetX, designOffsetY, designRotation
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

- [ ] **Step 2: Update the design rotation while dragging the handle**

Find (currently ~line 1271-1275, start of `onMouseMove`):

```ts
    const onMouseMove = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);

        // Drag/resize additional print areas
        if (draggingAreaId) {
```

Replace with:

```ts
    const onMouseMove = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);

        // Rotating the placed design via the handle
        if (rotatingDesign) {
            const canvas = canvasRef.current;
            if (canvas && designImgRef.current) {
                const pxX = x * canvas.width, pxY = y * canvas.height;
                const { centerX, centerY } = getDesignBounds(canvas, printArea, designImgRef.current, designScale, designOffsetX, designOffsetY);
                const angleDeg = Math.atan2(pxX - centerX, -(pxY - centerY)) * 180 / Math.PI;
                setDesignRotation(Math.round(angleDeg));
            }
            return;
        }

        // Drag/resize additional print areas
        if (draggingAreaId) {
```

- [ ] **Step 3: Show a grab cursor when hovering the handle**

Find (currently ~line 1317-1320, the "Cursor hint" section near the end of `onMouseMove`):

```ts
        // Cursor hint
        const canvas = canvasRef.current;
        if (!canvas) return;
        const hs = 0.02;
```

Replace with:

```ts
        // Cursor hint
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (designImgRef.current) {
            const pxX = x * canvas.width, pxY = y * canvas.height;
            const handlePos = getRotateHandleWorldPos(
                canvas, printArea, designImgRef.current, designScale, designOffsetX, designOffsetY, designRotation
            );
            const hitR = Math.max(12, canvas.width * 0.015);
            if (Math.hypot(pxX - handlePos.x, pxY - handlePos.y) <= hitR) {
                canvas.style.cursor = 'grab';
                return;
            }
        }

        const hs = 0.02;
```

- [ ] **Step 4: Reset `rotatingDesign` on mouseup**

Find (currently ~line 1343-1347):

```ts
    const onMouseUp = () => {
        setDragging(null);
        setDraggingAreaId(null);
        setResizingAreaId(null);
    };
```

Replace with:

```ts
    const onMouseUp = () => {
        setDragging(null);
        setDraggingAreaId(null);
        setResizingAreaId(null);
        setRotatingDesign(false);
    };
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit --pretty false 2>&1 | grep -i MockupsClient`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/mockups/MockupsClient.tsx
git commit -m "feat: wire rotate-handle drag interaction and cursor hint"
```

---

### Task 4: Manual verification

Per project rule ([[feedback_asset_testing_endpoint]]): any asset-dependent visual test runs against `http://100.96.119.102:3000`, not `localhost:3000`.

**Files:** none (verification only).

- [ ] **Step 1: Open a template with a design already placed**

Navigate to `http://100.96.119.102:3000/dashboard/mockups`, open any T-shirt template, pick a design under "Apply Design" so `designImgRef.current` is populated and the handle renders.

- [ ] **Step 2: Verify the handle renders and tracks the box**

Confirm a small circle appears above the design, connected by a short line, and that it visually sits above the design's current position/rotation (not at a fixed screen position).

- [ ] **Step 3: Verify drag-to-rotate**

Click-drag the handle in a full circle. Confirm:
- The design rotates live and the "Rotation: N°" label under "Apply Design" updates in sync.
- Cursor shows `grab` when hovering the handle (before clicking).
- Releasing the mouse stops rotation (dragging elsewhere on the canvas afterward moves/resizes as before, not rotates).

- [ ] **Step 4: Verify the slider still works and both inputs agree**

Drag the existing "Apply Design > Rotation" slider to a specific value (e.g. 90°). Confirm the handle jumps to the matching world position (directly to the right of the design center at 90°).

- [ ] **Step 5: Verify render payload**

Click "Place Design & Render", confirm the request succeeds and the rendered output's design orientation matches what was shown in the live preview (no `render failed` errors, no rotation mismatch).

---

## Self-Review Notes

- **Spec coverage:** handle draws in the design's rotated frame (Task 2) ✓, hit-test + drag angle math (Task 3) ✓, shared `getDesignBounds`/`getRotateHandleWorldPos` helpers used by draw + both mouse handlers (Tasks 1-3) ✓, no schema/backend change (confirmed — only client state touched) ✓, `printAreas[]` multi-area preview untouched (no edits made to that code path) ✓, print-area box itself not rotatable (no changes to its drag/resize logic) ✓.
- **Type consistency:** `getDesignBounds` / `getRotateHandleWorldPos` signatures match their call sites exactly (`canvas, printArea, designImg, designScale, designOffsetX, designOffsetY[, designRotation]`) across Tasks 1, 2, and 3.
- No automated test framework exists for this canvas component (confirmed during brainstorming) — Task 4 is deliberately manual, matching the spec's Testing section.
