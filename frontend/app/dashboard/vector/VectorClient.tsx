'use client';

import { useState, useRef } from 'react';
import { apiTools } from '@/lib/api';
import { Upload, Wand2, Download, X, Loader2 } from 'lucide-react';

export function VectorClient() {
    const [sourceUrl, setSourceUrl] = useState<string | null>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [converting, setConverting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

    const handleFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file (PNG, JPG, WebP)');
            return;
        }
        const url = URL.createObjectURL(file);
        setSourceUrl(url);
        setResultUrl(null);
        setError(null);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    const handleConvert = async () => {
        if (!sourceUrl) return;
        setConverting(true);
        setError(null);
        try {
            // Upload the local blob to backend first if it's a local object URL
            let uploadUrl = sourceUrl;
            if (sourceUrl.startsWith('blob:')) {
                const blob = await fetch(sourceUrl).then(r => r.blob());
                const fd = new FormData();
                fd.append('file', blob, 'image.png');
                const res = await fetch(`${API_BASE}/api/tools/upload-temp`, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                });
                if (!res.ok) throw new Error('Failed to upload image');
                const data = await res.json();
                uploadUrl = data.url;
            }
            const result = await apiTools.vectorize(uploadUrl);
            setResultUrl(result.url);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setConverting(false);
        }
    };

    const handleDownload = async () => {
        if (!resultUrl) return;
        try {
            const r = await fetch(resultUrl);
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vector-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            window.open(resultUrl, '_blank');
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                    <Wand2 className="w-6 h-6 text-accent" />
                    Vector Conversion
                </h1>
                <p className="text-sm text-text-tertiary mt-1">
                    Convert PNG designs to vector illustration style using Recraft v3
                </p>
            </div>

            {/* Upload + Convert Area */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Input */}
                <div className="space-y-3">
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Original Image</p>
                    {!sourceUrl ? (
                        <div
                            onDrop={handleDrop}
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onClick={() => fileInputRef.current?.click()}
                            className={`aspect-square max-h-96 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                                dragOver
                                    ? 'border-accent bg-accent/10'
                                    : 'border-border-default bg-bg-elevated hover:border-accent/50 hover:bg-accent/5'
                            }`}
                        >
                            <Upload className="w-10 h-10 text-text-tertiary mb-3" />
                            <p className="text-sm font-medium text-text-secondary">Drop image here or click to upload</p>
                            <p className="text-xs text-text-tertiary mt-1">PNG, JPG, WebP</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                            />
                        </div>
                    ) : (
                        <div className="relative aspect-square max-h-96 rounded-2xl overflow-hidden bg-bg-elevated border border-border-default">
                            <img src={sourceUrl} alt="Source" className="w-full h-full object-contain" />
                            <button
                                onClick={() => { setSourceUrl(null); setResultUrl(null); setError(null); }}
                                className="absolute top-3 right-3 p-1.5 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Output */}
                <div className="space-y-3">
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Vector Result</p>
                    <div className="aspect-square max-h-96 flex items-center justify-center rounded-2xl border-2 border-dashed border-border-default bg-bg-elevated overflow-hidden">
                        {converting ? (
                            <div className="flex flex-col items-center gap-3 text-text-tertiary">
                                <Loader2 className="w-10 h-10 animate-spin text-accent" />
                                <p className="text-sm">Converting to vector…</p>
                            </div>
                        ) : resultUrl ? (
                            <img src={resultUrl} alt="Vector result" className="w-full h-full object-contain" />
                        ) : (
                            <div className="flex flex-col items-center gap-2 text-text-tertiary">
                                <Wand2 className="w-10 h-10 opacity-30" />
                                <p className="text-sm">Result will appear here</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-3 bg-red-600/10 border border-red-500/30 rounded-xl text-sm text-red-400">
                    {error}
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleConvert}
                    disabled={!sourceUrl || converting}
                    className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all"
                >
                    {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {converting ? 'Converting…' : 'Convert to Vector'}
                </button>

                {resultUrl && (
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-5 py-2.5 bg-bg-elevated hover:bg-bg-surface text-text-primary text-sm font-medium rounded-xl border border-border-default transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Download
                    </button>
                )}
            </div>
        </div>
    );
}
