'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiTools, apiGallery, type GalleryImage } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Upload, X, Scissors, Loader2, Download, Play, CheckCircle,
    Image as ImageIcon, Search, ZoomIn, Wand2, Wrench,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

type Tab = 'remove-bg' | 'upscale' | 'vector';

const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
    { id: 'remove-bg', label: 'BG Kaldır', icon: Scissors, desc: 'Tek seferde 5 görsele kadar arka plan kaldır' },
    { id: 'upscale',   label: 'Upscale',   icon: ZoomIn,   desc: 'AuraSR v2 ile çözünürlüğü 4x artır' },
    { id: 'vector',    label: 'Vektör',    icon: Wand2,    desc: 'PNG tasarımı Recraft v3 ile vektöre dönüştür' },
];

export function ToolsClient() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-text-tertiary" /></div>}>
            <ToolsInner />
        </Suspense>
    );
}

function ToolsInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const tabParam = (searchParams.get('tab') as Tab) ?? 'remove-bg';
    const [activeTab, setActiveTab] = useState<Tab>(
        TABS.find(t => t.id === tabParam)?.id ?? 'remove-bg'
    );

    const switchTab = (tab: Tab) => {
        setActiveTab(tab);
        router.replace(`/dashboard/tools?tab=${tab}`, { scroll: false });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[10px] bg-accent/10 flex items-center justify-center">
                    <Wrench className="w-4.5 h-4.5 text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-text-primary">Araçlar</h1>
                    <p className="text-xs text-text-tertiary mt-0.5">
                        {TABS.find(t => t.id === activeTab)?.desc}
                    </p>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 p-1 bg-bg-elevated rounded-[10px] border border-border-default w-fit">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => switchTab(id)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-[7px] text-sm font-medium transition-all',
                            activeTab === id
                                ? 'bg-accent text-white shadow-sm'
                                : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay'
                        )}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Panels */}
            {activeTab === 'remove-bg' && <RemoveBgPanel preloadUrl={searchParams.get('imageUrl') ?? undefined} />}
            {activeTab === 'upscale'   && <UpscalePanel />}
            {activeTab === 'vector'    && <VectorPanel />}
        </div>
    );
}

// ─── Remove BG Panel ──────────────────────────────────────────────────────────

type BgModel = 'birefnet' | 'bria' | 'pixelcut';

interface ImageCard {
    id: string;
    sourceUrl: string;
    resultUrl: string | null;
    status: 'idle' | 'processing' | 'done' | 'error';
}

const CHECKERBOARD = "bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3Crect%20x%3D%228%22%20y%3D%228%22%20width%3D%228%22%20height%3D%228%22%20fill%3D%22%23e0e0e0%22/%3E%3C/svg%3E')]";

const BG_MODELS: { value: BgModel; label: string; note: string }[] = [
    { value: 'birefnet', label: 'BiRefNet', note: 'Ücretsiz · Yüksek kalite' },
    { value: 'bria',     label: 'Bria Pro', note: '$0.018 · Ticari' },
    { value: 'pixelcut', label: 'Pixelcut', note: 'E-ticaret optimize' },
];

