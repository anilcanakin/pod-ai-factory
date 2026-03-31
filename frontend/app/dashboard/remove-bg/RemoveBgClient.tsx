'use client';

import { useState, useRef } from 'react';
import { apiTools } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Upload, X, Scissors, Loader2, Download, Play, CheckCircle } from 'lucide-react';

type BgModel = 'birefnet' | 'bria' | 'pixelcut';

interface ImageCard {
    id: string;
    sourceUrl: string;
    resultUrl: string | null;
    status: 'idle' | 'processing' | 'done' | 'error';
}

const CHECKERBOARD = "bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3C/svg%3E')]";

export function RemoveBgClient() {
    const [cards, setCards] = useState<ImageCard[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [selectedModel, setSelectedModel] = useState<BgModel>('birefnet');
    const [processAllRunning, setProcessAllRunning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const readFile = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) { reject(new Error('Not an image')); return; }
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const addFiles = async (files: FileList | File[]) => {
        const remaining = 5 - cards.length;
        if (remaining <= 0) { toast.error('Maximum 5 images allowed'); return; }
        const toAdd = Array.from(files).slice(0, remaining);
        const newCards: ImageCard[] = [];
        for (const file of toAdd) {
            try {
                const url = await readFile(file);
                newCards.push({ id: `${Date.now()}-${Math.random()}`, sourceUrl: url, resultUrl: null, status: 'idle' });
            } catch { toast.error(`${file.name} is not a valid image`); }
        }
        setCards(prev => [...prev, ...newCards]);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    };

    const removeCard = (id: string) => setCards(prev => prev.filter(c => c.id !== id));

    const processCard = async (id: string, model: BgModel) => {
        const card = cards.find(c => c.id === id);
        if (!card || card.status === 'processing') return;
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'processing' } : c));
        try {
            const result = await apiTools.removeBg(card.sourceUrl, model);
            setCards(prev => prev.map(c => c.id === id ? { ...c, resultUrl: result.url, status: 'done' } : c));
            toast.success(`BG removed — ${result.model}`);
        } catch (err: unknown) {
            setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'error' } : c));
            toast.error(err instanceof Error ? err.message : 'Failed');
        }
    };

    const processAll = async () => {
        const idle = cards.filter(c => c.status === 'idle' || c.status === 'error');
        if (idle.length === 0) { toast.error('No images to process'); return; }
        setProcessAllRunning(true);
        await Promise.all(idle.map(c => processCard(c.id, selectedModel)));
        setProcessAllRunning(false);
    };

    const downloadImage = async (url: string, filename: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(objectUrl);
        } catch { toast.error('Download failed'); }
    };

    const MODELS: { value: BgModel; label: string; note: string }[] = [
        { value: 'birefnet', label: 'BiRefNet', note: 'Free · High quality' },
        { value: 'bria', label: 'Bria Pro', note: '$0.018 · Commercial' },
        { value: 'pixelcut', label: 'Pixelcut', note: 'E-commerce optimized' },
    ];

    const idleCount = cards.filter(c => c.status === 'idle' || c.status === 'error').length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-text-primary">Background Removal</h1>
                <p className="text-sm text-text-secondary mt-1">Remove backgrounds from up to 5 images at once</p>
            </div>

            {/* Model selector + Process All */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1.5">
                    {MODELS.map(m => (
                        <button
                            key={m.value}
                            onClick={() => setSelectedModel(m.value)}
                            className={cn(
                                'flex flex-col items-start px-3 py-2 rounded-[8px] border text-left transition-colors',
                                selectedModel === m.value
                                    ? 'bg-accent-subtle border-accent/50 text-accent'
                                    : 'bg-bg-elevated border-border-default text-text-secondary hover:border-border-strong'
                            )}
                        >
                            <span className="text-xs font-medium">{m.label}</span>
                            <span className="text-[10px] text-text-tertiary">{m.note}</span>
                        </button>
                    ))}
                </div>

                {idleCount > 0 && (
                    <button
                        onClick={processAll}
                        disabled={processAllRunning}
                        className="ml-auto flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-[8px] transition-colors"
                    >
                        {processAllRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Process All ({idleCount})
                    </button>
                )}
            </div>

            {/* Drop zone */}
            {cards.length < 5 && (
                <div
                    className={cn(
                        'border-2 border-dashed rounded-[12px] p-10 text-center cursor-pointer transition-all',
                        isDragging
                            ? 'border-accent bg-accent-subtle'
                            : 'border-border-default hover:border-border-strong bg-bg-elevated'
                    )}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={e => e.target.files && addFiles(e.target.files)}
                    />
                    <Upload className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
                    <p className="text-sm font-medium text-text-primary mb-1">
                        Drop images here or <span className="text-accent">browse</span>
                    </p>
                    <p className="text-xs text-text-tertiary">
                        JPG, PNG, WEBP · {cards.length > 0 ? `${5 - cards.length} slot${5 - cards.length !== 1 ? 's' : ''} remaining` : 'Up to 5 images'}
                    </p>
                </div>
            )}

            {/* Cards grid */}
            {cards.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cards.map((card, idx) => (
                        <div key={card.id} className="bg-bg-elevated border border-border-default rounded-[12px] overflow-hidden">
                            {/* Card header */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
                                <span className="text-xs text-text-tertiary font-mono">Image {idx + 1}</span>
                                <div className="flex items-center gap-2">
                                    {card.status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                                    {card.status === 'error' && <span className="text-[10px] text-danger">Error — retry</span>}
                                    <button onClick={() => removeCard(card.id)} className="text-text-tertiary hover:text-danger transition-colors">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            {/* Before / After */}
                            <div className={cn('grid', card.resultUrl ? 'grid-cols-2' : 'grid-cols-1')}>
                                <div className="relative">
                                    {card.resultUrl && (
                                        <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded z-10">Before</span>
                                    )}
                                    <img src={card.sourceUrl} alt="Original" className="w-full object-cover aspect-square" />
                                </div>
                                {card.resultUrl && (
                                    <div className={cn('relative aspect-square', CHECKERBOARD)}>
                                        <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded z-10">After</span>
                                        <img src={card.resultUrl} alt="Result" className="w-full h-full object-cover" />
                                    </div>
                                )}
                            </div>

                            {/* Card footer */}
                            <div className="p-3 space-y-2">
                                {card.status !== 'done' && (
                                    <button
                                        onClick={() => processCard(card.id, selectedModel)}
                                        disabled={card.status === 'processing'}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-medium rounded-[8px] transition-colors"
                                    >
                                        {card.status === 'processing'
                                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                                            : <><Scissors className="w-3.5 h-3.5" /> Remove BG</>
                                        }
                                    </button>
                                )}
                                {card.resultUrl && (
                                    <button
                                        onClick={() => downloadImage(card.resultUrl!, `removed-bg-${idx + 1}-${Date.now()}.png`)}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[8px] border border-border-default transition-colors"
                                    >
                                        <Download className="w-3.5 h-3.5" /> Download PNG
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
