'use client';

import { useState, useRef } from 'react';
import { Image as ImageIcon, Plus, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { apiMockups } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

const CATEGORIES = ['tshirt', 'sweatshirt', 'hoodie', 'mug', 'sticker', 'phone_case'];

const DEFAULT_PRINT_AREAS: Record<string, { x: number; y: number; width: number; height: number }> = {
    tshirt:     { x: 0.35, y: 0.24, width: 0.30, height: 0.34 },
    hoodie:     { x: 0.34, y: 0.26, width: 0.31, height: 0.35 },
    sweatshirt: { x: 0.35, y: 0.24, width: 0.30, height: 0.34 },
    mug:        { x: 0.29, y: 0.36, width: 0.38, height: 0.26 },
    sticker:    { x: 0.10, y: 0.10, width: 0.80, height: 0.80 },
    phone_case: { x: 0.12, y: 0.15, width: 0.76, height: 0.70 },
};

interface PrintArea { x: number; y: number; width: number; height: number }

type DragMode = 'draw' | 'move' | 'resize' | null;
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_CURSORS: Record<Handle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    e: 'e-resize', se: 'se-resize', s: 's-resize', sw: 'sw-resize', w: 'w-resize',
};

export function TemplateUploader({ onSuccess }: { onSuccess: () => void }) {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('tshirt');
    const [baseFile, setBaseFile] = useState<File | null>(null);
    const [maskFile, setMaskFile] = useState<File | null>(null);
    const [basePreview, setBasePreview] = useState('');
    const [printArea, setPrintArea] = useState<PrintArea>(DEFAULT_PRINT_AREAS.tshirt);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [cursor, setCursor] = useState('crosshair');
    const [uploadedTemplateId, setUploadedTemplateId] = useState<string | null>(null);
    const [detecting, setDetecting] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const dragMode = useRef<DragMode>(null);
    const activeHandle = useRef<Handle | null>(null);
    const dragStart = useRef<{ x: number; y: number; rect: PrintArea } | null>(null);
    const printAreaRef = useRef<PrintArea>(printArea);
    printAreaRef.current = printArea;

    const getContainerRect = () => containerRef.current?.getBoundingClientRect();

    const getRelPos = (e: React.MouseEvent) => {
        const r = getContainerRect();
        if (!r) return { x: 0, y: 0 };
        return {
            x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        };
    };

    const getMinSize = (): number => {
        const r = getContainerRect();
        return r ? 50 / r.width : 0.05;
    };

    const isInsideRect = (px: number, py: number, rect: PrintArea) =>
        px >= rect.x && px <= rect.x + rect.width &&
        py >= rect.y && py <= rect.y + rect.height;

    const getHandleAt = (px: number, py: number, rect: PrintArea): Handle | null => {
        const r = getContainerRect();
        if (!r) return null;
        const t = 8 / r.width;
        const pts: [Handle, number, number][] = [
            ['nw', rect.x,                    rect.y],
            ['n',  rect.x + rect.width / 2,   rect.y],
            ['ne', rect.x + rect.width,        rect.y],
            ['e',  rect.x + rect.width,        rect.y + rect.height / 2],
            ['se', rect.x + rect.width,        rect.y + rect.height],
            ['s',  rect.x + rect.width / 2,   rect.y + rect.height],
            ['sw', rect.x,                    rect.y + rect.height],
            ['w',  rect.x,                    rect.y + rect.height / 2],
        ];
        for (const [h, hx, hy] of pts) {
            if (Math.abs(px - hx) <= t && Math.abs(py - hy) <= t) return h;
        }
        return null;
    };

    const onMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const pos = getRelPos(e);
        const pa = printAreaRef.current;
        const handle = getHandleAt(pos.x, pos.y, pa);

        if (handle) {
            dragMode.current = 'resize';
            activeHandle.current = handle;
        } else if (isInsideRect(pos.x, pos.y, pa)) {
            dragMode.current = 'move';
            activeHandle.current = null;
            setCursor('move');
        } else {
            dragMode.current = 'draw';
            activeHandle.current = null;
            setCursor('crosshair');
        }
        dragStart.current = { x: pos.x, y: pos.y, rect: { ...pa } };
    };

    const onMouseMove = (e: React.MouseEvent) => {
        const pos = getRelPos(e);

        if (!dragStart.current || !dragMode.current) {
            const pa = printAreaRef.current;
            const handle = getHandleAt(pos.x, pos.y, pa);
            const next = handle ? HANDLE_CURSORS[handle]
                : isInsideRect(pos.x, pos.y, pa) ? 'move'
                : 'crosshair';
            setCursor(prev => prev === next ? prev : next);
            return;
        }

        const dx = pos.x - dragStart.current.x;
        const dy = pos.y - dragStart.current.y;
        const orig = dragStart.current.rect;
        const min = getMinSize();

        if (dragMode.current === 'draw') {
            const sx = dragStart.current.x;
            const sy = dragStart.current.y;
            setPrintArea({
                x: Math.min(sx, pos.x),
                y: Math.min(sy, pos.y),
                width: Math.max(min, Math.abs(pos.x - sx)),
                height: Math.max(min, Math.abs(pos.y - sy)),
            });
        } else if (dragMode.current === 'move') {
            setPrintArea({
                x: Math.max(0, Math.min(1 - orig.width, orig.x + dx)),
                y: Math.max(0, Math.min(1 - orig.height, orig.y + dy)),
                width: orig.width,
                height: orig.height,
            });
        } else if (dragMode.current === 'resize' && activeHandle.current) {
            let { x, y, width, height } = orig;
            const h = activeHandle.current;

            if (h.includes('n')) {
                const newY = Math.min(orig.y + orig.height - min, orig.y + dy);
                height = orig.y + orig.height - newY;
                y = newY;
            }
            if (h.includes('s')) {
                height = Math.max(min, orig.height + dy);
            }
            if (h.includes('w')) {
                const newX = Math.min(orig.x + orig.width - min, orig.x + dx);
                width = orig.x + orig.width - newX;
                x = newX;
            }
            if (h.includes('e')) {
                width = Math.max(min, orig.width + dx);
            }

            x = Math.max(0, x);
            y = Math.max(0, y);
            width = Math.min(width, 1 - x);
            height = Math.min(height, 1 - y);
            setPrintArea({ x, y, width, height });
        }
    };

    const onMouseUp = () => {
        dragMode.current = null;
        activeHandle.current = null;
        dragStart.current = null;
    };

    const onBaseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0] || null;
        if (!f) return;
        if (!f.type.startsWith('image/')) {
            setError('Base image must be an image file (PNG, JPG, WEBP)');
            return;
        }
        setError('');
        setBaseFile(f);
        setBasePreview(URL.createObjectURL(f));
    };

    const onCategoryChange = (cat: string) => {
        setCategory(cat);
        setPrintArea(DEFAULT_PRINT_AREAS[cat] || DEFAULT_PRINT_AREAS.tshirt);
    };

    const submit = async () => {
        if (!baseFile) { setError('Base image is required'); return; }
        if (!name.trim()) { setError('Template name is required'); return; }

        setUploading(true);
        setError('');
        const fd = new FormData();
        fd.append('baseImage', baseFile);
        if (maskFile) fd.append('maskImage', maskFile);
        fd.append('name', name.trim());
        fd.append('category', category);
        fd.append('configJson', JSON.stringify({
            printArea,
            transform: { rotation: 0, opacity: 1, blendMode: 'multiply' },
            render: { renderMode: 'flat' },
            meta: { view: 'front', background: 'studio', color: 'white', hasHumanModel: false },
        }));

        try {
            const t = await apiMockups.uploadTemplate(fd);
            setUploadedTemplateId(t.id);
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Upload failed');
            setUploading(false);
        }
    };

    const getPixelDims = () => {
        const r = getContainerRect();
        if (!r) return null;
        return { w: Math.round(printArea.width * r.width), h: Math.round(printArea.height * r.height) };
    };

    const dims = basePreview ? getPixelDims() : null;

    const handles: [Handle, number, number][] = [
        ['nw', printArea.x,                   printArea.y],
        ['n',  printArea.x + printArea.width / 2, printArea.y],
        ['ne', printArea.x + printArea.width,  printArea.y],
        ['e',  printArea.x + printArea.width,  printArea.y + printArea.height / 2],
        ['se', printArea.x + printArea.width,  printArea.y + printArea.height],
        ['s',  printArea.x + printArea.width / 2, printArea.y + printArea.height],
        ['sw', printArea.x,                   printArea.y + printArea.height],
        ['w',  printArea.x,                   printArea.y + printArea.height / 2],
    ];

    return (
        <div className="space-y-4">
            {error && (
                <div className="px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-text-secondary mb-1.5">Template Name *</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. White T-Shirt Front"
                        className="w-full px-3 py-2.5 bg-bg-elevated border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                    />
                </div>
                <div>
                    <label className="block text-sm text-text-secondary mb-1.5">Category</label>
                    <select
                        value={category}
                        onChange={e => onCategoryChange(e.target.value)}
                        className="w-full px-3 py-2.5 bg-bg-elevated border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent"
                    >
                        {CATEGORIES.map(c => (
                            <option key={c} value={c}>{c.replace('_', ' ')}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-text-secondary mb-1.5">Base Image *</label>
                    <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-border-default rounded-xl cursor-pointer hover:border-accent/40 hover:bg-accent-subtle transition-all min-h-[90px]">
                        {basePreview ? (
                            <img src={basePreview} alt="Base preview" className="h-14 object-contain rounded mb-1" />
                        ) : (
                            <ImageIcon className="w-7 h-7 text-text-tertiary mb-1" />
                        )}
                        <span className="text-xs text-text-tertiary">{baseFile ? baseFile.name : 'Click to upload image'}</span>
                        <input type="file" accept="image/*" onChange={onBaseChange} className="sr-only" />
                    </label>
                </div>
                <div>
                    <label className="block text-sm text-text-secondary mb-1.5">Mask Image (optional)</label>
                    <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-border-default rounded-xl cursor-pointer hover:border-accent/40 hover:bg-accent-subtle transition-all min-h-[90px]">
                        <ImageIcon className="w-7 h-7 text-text-tertiary mb-1" />
                        <span className="text-xs text-text-tertiary">{maskFile ? maskFile.name : 'Click to upload'}</span>
                        <input type="file" accept="image/*" onChange={e => setMaskFile(e.target.files?.[0] || null)} className="sr-only" />
                    </label>
                </div>
            </div>

            {/* Visual Print Area Selector */}
            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm text-text-secondary">
                        Print Area
                        {basePreview
                            ? <span className="text-text-tertiary font-normal"> — drag to draw · drag inside to move · drag handles to resize</span>
                            : <span className="text-text-tertiary font-normal"> — upload base image to edit</span>}
                    </label>
                    {uploadedTemplateId && (
                        <button
                            onClick={async () => {
                                setDetecting(true);
                                try {
                                    const res = await fetch(`${API_BASE}/api/mockups/templates/detect-print-area`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({ templateId: uploadedTemplateId }),
                                    });
                                    const data = await res.json();
                                    if (data.printArea) {
                                        setPrintArea(data.printArea);
                                    } else {
                                        setError(data.error || 'Detection failed');
                                    }
                                } catch {
                                    setError('Detection failed');
                                } finally {
                                    setDetecting(false);
                                }
                            }}
                            disabled={detecting}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-xs rounded-lg border border-purple-500/30 transition-colors disabled:opacity-40"
                        >
                            {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            Auto Detect Print Area
                        </button>
                    )}
                </div>
                <div
                    ref={containerRef}
                    className="relative w-full rounded-xl overflow-hidden border border-border-default bg-bg-base select-none"
                    style={{ aspectRatio: '1 / 1', cursor: basePreview ? cursor : 'default' }}
                    onMouseDown={basePreview ? onMouseDown : undefined}
                    onMouseMove={basePreview ? onMouseMove : undefined}
                    onMouseUp={basePreview ? onMouseUp : undefined}
                    onMouseLeave={basePreview ? onMouseUp : undefined}
                >
                    {basePreview ? (
                        <img
                            src={basePreview}
                            alt="Mockup base"
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                            draggable={false}
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-text-tertiary text-sm">
                            Upload base image to define print area
                        </div>
                    )}

                    {/* Print area rectangle */}
                    <div
                        className="absolute border-2 border-accent bg-accent-subtle pointer-events-none"
                        style={{
                            left: `${printArea.x * 100}%`,
                            top: `${printArea.y * 100}%`,
                            width: `${printArea.width * 100}%`,
                            height: `${printArea.height * 100}%`,
                        }}
                    >
                        {dims && (
                            <div className="absolute -top-6 left-0 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-sm font-mono whitespace-nowrap leading-tight">
                                {dims.w} × {dims.h}
                            </div>
                        )}
                    </div>

                    {/* 8 resize handles */}
                    {basePreview && handles.map(([handle, hx, hy]) => (
                        <div
                            key={handle}
                            className="absolute w-2.5 h-2.5 bg-white border-2 border-accent rounded-sm pointer-events-none"
                            style={{
                                left: `calc(${hx * 100}% - 5px)`,
                                top: `calc(${hy * 100}% - 5px)`,
                                zIndex: 10,
                            }}
                        />
                    ))}
                </div>
                <p className="text-xs text-text-tertiary mt-1.5">
                    x: {printArea.x.toFixed(3)} · y: {printArea.y.toFixed(3)} · w: {printArea.width.toFixed(3)} · h: {printArea.height.toFixed(3)}
                </p>
            </div>

            <div className="flex justify-end pt-1">
                <button
                    onClick={submit}
                    disabled={uploading}
                    className="px-5 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-accent/20"
                >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {uploading ? 'Uploading...' : 'Create Template'}
                </button>
            </div>
        </div>
    );
}
