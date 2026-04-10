'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiTools, apiGallery, type GalleryImage } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Upload, X, Scissors, Loader2, Download, Play, CheckCircle, Image as ImageIcon, Search } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

type BgModel = 'birefnet' | 'bria' | 'pixelcut';

interface ImageCard {
    id: string;
    sourceUrl: string;
    resultUrl: string | null;
    status: 'idle' | 'processing' | 'done' | 'error';
}

const CHECKERBOARD = "bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3C/svg%3E')]";

export function RemoveBgClient() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-text-tertiary" /></div>}>
            <RemoveBgInner />
        </Suspense>
    );
}

function RemoveBgInner() {
    const searchParams = useSearchParams();
    const [cards, setCards] = useState<ImageCard[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [selectedModel, setSelectedModel] = useState<BgModel>('birefnet');
    const [processAllRunning, setProcessAllRunning] = useState(false);
    const [showGalleryPicker, setShowGalleryPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Pre-load from URL param (e.g. coming from Factory "To Remove BG")
    useEffect(() => {
        const imageUrl = searchParams.get('imageUrl');
        if (imageUrl) {
            const url = decodeURIComponent(imageUrl);
            setCards([{ id: `url-${Date.now()}`, sourceUrl: url, resultUrl: null, status: 'idle' }]);
        }
    }, []);

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
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    };

    const removeCard = (id: string) => {
        setCards(prev => prev.filter(c => c.id !== id));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const processCard = async (id: string, model: BgModel) => {
        const card = cards.find(c => c.id === id);
        if (!card || card.status === 'processing') return;
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'processing' } : c));
        try {
            const result = await apiTools.removeBg(card.sourceUrl, model);
            setCards(prev => prev.map(c => c.id === id ? { ...c, resultUrl: result.url, status: 'done' } : c));
            if (result.savedImageId) {
                toast.success('Saved to gallery — ready for mockup!');
            } else {
                toast.success(`BG removed — ${result.model}`);
            }
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
                <div className="space-y-2">
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
                    <div className="flex justify-center">
                        <button
                            onClick={() => setShowGalleryPicker(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-bg-elevated hover:bg-bg-overlay text-text-secondary hover:text-text-primary text-sm rounded-[10px] border border-border-default transition-colors"
                        >
                            <ImageIcon className="w-4 h-4" /> Load from Gallery
                        </button>
                    </div>
                </div>
            )}

            {showGalleryPicker && (
                <RemoveBgGalleryPicker
                    onClose={() => setShowGalleryPicker(false)}
                    onSelect={(img) => {
                        const url = img.imageUrl.startsWith('http') ? img.imageUrl : `${API_BASE}/${img.imageUrl}`;
                        if (cards.length >= 5) { toast.error('Maximum 5 images allowed'); return; }
                        setCards(prev => [...prev, { id: `gallery-${img.id}`, sourceUrl: url, resultUrl: null, status: 'idle' }]);
                        setShowGalleryPicker(false);
                    }}
                />
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

// ─── Gallery Picker Modal ─────────────────────────────────────────────────────
function RemoveBgGalleryPicker({ onClose, onSelect }: {
    onClose: () => void;
    onSelect: (img: GalleryImage) => void;
}) {
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        apiGallery.getRecent()
            .then(all => setImages(all.filter((i: GalleryImage) => i.engine !== 'mockup')))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const filtered = search
        ? images.filter(i => i.id.toLowerCase().includes(search.toLowerCase()))
        : images;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Load from Gallery</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by ID..."
                        className="w-full pl-10 pr-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500"
                        autoFocus
                    />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">No images found</div>
                    ) : (
                        <div className="grid grid-cols-4 gap-3">
                            {filtered.map(img => {
                                const url = img.imageUrl.startsWith('http') ? img.imageUrl : `${API_BASE}/${img.imageUrl}`;
                                return (
                                    <button
                                        key={img.id}
                                        onClick={() => onSelect(img)}
                                        className="group relative aspect-square bg-slate-900/60 rounded-xl overflow-hidden border-2 border-transparent hover:border-blue-500 transition-all"
                                    >
                                        <img src={url} alt="Design" className="w-full h-full object-contain p-2"
                                            onError={e => { e.currentTarget.style.display = 'none'; }} />
                                        <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <span className="px-3 py-1 bg-blue-600 text-white text-xs rounded-full font-medium">Select</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