function RemoveBgPanel({ preloadUrl }: { preloadUrl?: string }) {
    const [cards, setCards] = useState<ImageCard[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [selectedModel, setSelectedModel] = useState<BgModel>('birefnet');
    const [processAllRunning, setProcessAllRunning] = useState(false);
    const [showGalleryPicker, setShowGalleryPicker] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (preloadUrl) {
            const url = decodeURIComponent(preloadUrl);
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
        if (remaining <= 0) { toast.error('Maksimum 5 görsel'); return; }
        const toAdd = Array.from(files).slice(0, remaining);
        const newCards: ImageCard[] = [];
        for (const file of toAdd) {
            try {
                const url = await readFile(file);
                newCards.push({ id: `${Date.now()}-${Math.random()}`, sourceUrl: url, resultUrl: null, status: 'idle' });
            } catch { toast.error(`${file.name} geçerli bir görsel değil`); }
        }
        setCards(prev => [...prev, ...newCards]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const processCard = async (id: string, model: BgModel) => {
        const card = cards.find(c => c.id === id);
        if (!card || card.status === 'processing') return;
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'processing' } : c));
        try {
            const result = await apiTools.removeBg(card.sourceUrl, model);
            setCards(prev => prev.map(c => c.id === id ? { ...c, resultUrl: result.url, status: 'done' } : c));
            toast.success(result.savedImageId ? 'Galeriye kaydedildi!' : `BG kaldırıldı — ${result.model}`);
        } catch (err: unknown) {
            setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'error' } : c));
            toast.error(err instanceof Error ? err.message : 'İşlem başarısız');
        }
    };

    const processAll = async () => {
        const idle = cards.filter(c => c.status === 'idle' || c.status === 'error');
        if (!idle.length) { toast.error('İşlenecek görsel yok'); return; }
        setProcessAllRunning(true);
        await Promise.all(idle.map(c => processCard(c.id, selectedModel)));
        setProcessAllRunning(false);
    };

    const downloadImage = async (url: string, filename: string) => {
        try {
            const blob = await fetch(url).then(r => r.blob());
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl; a.download = filename; a.click();
            URL.revokeObjectURL(objectUrl);
        } catch { toast.error('İndirme başarısız'); }
    };

    const idleCount = cards.filter(c => c.status === 'idle' || c.status === 'error').length;

    return (
        <div className="space-y-5">
            {/* Model selector + Process All */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1.5">
                    {BG_MODELS.map(m => (
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
                        Tümünü İşle ({idleCount})
                    </button>
                )}
            </div>

            {/* Drop zone */}
            {cards.length < 5 && (
                <div className="space-y-2">
                    <div
                        className={cn(
                            'border-2 border-dashed rounded-[12px] p-10 text-center cursor-pointer transition-all',
                            isDragging ? 'border-accent bg-accent-subtle' : 'border-border-default hover:border-border-strong bg-bg-elevated'
                        )}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                            onChange={e => e.target.files && addFiles(e.target.files)} />
                        <Upload className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
                        <p className="text-sm font-medium text-text-primary mb-1">
                            Sürükle bırak veya <span className="text-accent">seç</span>
                        </p>
                        <p className="text-xs text-text-tertiary">
                            JPG, PNG, WEBP · {cards.length > 0 ? `${5 - cards.length} slot kaldı` : 'En fazla 5 görsel'}
                        </p>
                    </div>
                    <div className="flex justify-center">
                        <button
                            onClick={() => setShowGalleryPicker(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-bg-elevated hover:bg-bg-overlay text-text-secondary hover:text-text-primary text-sm rounded-[10px] border border-border-default transition-colors"
                        >
                            <ImageIcon className="w-4 h-4" /> Galeriden Yükle
                        </button>
                    </div>
                </div>
            )}

            {showGalleryPicker && (
                <GalleryPickerModal
                    onClose={() => setShowGalleryPicker(false)}
                    onSelect={img => {
                        const url = img.imageUrl.startsWith('http') ? img.imageUrl : `${API_BASE}/${img.imageUrl}`;
                        if (cards.length >= 5) { toast.error('Maksimum 5 görsel'); return; }
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
                            <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
                                <span className="text-xs text-text-tertiary font-mono">Görsel {idx + 1}</span>
                                <div className="flex items-center gap-2">
                                    {card.status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                                    {card.status === 'error' && <span className="text-[10px] text-danger">Hata — tekrar dene</span>}
                                    <button onClick={() => setCards(p => p.filter(c => c.id !== card.id))} className="text-text-tertiary hover:text-danger transition-colors">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className={cn('grid', card.resultUrl ? 'grid-cols-2' : 'grid-cols-1')}>
                                <div className="relative">
                                    {card.resultUrl && <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded z-10">Önce</span>}
                                    <img src={card.sourceUrl} alt="Orijinal" className="w-full object-cover aspect-square" />
                                </div>
                                {card.resultUrl && (
                                    <div className={cn('relative aspect-square', CHECKERBOARD)}>
                                        <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded z-10">Sonra</span>
                                        <img src={card.resultUrl} alt="Sonuç" className="w-full h-full object-cover" />
                                    </div>
                                )}
                            </div>
                            <div className="p-3 space-y-2">
                                {card.status !== 'done' && (
                                    <button
                                        onClick={() => processCard(card.id, selectedModel)}
                                        disabled={card.status === 'processing'}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-medium rounded-[8px] transition-colors"
                                    >
                                        {card.status === 'processing'
                                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> İşleniyor…</>
                                            : <><Scissors className="w-3.5 h-3.5" /> BG Kaldır</>
                                        }
                                    </button>
                                )}
                                {card.resultUrl && (
                                    <button
                                        onClick={() => downloadImage(card.resultUrl!, `bg-removed-${idx + 1}-${Date.now()}.png`)}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[8px] border border-border-default transition-colors"
                                    >
                                        <Download className="w-3.5 h-3.5" /> PNG İndir
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

// ─── Upscale Panel ────────────────────────────────────────────────────────────

function UpscalePanel() {
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [resultModel, setResultModel] = useState<string>('aurasr-v2');
    const [scale, setScale] = useState<number>(4);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) { toast.error('Lütfen bir görsel yükleyin.'); return; }
        const reader = new FileReader();
        reader.onloadend = () => { setSourceImage(reader.result as string); setResult(null); };
        reader.readAsDataURL(file);
    };

    const upscaleImage = async () => {
        if (!sourceImage) return toast.error('Önce bir görsel yükleyin.');
        setIsProcessing(true);
        try {
            const res = await apiTools.upscale(sourceImage, scale);
            setResult(res.url);
            setResultModel(res.model ?? 'aurasr-v2');
            toast.success(res.savedImageId ? 'Galeriye kaydedildi!' : `${res.scale}x upscale — ${res.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Upscale başarısız');
        } finally {
            setIsProcessing(false);
        }
    };

    const downloadImage = async (url: string, filename: string) => {
        try {
            const blob = await fetch(url).then(r => r.blob());
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl; a.download = filename; a.click();
            URL.revokeObjectURL(objectUrl);
        } catch { toast.error('İndirme başarısız'); }
    };

    return (
        <div className="space-y-5">
            {!sourceImage ? (
                <div
                    className={cn(
                        'border-2 border-dashed rounded-[12px] p-16 text-center cursor-pointer transition-all',
                        isDragging ? 'border-accent bg-accent-subtle' : 'border-border-default hover:border-border-strong bg-bg-elevated'
                    )}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => e.target.files?.[0] && processFile(e.target.files[0])} />
                    <ZoomIn className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm font-medium text-text-primary mb-1">Görselinizi buraya sürükleyin</p>
                    <p className="text-xs text-text-tertiary">JPG, PNG, WEBP — önerilen max 1024px</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1 bg-bg-elevated rounded-[8px] border border-border-default p-1">
                            {[1, 2, 3, 4, 6, 8].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setScale(s)}
                                    className={cn(
                                        'px-3 py-1.5 rounded-[6px] text-xs font-medium transition-all',
                                        scale === s ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                                    )}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={upscaleImage}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-[8px] text-sm font-medium transition-colors disabled:opacity-40"
                        >
                            {isProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> İşleniyor…</> : <><ZoomIn className="w-4 h-4" /> {scale}x Upscale</>}
                        </button>
                        <button
                            onClick={() => { setSourceImage(null); setResult(null); }}
                            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs text-text-tertiary hover:text-danger border border-border-default rounded-[8px] transition-colors"
                        >
                            <X className="w-3.5 h-3.5" /> Temizle
                        </button>
                    </div>

                    <div className={cn('grid gap-4', result ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-md')}>
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Orijinal</p>
                            <div className="rounded-[10px] overflow-hidden border border-border-default bg-bg-elevated">
                                <img src={sourceImage} alt="Orijinal" className="w-full object-contain max-h-[500px]" />
                            </div>
                        </div>
                        {result && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-accent uppercase tracking-wider">
                                    {scale}x Upscale — {resultModel}
                                </p>
                                <div className="rounded-[10px] overflow-hidden border border-accent/20 bg-bg-elevated">
                                    <img src={result} alt="Upscaled" className="w-full object-contain max-h-[500px]" />
                                </div>
                                <button
                                    onClick={() => downloadImage(result!, `upscaled-${scale}x-${Date.now()}.png`)}
                                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-accent-subtle hover:bg-accent text-accent hover:text-white text-xs rounded-[8px] border border-accent/30 transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" /> İndir
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Vector Panel ─────────────────────────────────────────────────────────────

function VectorPanel() {
    const [sourceUrl, setSourceUrl] = useState<string | null>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [converting, setConverting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = (file: File) => {
        if (!file.type.startsWith('image/')) { setError('PNG, JPG veya WebP yükleyin'); return; }
        setSourceUrl(URL.createObjectURL(file));
        setResultUrl(null);
        setError(null);
    };

    const handleConvert = async () => {
        if (!sourceUrl) return;
        setConverting(true);
        setError(null);
        try {
            let uploadUrl = sourceUrl;
            if (sourceUrl.startsWith('blob:')) {
                const blob = await fetch(sourceUrl).then(r => r.blob());
                const fd = new FormData();
                fd.append('file', blob, 'image.png');
                const res = await fetch(`${API_BASE}/api/tools/upload-temp`, { method: 'POST', credentials: 'include', body: fd });
                if (!res.ok) throw new Error('Görsel yükleme başarısız');
                uploadUrl = (await res.json()).url;
            }
            const result = await apiTools.vectorize(uploadUrl);
            setResultUrl(result.url);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Dönüştürme başarısız');
        } finally {
            setConverting(false);
        }
    };

    const handleDownload = async () => {
        if (!resultUrl) return;
        try {
            const blob = await fetch(resultUrl).then(r => r.blob());
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `vector-${Date.now()}.png`; a.click();
            URL.revokeObjectURL(url);
        } catch { window.open(resultUrl, '_blank'); }
    };

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Input */}
                <div className="space-y-3">
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Orijinal Görsel</p>
                    {!sourceUrl ? (
                        <div
                            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                'aspect-square max-h-96 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed cursor-pointer transition-all',
                                dragOver ? 'border-accent bg-accent-subtle' : 'border-border-default bg-bg-elevated hover:border-accent/50 hover:bg-accent/5'
                            )}
                        >
                            <Upload className="w-10 h-10 text-text-tertiary mb-3" />
                            <p className="text-sm font-medium text-text-secondary">Sürükle bırak veya tıkla</p>
                            <p className="text-xs text-text-tertiary mt-1">PNG, JPG, WebP</p>
                            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                        </div>
                    ) : (
                        <div className="relative aspect-square max-h-96 rounded-2xl overflow-hidden bg-bg-elevated border border-border-default">
                            <img src={sourceUrl} alt="Kaynak" className="w-full h-full object-contain" />
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
                    <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Vektör Sonucu</p>
                    <div className="aspect-square max-h-96 flex items-center justify-center rounded-2xl border-2 border-dashed border-border-default bg-bg-elevated overflow-hidden">
                        {converting ? (
                            <div className="flex flex-col items-center gap-3 text-text-tertiary">
                                <Loader2 className="w-10 h-10 animate-spin text-accent" />
                                <p className="text-sm">Vektöre dönüştürülüyor…</p>
                            </div>
                        ) : resultUrl ? (
                            <img src={resultUrl} alt="Vektör sonucu" className="w-full h-full object-contain" />
                        ) : (
                            <div className="flex flex-col items-center gap-2 text-text-tertiary">
                                <Wand2 className="w-10 h-10 opacity-30" />
                                <p className="text-sm">Sonuç burada görünecek</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="px-4 py-3 bg-danger/10 border border-danger/30 rounded-xl text-sm text-danger">
                    {error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button
                    onClick={handleConvert}
                    disabled={!sourceUrl || converting}
                    className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all"
                >
                    {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {converting ? 'Dönüştürülüyor…' : 'Vektöre Dönüştür'}
                </button>
                {resultUrl && (
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-5 py-2.5 bg-bg-elevated hover:bg-bg-surface text-text-primary text-sm font-medium rounded-xl border border-border-default transition-colors"
                    >
                        <Download className="w-4 h-4" /> İndir
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Gallery Picker Modal ─────────────────────────────────────────────────────

function GalleryPickerModal({ onClose, onSelect }: {
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
            <div className="bg-bg-elevated border border-border-default rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-text-primary">Galeriden Yükle</h3>
                    <button onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X className="w-5 h-5" /></button>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="ID'ye göre ara..."
                        className="w-full pl-10 pr-3 py-2 bg-bg-overlay border border-border-default rounded-xl text-text-primary text-sm focus:outline-none focus:border-accent"
                        autoFocus
                    />
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-accent" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-12 text-text-tertiary">Görsel bulunamadı</div>
                    ) : (
                        <div className="grid grid-cols-4 gap-3">
                            {filtered.map(img => {
                                const url = img.imageUrl.startsWith('http') ? img.imageUrl : `${API_BASE}/${img.imageUrl}`;
                                return (
                                    <button
                                        key={img.id}
                                        onClick={() => onSelect(img)}
                                        className="group relative aspect-square bg-bg-base rounded-xl overflow-hidden border-2 border-transparent hover:border-accent transition-all"
                                    >
                                        <img src={url} alt="Tasarım" className="w-full h-full object-contain p-2"
                                            onError={e => { e.currentTarget.style.display = 'none'; }} />
                                        <div className="absolute inset-0 bg-accent/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <span className="px-3 py-1 bg-accent text-white text-xs rounded-full font-medium">Seç</span>
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
