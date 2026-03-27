'use client';

import { useState, useRef } from 'react';
import { Image as ImageIcon, Plus, Loader2, AlertCircle, Move } from 'lucide-react';
import { apiMockups } from '@/lib/api';

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

export function TemplateUploader({ onSuccess }: { onSuccess: () => void }) {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('tshirt');
    const [baseFile, setBaseFile] = useState<File | null>(null);
    const [maskFile, setMaskFile] = useState<File | null>(null);
    const [basePreview, setBasePreview] = useState('');
    const [printArea, setPrintArea] = useState<PrintArea>(DEFAULT_PRINT_AREAS.tshirt);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const containerRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);

    const getRelPos = (e: React.MouseEvent): { x: number; y: number } => {
        const r = containerRef.current?.getBoundingClientRect();
        if (!r) return { x: 0, y: 0 };
        return {
            x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        };
    };

    const onMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        dragStart.current = getRelPos(e);
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragStart.current) return;
        const pos = getRelPos(e);
        const sx = dragStart.current.x;
        const sy = dragStart.current.y;
        setPrintArea({
            x: Math.min(sx, pos.x),
            y: Math.min(sy, pos.y),
            width: Math.abs(pos.x - sx),
            height: Math.abs(pos.y - sy),
        });
    };

    const onMouseUp = () => { dragStart.current = null; };

    const onBaseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0] || null;
        if (!f) return;
        if (f.type !== 'image/png' && !f.name.toLowerCase().endsWith('.png')) {
            setError('Base image must be a PNG file');
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
            await apiMockups.uploadTemplate(fd);
            onSuccess();
        } catch (err: any) {
            setError(err.message || 'Upload failed');
            setUploading(false);
        }
    };

    return (
        <div className="space-y-4">
            {error && (
                <div className="px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-slate-300 mb-1.5">Template Name *</label>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. White T-Shirt Front"
                        className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                </div>
                <div>
                    <label className="block text-sm text-slate-300 mb-1.5">Category</label>
                    <select
                        value={category}
                        onChange={e => onCategoryChange(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                        {CATEGORIES.map(c => (
                            <option key={c} value={c}>{c.replace('_', ' ')}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm text-slate-300 mb-1.5">Base Image (PNG only) *</label>
                    <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-slate-800/30 transition-all min-h-[90px]">
                        {basePreview ? (
                            <img src={basePreview} alt="Base preview" className="h-14 object-contain rounded mb-1" />
                        ) : (
                            <ImageIcon className="w-7 h-7 text-slate-600 mb-1" />
                        )}
                        <span className="text-xs text-slate-500">{baseFile ? baseFile.name : 'Click to upload PNG'}</span>
                        <input type="file" accept=".png,image/png" onChange={onBaseChange} className="sr-only" />
                    </label>
                </div>
                <div>
                    <label className="block text-sm text-slate-300 mb-1.5">Mask Image (optional)</label>
                    <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-slate-800/30 transition-all min-h-[90px]">
                        <ImageIcon className="w-7 h-7 text-slate-600 mb-1" />
                        <span className="text-xs text-slate-500">{maskFile ? maskFile.name : 'Click to upload'}</span>
                        <input type="file" accept="image/*" onChange={e => setMaskFile(e.target.files?.[0] || null)} className="sr-only" />
                    </label>
                </div>
            </div>

            {/* Visual Print Area Selector */}
            <div>
                <label className="block text-sm text-slate-300 mb-1.5">
                    Print Area
                    {basePreview
                        ? <span className="text-slate-500 font-normal"> — drag on the image to define</span>
                        : <span className="text-slate-600 font-normal"> — upload base image to edit</span>}
                </label>
                <div
                    ref={containerRef}
                    className="relative w-full rounded-xl overflow-hidden border border-slate-700 bg-slate-900 select-none"
                    style={{ aspectRatio: '1 / 1', cursor: basePreview ? 'crosshair' : 'default' }}
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
                        <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
                            Upload base image to define print area
                        </div>
                    )}
                    {/* Print area rectangle overlay */}
                    <div
                        className="absolute border-2 border-blue-400 bg-blue-400/10 pointer-events-none"
                        style={{
                            left: `${printArea.x * 100}%`,
                            top: `${printArea.y * 100}%`,
                            width: `${printArea.width * 100}%`,
                            height: `${printArea.height * 100}%`,
                        }}
                    >
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Move className="w-4 h-4 text-blue-400 opacity-50" />
                        </div>
                    </div>
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                    x: {printArea.x.toFixed(3)} · y: {printArea.y.toFixed(3)} · w: {printArea.width.toFixed(3)} · h: {printArea.height.toFixed(3)}
                </p>
            </div>

            <div className="flex justify-end pt-1">
                <button
                    onClick={submit}
                    disabled={uploading}
                    className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20"
                >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {uploading ? 'Uploading...' : 'Create Template'}
                </button>
            </div>
        </div>
    );
}
