'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { apiMockups, MockupTemplate, MockupConfig, apiGallery, GalleryImage, apiCatalog, YuppionColor } from '@/lib/api';
import {
    Plus, Trash2, X, Image as ImageIcon, RotateCw, Layers,
    Eye, Download, Search, Loader2, Save, Grid3x3, CheckCircle2,
    AlertCircle, Package, ChevronDown, ChevronRight, Upload, PackageOpen, Wand2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { TemplateUploader } from './TemplateUploader';

const DesignPlacementEditor = dynamic(() => import('@/components/mockups/DesignPlacementEditor'), {
    ssr: false,
    loading: () => <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center text-white"><Loader2 className="w-8 h-8 animate-spin" /></div>
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
const resolveUrl = (p: string) =>
    p?.startsWith('http') ? p : `${API_BASE}/${p}`;

// Standard v1 categories
const CATEGORIES = [
    'all',
    'tshirt', 'sweatshirt', 'hoodie', 'long_sleeve', 'tank', 'polo',
    'women', 'men', 'couple', 'family', 'kids',
    'with_people', 'without_people',
    'hat', 'bag', 'mug', 'sticker', 'phone_case',
    'video'
];

const CATEGORY_LABELS: Record<string, string> = {
    all: 'All',
    tshirt: 'T-Shirt',
    sweatshirt: 'Sweatshirt',
    hoodie: 'Hoodie',
    long_sleeve: 'Long Sleeve',
    tank: 'Tank Top',
    polo: 'Polo',
    women: 'Women',
    men: 'Men',
    couple: 'Couple',
    family: 'Family',
    kids: 'Kids',
    with_people: 'With People',
    without_people: 'Flat/Ghost',
    hat: 'Hat',
    bag: 'Bag',
    mug: 'Mug',
    sticker: 'Sticker',
    phone_case: 'Phone Case',
    video: 'Video'
};

// Fallback renk paleti — template'e Yuppion modeli atanmadığında kullanılır
const DEFAULT_COLORS: YuppionColor[] = [
    { name: 'Beyaz',    hex: '#FFFFFF' },
    { name: 'Siyah',    hex: '#1a1a1a' },
    { name: 'Lacivert', hex: '#1B3A6B' },
    { name: 'Gri',      hex: '#9CA3AF' },
    { name: 'Kırmızı',  hex: '#DC2626' },
    { name: 'Yeşil',    hex: '#15803D' },
    { name: 'Bej',      hex: '#D4B896' },
    { name: 'Sarı',     hex: '#FBBF24' },
];

// ─── Toast Notification System ───────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; type: ToastType; message: string }
let toastCounter = 0;

function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const addToast = useCallback((type: ToastType, message: string) => {
        const id = ++toastCounter;
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    }, []);
    return { toasts, addToast };
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
    return (
        <div className="fixed top-6 right-6 z-[100] flex flex-col gap-2 max-w-sm">
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={cn(
                        'px-4 py-3 rounded-xl border text-sm font-medium shadow-xl backdrop-blur-sm animate-in slide-in-from-right fade-in duration-300',
                        t.type === 'success' && 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300',
                        t.type === 'error' && 'bg-red-600/20 border-red-500/40 text-red-300',
                        t.type === 'info' && 'bg-blue-600/20 border-blue-500/40 text-blue-300',
                    )}
                >
                    <div className="flex items-center gap-2">
                        {t.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
                        {t.type === 'error' && <AlertCircle className="w-4 h-4" />}
                        {t.type === 'info' && <Loader2 className="w-4 h-4" />}
                        {t.message}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────
function SkeletonCard() {
    return (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden animate-pulse">
            <div className="aspect-square bg-slate-700/50" />
            <div className="p-3 space-y-2">
                <div className="h-3 bg-slate-700 rounded w-3/4" />
                <div className="h-2 bg-slate-700/50 rounded w-1/2" />
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export function MockupsClient() {
    const searchParams = useSearchParams();
    const [templates, setTemplates] = useState<MockupTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('all');
    const [showUpload, setShowUpload] = useState(false);
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<MockupTemplate | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { toasts, addToast } = useToast();

    const [productColors, setProductColors] = useState<Record<string, string>>(() => {
        try { return JSON.parse(localStorage.getItem('mockup_product_colors') || '{}'); } catch { return {}; }
    });
    const [shadowGenerating, setShadowGenerating] = useState<string | null>(null);

    const setProductColor = (templateId: string, color: string) => {
        const next = { ...productColors, [templateId]: color };
        setProductColors(next);
        localStorage.setItem('mockup_product_colors', JSON.stringify(next));
    };

    const { data: renderedMockups, refetch: refetchMockups } = useQuery({
        queryKey: ['rendered-mockups'],
        queryFn: async () => {
            const all = await apiGallery.getRecent();
            return all.filter((img: GalleryImage) => img.engine === 'mockup');
        },
        staleTime: 10000,
    });

    // Multi-area design selection state (Shared across editor sessions)
    const [areaDesigns, setAreaDesigns] = useState<Record<string, any>>({});
    const [activeAreaId, setActiveAreaId] = useState<string | null>(null);

    // Get initial design from URL param
    const initialDesignUrl = searchParams.get('designUrl');
    const initialDesignImageId = searchParams.get('designImageId');

    // Sync initial design from URL to the state
    useEffect(() => {
        if (initialDesignUrl && initialDesignImageId && !activeAreaId) {
            // If no active area yet, we'll wait for the first area to be auto-selected
            // or just set it to a default if we want it pre-filled.
            // For now, let's just make sure the state is ready.
        }
    }, [initialDesignUrl, initialDesignImageId]);

    // Bulk Render state
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkDesignUrl, setBulkDesignUrl] = useState<string | null>(null);
    const [bulkDesignImageId, setBulkDesignImageId] = useState<string | null>(null);
    const [bulkShowDesignPicker, setBulkShowDesignPicker] = useState(false);
    const [bulkRendering, setBulkRendering] = useState(false);
    const [bulkResults, setBulkResults] = useState<{ templateId: string; templateName: string; status: string; url?: string; error?: string; reason?: string }[]>([]);
    const [skipNoMatch, setSkipNoMatch] = useState(true);

    const loadTemplates = useCallback(async () => {
        setLoading(true);
        try {
            const cat = activeCategory === 'all' ? undefined : activeCategory;
            const data = await apiMockups.listTemplates(cat);
            setTemplates(data.templates);
        } catch (err) {
            console.error('Failed to load templates:', err);
            addToast('error', 'Failed to load templates');
        } finally {
            setLoading(false);
        }
    }, [activeCategory, addToast]);

    useEffect(() => { loadTemplates(); }, [loadTemplates]);

    const filtered = useMemo(() => {
        if (!searchQuery.trim()) return templates;
        const q = searchQuery.toLowerCase();
        return templates.filter(t =>
            t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
        );
    }, [templates, searchQuery]);

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this template? This cannot be undone.')) return;
        try {
            await apiMockups.deleteTemplate(id);
            setTemplates(prev => prev.filter(t => t.id !== id));
            if (selectedTemplate?.id === id) {
                setSelectedTemplate(null);
                setShowEditor(false);
            }
            addToast('success', 'Template deleted');
        } catch (err: any) {
            addToast('error', err.message);
        }
    };

    const handleGenerateShadow = async (template: MockupTemplate) => {
        if (!confirm(`"${template.name}" için AI shadow üretilecek (~10-30 sn). Devam edilsin mi?`)) return;
        setShadowGenerating(template.id);
        try {
            await apiMockups.generateShadow(template.id);
            addToast('success', 'AI shadow oluşturuldu!');
            loadTemplates();
        } catch (err: any) {
            addToast('error', 'Shadow üretilemedi: ' + err.message);
        } finally {
            setShadowGenerating(null);
        }
    };

    const handleBulkRender = async () => {
        if (!bulkDesignImageId || bulkSelectedIds.size === 0) return;
        setBulkRendering(true);
        setBulkResults([]);
        try {
            // Her seçili şablon için ayrı renk gönder
            const perTemplateColors: Record<string, string> = {};
            Array.from(bulkSelectedIds).forEach(tid => {
                if (productColors[tid]) perTemplateColors[tid] = productColors[tid];
            });
            const result = await apiMockups.renderBatch(
                bulkDesignImageId,
                Array.from(bulkSelectedIds),
                undefined,
                undefined,
                Object.keys(perTemplateColors).length > 0 ? perTemplateColors : undefined,
                skipNoMatch
            );
            setBulkResults(result.results);
            const successCount = result.results.filter(r => r.status === 'success').length;
            // Auto-save successful renders to gallery
            for (const r of result.results) {
                if (r.status === 'success' && r.url) {
                    try { await apiGallery.saveMockup(resolveUrl(r.url), bulkDesignImageId ?? undefined); } catch {}
                }
            }
            addToast('success', `Rendered ${successCount} of ${result.results.length} mockups`);
            refetchMockups();
        } catch (err: any) {
            addToast('error', err.message);
        } finally {
            setBulkRendering(false);
        }
    };

    return (
        <div className="space-y-6">
            <ToastContainer toasts={toasts} />

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Mockup Gallery</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        Upload templates, define print areas, apply designs and export production-ready mockups
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setBulkMode(b => !b); setBulkSelectedIds(new Set()); setBulkResults([]); }}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all border',
                            bulkMode
                                ? 'bg-purple-600/20 border-purple-500/40 text-purple-400'
                                : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:border-slate-500'
                        )}
                    >
                        <Grid3x3 className="w-4 h-4" /> {bulkMode ? 'Exit Bulk' : 'Bulk Render'}
                    </button>
                    <button
                        onClick={() => setShowBulkUpload(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/50 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-xl transition-all border border-slate-700"
                    >
                        <Upload className="w-4 h-4" /> Bulk Upload
                    </button>
                    <button
                        id="upload-template-btn"
                        onClick={() => setShowUpload(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-accent/20"
                    >
                        <Plus className="w-4 h-4" /> Upload Template
                    </button>
                </div>
            </div>

            {/* Filters Row */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex gap-1.5 flex-wrap">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            id={`cat-${cat}`}
                            onClick={() => setActiveCategory(cat)}
                            className={cn(
                                'px-3 py-1.5 text-xs font-medium rounded-full border transition-all capitalize',
                                activeCategory === cat
                                    ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 shadow-sm shadow-blue-600/10'
                                    : 'bg-slate-800/50 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-300'
                            )}
                        >
                            {CATEGORY_LABELS[cat] || cat}
                        </button>
                    ))}
                </div>
                <div className="flex-1 max-w-sm relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        id="search-templates"
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search templates..."
                        className="w-full pl-10 pr-3 py-2 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
                    />
                </div>
            </div>

            {/* Bulk Render Panel */}
            {bulkMode && (
                <div className="bg-slate-800/60 border border-purple-500/30 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-purple-300">
                            Bulk Render — {bulkSelectedIds.size} template{bulkSelectedIds.size !== 1 ? 's' : ''} selected
                        </p>
                        <div className="flex items-center gap-3">
                            {/* Stok dışı renkleri atla toggle */}
                            <label className="flex items-center gap-1.5 cursor-pointer" title="Yuppion kataloğunda olmayan renkleri atla">
                                <div
                                    onClick={() => setSkipNoMatch(v => !v)}
                                    className={cn(
                                        'w-8 h-4 rounded-full transition-colors relative',
                                        skipNoMatch ? 'bg-emerald-600' : 'bg-slate-600'
                                    )}
                                >
                                    <div className={cn(
                                        'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                                        skipNoMatch ? 'translate-x-4' : 'translate-x-0.5'
                                    )} />
                                </div>
                                <span className="text-[10px] text-slate-400">Stok dışı atla</span>
                            </label>
                            <button
                                onClick={() => setBulkSelectedIds(new Set())}
                                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                Clear selection
                            </button>
                            <button
                                onClick={async () => {
                                    if (!confirm(`${bulkSelectedIds.size} şablonu silmek istediğine emin misin?`)) return;
                                    setBulkDeleting(true);
                                    try {
                                        await Promise.all(Array.from(bulkSelectedIds).map(id =>
                                            fetch(`/api/mockups/templates/${id}`, { method: 'DELETE', credentials: 'include' })
                                        ));
                                        setBulkSelectedIds(new Set());
                                        window.location.reload();
                                    } catch (err) {
                                        alert('Silme başarısız');
                                    } finally {
                                        setBulkDeleting(false);
                                    }
                                }}
                                disabled={bulkDeleting}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                            >
                                {bulkDeleting ? 'Siliniyor...' : `Sil (${bulkSelectedIds.size})`}
                            </button>
                        </div>
                    </div>

                    {/* Per-template renk seçici (yalnızca PSD şablonlar) */}
                    {(() => {
                        const psdSelected = templates.filter(
                            (t: MockupTemplate) => bulkSelectedIds.has(t.id) && t.configJson?.meta?.isPsdDerived
                        );
                        if (psdSelected.length === 0) return null;
                        return (
                            <div className="space-y-2">
                                <p className="text-xs text-slate-400 font-medium">Ürün Rengi (PSD şablonlar)</p>
                                <div className="flex flex-wrap gap-3">
                                    {psdSelected.map((t: MockupTemplate) => (
                                        <div key={t.id} className="flex items-center gap-2 bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-700">
                                            <span className="text-xs text-slate-300 truncate max-w-[100px]">{t.name}</span>
                                            <div className="flex gap-1">
                                                {DEFAULT_COLORS.map(c => (
                                                    <button
                                                        key={c.hex}
                                                        title={c.name}
                                                        onClick={() => {
                                                            const next = { ...productColors, [t.id]: c.hex };
                                                            setProductColors(next);
                                                            localStorage.setItem('mockup_product_colors', JSON.stringify(next));
                                                        }}
                                                        className="w-5 h-5 rounded-full border-2 transition-all"
                                                        style={{
                                                            backgroundColor: c.hex,
                                                            borderColor: productColors[t.id] === c.hex ? '#a855f7' : 'transparent',
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Design picker */}
                    <div className="flex items-center gap-3">
                        {bulkDesignUrl ? (
                            <div className="flex items-center gap-3 flex-1">
                                <img
                                    src={bulkDesignUrl.startsWith('http') ? bulkDesignUrl : `${API_BASE}/${bulkDesignUrl}`}
                                    alt="Design"
                                    className="w-12 h-12 object-contain rounded-lg border border-slate-600"
                                />
                                <span className="text-xs text-slate-300 flex-1 truncate">Design selected</span>
                                <button onClick={() => setBulkShowDesignPicker(true)} className="text-xs text-blue-400 hover:text-blue-300">Change</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setBulkShowDesignPicker(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-xl text-sm text-slate-300 hover:border-blue-500/50 hover:text-blue-400 transition-all"
                            >
                                <Search className="w-4 h-4" /> Pick a design
                            </button>
                        )}

                        <button
                            onClick={handleBulkRender}
                            disabled={bulkRendering || !bulkDesignImageId || bulkSelectedIds.size === 0}
                            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all"
                        >
                            {bulkRendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                            {bulkRendering ? 'Rendering…' : `Render ${bulkSelectedIds.size} Templates`}
                        </button>
                    </div>

                    {/* Bulk results */}
                    {bulkResults.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-700/60">
                            {bulkResults.map(r => (
                                <div key={r.templateId} className="bg-slate-900/50 rounded-xl overflow-hidden border border-slate-700">
                                    {r.status === 'success' && r.url ? (
                                        <>
                                            {(() => {
                                                const resolvedUrl = resolveUrl(r.url);
                                                return (
                                                    <img
                                                        src={resolvedUrl}
                                                        alt={r.templateName}
                                                        className="w-full aspect-square object-contain"
                                                        onError={(e) => { console.error('Bulk render img failed:', r.url); }}
                                                    />
                                                );
                                            })()}
                                            <div className="p-2 flex items-center justify-between">
                                                <p className="text-[10px] text-slate-400 truncate">{r.templateName}</p>
                                                <button
                                                    onClick={async () => {
                                                        const url = resolveUrl(r.url!);
                                                        try {
                                                            const res = await fetch(url);
                                                            const blob = await res.blob();
                                                            const a = document.createElement('a');
                                                            a.href = URL.createObjectURL(blob);
                                                            a.download = `mockup-${r.templateName}-${Date.now()}.png`;
                                                            a.click();
                                                        } catch { window.open(url, '_blank'); }
                                                    }}
                                                    className="p-1 text-blue-400 hover:text-blue-300"
                                                >
                                                    <Download className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </>
                                    ) : r.status === 'skipped' ? (
                                        <div className="aspect-square flex items-center justify-center text-center p-3 bg-amber-900/10">
                                            <p className="text-[10px] text-amber-400">{r.templateName}<br /><span className="text-slate-500">Atlandı — stok dışı</span></p>
                                        </div>
                                    ) : (
                                        <div className="aspect-square flex items-center justify-center text-center p-3">
                                            <p className="text-[10px] text-red-400">{r.templateName}<br /><span className="text-slate-500">{r.error || 'Failed'}</span></p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Template Grid */}
            {loading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                    <ImageIcon className="w-20 h-20 mb-4 opacity-20" />
                    <p className="text-lg font-semibold text-slate-400">
                        {templates.length === 0 ? 'Upload your first mockup template' : 'No templates match your search'}
                    </p>
                    <p className="text-sm mt-1 text-slate-500">
                        {templates.length === 0
                            ? 'Click "Upload Template" to add a mockup base image'
                            : 'Try a different category or search term'}
                    </p>
                    {templates.length === 0 && (
                        <button
                            onClick={() => setShowUpload(true)}
                            className="mt-6 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-xl transition-colors"
                        >
                            <Plus className="w-4 h-4 inline mr-1" /> Upload Template
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {filtered.map(t => (
                        <TemplateCard
                            key={t.id}
                            template={t}
                            onSelect={() => { setSelectedTemplate(t); setShowEditor(true); }}
                            onToggleSelect={() => {
                                setBulkSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                    return next;
                                });
                            }}
                            onDelete={() => handleDelete(t.id)}
                            onGenerateShadow={() => handleGenerateShadow(t)}
                            shadowGenerating={shadowGenerating === t.id}
                            bulkMode={bulkMode}
                            isSelected={bulkSelectedIds.has(t.id)}
                        />
                    ))}
                </div>
            )}

            {/* Rendered Mockups */}
            {renderedMockups && renderedMockups.length > 0 && (
                <RenderedMockupsSection renderedMockups={renderedMockups} refetchMockups={refetchMockups} addToast={addToast} />
            )}

            {showUpload && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-bg-elevated border border-border-default rounded-2xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-semibold text-text-primary">Upload Mockup Template</h2>
                            <button onClick={() => setShowUpload(false)} className="text-text-tertiary hover:text-text-primary"><X className="w-5 h-5" /></button>
                        </div>
                        <TemplateUploader
                            onSuccess={() => {
                                setShowUpload(false);
                                addToast('success', 'Template created');
                                loadTemplates();
                            }}
                        />
                    </div>
                </div>
            )}

            {bulkShowDesignPicker && (
                <DesignPickerModal
                    onClose={() => setBulkShowDesignPicker(false)}
                    onSelect={(img) => {
                        setBulkDesignUrl(img.imageUrl);
                        setBulkDesignImageId(img.id);
                        setBulkShowDesignPicker(false);
                    }}
                />
            )}

            {showEditor && selectedTemplate && (
                <TemplateEditor
                    template={selectedTemplate}
                    onClose={() => { setShowEditor(false); setSelectedTemplate(null); }}
                    onUpdated={(updated) => {
                        setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
                        setSelectedTemplate(updated);
                    }}
                    addToast={addToast}
                    designUrl={activeAreaId && areaDesigns[activeAreaId] ? areaDesigns[activeAreaId].imageUrl : (initialDesignUrl || null)}
                    designImageId={activeAreaId && areaDesigns[activeAreaId] ? areaDesigns[activeAreaId].id : (initialDesignImageId || null)}
                    productColor={productColors[selectedTemplate.id] || selectedTemplate.configJson?.meta?.defaultColor || '#FFFFFF'}
                    onColorChange={(color: string) => setProductColor(selectedTemplate.id, color)}
                />
            )}

            {showBulkUpload && (
                <BulkUploadModal
                    onClose={() => setShowBulkUpload(false)}
                    onSuccess={() => { loadTemplates(); setShowBulkUpload(false); }}
                />
            )}
        </div>
    );
}

// ─── Template Card ───────────────────────────────────────────────────────────
function TemplateCard({ template, onSelect, onToggleSelect, onDelete, onGenerateShadow, shadowGenerating, bulkMode, isSelected }: {
    template: MockupTemplate; onSelect: () => void; onToggleSelect?: () => void; onDelete: () => void;
    onGenerateShadow?: () => void; shadowGenerating?: boolean;
    bulkMode?: boolean; isSelected?: boolean;
}) {
    return (
        <div className={cn(
            'group relative bg-slate-800/60 border rounded-xl overflow-hidden transition-all duration-200',
            bulkMode
                ? isSelected
                    ? 'border-purple-500/70 shadow-lg shadow-purple-600/10'
                    : 'border-slate-700 hover:border-purple-500/40'
                : 'border-slate-700 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-600/5'
        )}>
            <div className="aspect-square bg-slate-900/50 relative cursor-pointer" onClick={onSelect}>
                <img
                    src={resolveUrl(template.baseImagePath)}
                    alt={template.name}
                    className="w-full h-full object-contain p-2"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                />
                {bulkMode && (
                    <>
                        {/* selection tint — pointer-events-none so card click still opens editor */}
                        <div className={cn(
                            'absolute inset-0 pointer-events-none transition-colors',
                            isSelected ? 'bg-purple-600/20' : 'bg-transparent'
                        )} />
                        {/* checkbox corner button — stopPropagation so it doesn't open editor */}
                        <button
                            className={cn(
                                'absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all',
                                isSelected ? 'bg-purple-600 border-purple-500' : 'bg-black/40 border-slate-400 hover:border-purple-400'
                            )}
                            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
                        >
                            {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                        </button>
                    </>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4 pointer-events-none">
                    <span className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-full font-medium shadow-lg">Open Editor</span>
                </div>
            </div>
            <div className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{template.name}</p>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 bg-slate-700 text-slate-400 text-[10px] rounded capitalize">
                            {template.category.replace('_', ' ')}
                        </span>
                        {/* Katalog renk eşleşme badge */}
                        {(() => {
                            const match = template.configJson?.meta?.catalogColorMatch;
                            const modelId = template.configJson?.meta?.yuppionModelId;
                            if (!modelId) return null;
                            if (!match) return (
                                <span className="inline-flex items-center px-1.5 py-0.5 bg-slate-700/60 text-slate-500 text-[9px] rounded">
                                    renk?
                                </span>
                            );
                            if (match.matched) return (
                                <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-600/20 text-emerald-400 text-[9px] rounded border border-emerald-500/30"
                                    title={`${match.color.name} (${match.distance})`}
                                >
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: match.color.hex }} />
                                    {match.color.name}
                                </span>
                            );
                            return (
                                <span
                                    className="inline-flex items-center px-1.5 py-0.5 bg-red-600/20 text-red-400 text-[9px] rounded border border-red-500/30"
                                    title={`Tespit: ${template.configJson?.meta?.detectedColor || '?'}`}
                                >
                                    stok dışı
                                </span>
                            );
                        })()}
                    </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {template.configJson?.meta?.isPsdDerived &&
                     template.configJson?.meta?.shadowSource !== 'ai' && (
                        <button
                            onClick={e => { e.stopPropagation(); onGenerateShadow?.(); }}
                            disabled={shadowGenerating}
                            title="AI ile gerçekçi shadow üret"
                            className="p-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 transition-colors disabled:opacity-40"
                        >
                            {shadowGenerating
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Wand2 className="w-3.5 h-3.5" />
                            }
                        </button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); onDelete(); }}
                        className="p-1.5 text-red-400 hover:text-red-300 transition-all"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Upload Modal ────────────────────────────────────────────────────────────
function UploadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: MockupTemplate) => void }) {
    const [name, setName] = useState('');
    const [category, setCategory] = useState('tshirt');
    const [baseFile, setBaseFile] = useState<File | null>(null);
    const [maskFile, setMaskFile] = useState<File | null>(null);
    const [shadowFile, setShadowFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [basePreview, setBasePreview] = useState('');

    const onFile = (setter: (f: File | null) => void, preview?: (s: string) => void) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0] || null;
            setter(f);
            if (f && preview) preview(URL.createObjectURL(f));
        };

    const submit = async () => {
        if (!baseFile) { setError('Base image is required'); return; }
        if (!name.trim()) { setError('Template name is required'); return; }

        setUploading(true); setError('');

        const fd = new FormData();
        fd.append('baseImage', baseFile);
        if (maskFile) fd.append('maskImage', maskFile);
        if (shadowFile) fd.append('shadowImage', shadowFile);
        fd.append('name', name);
        fd.append('category', category);
        // Standard v1 configJson shape — backend applies category preset for printArea
        fd.append('configJson', JSON.stringify({
            transform: {
                rotation: 0,
                opacity: 0.92,
                blendMode: 'multiply',
            },
            render: {
                renderMode: 'flat',
                displacementMapPath: null,
                perspective: null,
            },
            meta: {
                view: 'front',
                background: 'studio',
                color: 'white',
                hasHumanModel: false,
            },
        }));

        try {
            const t = await apiMockups.uploadTemplate(fd);
            onCreated(t);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Upload Mockup Template</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                {error && <div className="px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1.5">Template Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            placeholder="e.g. Black T-Shirt Front"
                            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30" />
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-1.5">Category</label>
                        <select value={category} onChange={e => setCategory(e.target.value)}
                            className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                            {CATEGORIES.filter(c => c !== 'all').map(c => (
                                <option key={c} value={c}>{c.replace('_', ' ')}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-slate-300 mb-2">Images</label>
                        <div className="grid grid-cols-3 gap-3">
                            <FileDropZone label="Base Image *" accept="image/*" file={baseFile} preview={basePreview} onChange={onFile(setBaseFile, setBasePreview)} />
                            <FileDropZone label="Mask (optional)" accept="image/*" file={maskFile} onChange={onFile(setMaskFile)} />
                            <FileDropZone label="Shadow (optional)" accept="image/*" file={shadowFile} onChange={onFile(setShadowFile)} />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                    <button onClick={submit} disabled={uploading}
                        className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20">
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {uploading ? 'Uploading...' : 'Create Template'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function FileDropZone({ label, accept, file, preview, onChange }: {
    label: string; accept: string; file: File | null; preview?: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
    return (
        <label className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500/50 hover:bg-slate-800/30 transition-all text-center min-h-[100px]">
            {preview ? (
                <img src={preview} alt="Preview" className="w-full h-16 object-contain mb-1 rounded" />
            ) : (
                <ImageIcon className="w-8 h-8 text-slate-600 mb-1" />
            )}
            <span className="text-[11px] text-slate-400 truncate max-w-full">{file ? file.name : label}</span>
            <input type="file" accept={accept} onChange={onChange} className="hidden" />
        </label>
    );
}

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

// ─── Template Editor with Konva Canvas ───────────────────────────────────────
function TemplateEditor({ template, onClose, onUpdated, addToast, designUrl, designImageId, productColor, onColorChange }: {
    template: MockupTemplate;
    onClose: () => void;
    onUpdated: (t: MockupTemplate) => void;
    addToast: (type: ToastType, msg: string) => void;
    designUrl?: string | null;
    designImageId?: string | null;
    productColor?: string;
    onColorChange?: (color: string) => void;
}) {
    // Standard v1: config.transform holds rotation/opacity/blendMode
    const config = template.configJson || {
        printArea: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        transform: { rotation: 0, opacity: 1, blendMode: 'auto' },
        render: { renderMode: 'flat', displacementMapPath: null, perspective: null },
        meta: { view: 'front', background: 'studio', color: 'white', hasHumanModel: false },
    };
    const transform = config.transform || { rotation: 0, opacity: 1, blendMode: 'auto' };
    const [printArea, setPrintArea] = useState(config.printArea);
    const [opacity, setOpacity] = useState(transform.opacity);
    const [blendMode, setBlendMode] = useState(transform.blendMode);
    const [rotation, setRotation] = useState(transform.rotation);
    const [displacementStrength, setDisplacementStrength] = useState<number>(
        config.render?.displacementStrength ?? 0
    );

    const [designScale, setDesignScale] = useState(1);
    const [designOffsetX, setDesignOffsetX] = useState(0);
    const [designOffsetY, setDesignOffsetY] = useState(0);
    const [designRotation, setDesignRotation] = useState(0);

    // Per-area designs
    const [areaDesigns, setAreaDesigns] = useState<Record<string, any>>({});
    const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
    const [showDesignPicker, setShowDesignPicker] = useState(false);

    // Yuppion katalog renkleri
    const [catalogColors, setCatalogColors] = useState<YuppionColor[]>([]);
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogModelId, setCatalogModelId] = useState<string>(
        template.configJson?.meta?.yuppionModelId || ''
    );
    const [savingModelId, setSavingModelId] = useState(false);

    useEffect(() => {
        const modelId = template.configJson?.meta?.yuppionModelId;
        if (!modelId) { setCatalogColors([]); return; }
        setCatalogLoading(true);
        apiCatalog.getColors(modelId)
            .then(data => setCatalogColors(data.colors))
            .catch(() => setCatalogColors([]))
            .finally(() => setCatalogLoading(false));
    }, [template.configJson?.meta?.yuppionModelId]);

    const saveModelId = async (modelId: string) => {
        setSavingModelId(true);
        try {
            const newMeta = { ...(template.configJson?.meta || {}), yuppionModelId: modelId || undefined };
            const savedTemplate = await apiMockups.updateTemplate(template.id, {
                configJson: { ...template.configJson, meta: newMeta }
            });

            // JPG/PNG template'ler için katalog renk eşleştirmesini tetikle
            if (modelId && !template.configJson?.meta?.isPsdDerived) {
                try {
                    const matchResult = await apiMockups.matchCatalogColor(template.id, modelId);
                    onUpdated(matchResult.template);
                    const matchStatus = matchResult.catalogColorMatch?.matched
                        ? `✓ ${matchResult.catalogColorMatch.color.name}`
                        : '✗ Katalog rengi bulunamadı';
                    addToast(matchResult.catalogColorMatch?.matched ? 'success' : 'error',
                        `Renk eşleştirme: ${matchStatus}`);
                } catch {
                    onUpdated(savedTemplate);
                }
            } else {
                onUpdated(savedTemplate);
            }

            if (modelId) {
                const data = await apiCatalog.getColors(modelId);
                setCatalogColors(data.colors);
            } else {
                setCatalogColors([]);
            }
        } catch (err: any) {
            addToast('error', 'Model kaydedilemedi: ' + err.message);
        } finally {
            setSavingModelId(false);
        }
    };

    const displayColors = catalogColors.length > 0 ? catalogColors : DEFAULT_COLORS;

    // Rendering
    const [rendering, setRendering] = useState(false);
    const [batchRendering, setBatchRendering] = useState(false);
    const [renderResult, setRenderResult] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savingToGallery, setSavingToGallery] = useState(false);

    // Video mockup
    const [videoRendering, setVideoRendering] = useState(false);
    const [videoResult, setVideoResult] = useState<string | null>(null);
    const [motionType, setMotionType] = useState<'subtle' | 'rotate' | 'wave' | 'zoom'>('subtle');

    // Multi print areas
    const [printAreas, setPrintAreas] = useState<Array<{
        id: string; label: string; x: number; y: number; width: number; height: number;
    }>>(template.configJson?.printAreas || []);

    const [pickingDesignForAreaId, setPickingDesignForAreaId] = useState<string | null>(null);
    const areaDesignImgsRef = useRef<Record<string, HTMLImageElement>>({});

    // Dark/Light variant toggle
    const [useDark, setUseDark] = useState(false);

    // Canvas state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const baseImgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
    const [baseLoaded, setBaseLoaded] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 800 });

    // Drag state (primary print area)
    const [dragging, setDragging] = useState<'move' | 'resize' | null>(null);
    const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0, pw: 0, ph: 0 });

    // Drag state (additional print areas)
    const [draggingAreaId, setDraggingAreaId] = useState<string | null>(null);
    const [resizingAreaId, setResizingAreaId] = useState<string | null>(null);
    const dragAreaStart = useRef({ mx: 0, my: 0, ax: 0, ay: 0, aw: 0, ah: 0 });

    // Drag state (rotate handle on the placed design)
    const [rotatingDesign, setRotatingDesign] = useState(false);
    // Drag state (resize handle on the placed design — separate from print-area resize)
    const [resizingDesign, setResizingDesign] = useState(false);

    // Load base image (switches when dark/light toggled)
    const activePath = useDark && template.darkImagePath ? template.darkImagePath : template.baseImagePath;
    useEffect(() => {
        setBaseLoaded(false);
        const isVideo = activePath && ['.mp4', '.mov', '.webm'].some(ext => activePath.toLowerCase().endsWith(ext));

        if (isVideo) {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.src = resolveUrl(activePath);
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.onloadeddata = () => {
                baseImgRef.current = video;
                setBaseLoaded(true);
                setCanvasSize({ w: video.videoWidth, h: video.videoHeight });
                video.play().catch(() => {});
            };
        } else {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.src = resolveUrl(activePath);
            img.onload = () => {
                baseImgRef.current = img;
                setBaseLoaded(true);
                setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
            };
        }
    }, [activePath]);

    // Handle initial design from props
    useEffect(() => {
        if (designUrl && designImageId && activeAreaId && !areaDesigns[activeAreaId]) {
            setAreaDesigns(prev => ({
                ...prev,
                [activeAreaId]: { id: designImageId, imageUrl: designUrl }
            }));
        }
    }, [designUrl, designImageId, activeAreaId]);

    // Sync printAreas from template config when template changes (normalized for backward compatibility)
    useEffect(() => {
        if (!template?.configJson) return;
        
        const normalizedAreas: any[] = [];
        // printAreas array varsa onu kullan, yoksa tekil printArea'dan oluştur
        if (Array.isArray(template.configJson.printAreas) && template.configJson.printAreas.length > 0) {
            template.configJson.printAreas.forEach((area: any) => {
                normalizedAreas.push(area);
            });
        } else if (template.configJson.printArea) {
            normalizedAreas.push({
                id: 'main',
                label: 'Ana Baskı',
                ...template.configJson.printArea
            });
        }
        
        setPrintAreas(normalizedAreas);
        
        // Auto-select the first available area or fall back to 'main'
        if (normalizedAreas.length > 0) {
            setActiveAreaId(normalizedAreas[0].id);
        } else if (!activeAreaId) {
            setActiveAreaId('main');
        }
    }, [template]);

    // Draw loop
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const base = baseImgRef.current;
        if (!canvas || !base) return;

        canvas.width = canvasSize.w;
        canvas.height = canvasSize.h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Checkerboard background
        const sqSz = 16;
        for (let y = 0; y < canvas.height; y += sqSz) {
            for (let x = 0; x < canvas.width; x += sqSz) {
                ctx.fillStyle = (Math.floor(x / sqSz) + Math.floor(y / sqSz)) % 2 === 0 ? '#1a1a2e' : '#16213e';
                ctx.fillRect(x, y, sqSz, sqSz);
            }
        }

        // Base
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

        // Print area coordinates
        const activeAreaBox = printAreas.find(a => a.id === activeAreaId) ?? printArea;
        const paX = activeAreaBox.x * canvas.width;
        const paY = activeAreaBox.y * canvas.height;
        const paW = activeAreaBox.width * canvas.width;
        const paH = activeAreaBox.height * canvas.height;

        // Design — the currently active print area's assigned design (live preview)
        const activeDesignImg = activeAreaId ? areaDesignImgsRef.current[activeAreaId] : null;
        if (activeDesignImg && activeDesignImg.complete && activeDesignImg.naturalWidth) {
            ctx.save();
            ctx.globalAlpha = opacity;
            if (blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';

            const designImg = activeDesignImg;

            // Scale design to fit print area, then apply user scale
            const baseScale = Math.min(paW / designImg.naturalWidth, paH / designImg.naturalHeight);
            const finalScale = baseScale * designScale;
            const designW = designImg.naturalWidth * finalScale;
            const designH = designImg.naturalHeight * finalScale;

            // Center within print area + apply offsets
            const designX = paX + (paW - designW) / 2 + (designOffsetX / 100 * paW);
            const designY = paY + (paH - designH) / 2 + (designOffsetY / 100 * paH);

            // Draw with rotation
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            ctx.drawImage(designImg, -designW / 2, -designH / 2, designW, designH);
            ctx.restore();

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

        // Print region border — sadece printAreas boşsa göster
        if (printAreas.length === 0) {
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            ctx.lineWidth = Math.max(2, canvas.width * 0.003);
            ctx.setLineDash([8, 5]);
            ctx.strokeRect(paX, paY, paW, paH);
            ctx.setLineDash([]);
            const hs = Math.max(10, canvas.width * 0.015);
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(paX + paW - hs, paY + paH - hs, hs, hs);
            const labelCx = paX + paW / 2;
            const labelCy = paY + paH / 2;
            ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
            ctx.font = `${Math.max(12, canvas.width * 0.015)}px sans-serif`;
            ctx.textAlign = 'center';
            if (!activeDesignImg) {
                ctx.fillText('Print Area', labelCx, labelCy);
            }
        }
        // Additional print areas
        if (printAreas.length > 0) {
            const areaColors = ['rgba(59,130,246,0.25)', 'rgba(234,179,8,0.25)', 'rgba(34,197,94,0.25)', 'rgba(239,68,68,0.25)'];
            const canvasW = canvas.width;
            const canvasH = canvas.height;

            // Draw per-area design previews first (below borders)
            printAreas.forEach(area => {
                if (area.id === activeAreaId) return; // drawn above with scale/offset/rotation applied
                const img = areaDesignImgsRef.current[area.id];
                if (!img || !img.complete || !img.naturalWidth) return;
                const paX = area.x * canvasW;
                const paY = area.y * canvasH;
                const paW = area.width * canvasW;
                const paH = area.height * canvasH;
                const scale = Math.min(paW / img.naturalWidth, paH / img.naturalHeight);
                const dW = img.naturalWidth * scale;
                const dH = img.naturalHeight * scale;
                ctx.save();
                ctx.globalAlpha = 0.85;
                ctx.drawImage(img, paX + (paW - dW) / 2, paY + (paH - dH) / 2, dW, dH);
                ctx.restore();
            });
            printAreas.forEach((area, i) => {
                ctx.strokeStyle = activeAreaId === area.id ? '#3b82f6' : '#64748b';
                ctx.lineWidth = activeAreaId === area.id ? 2 : 1;
                ctx.setLineDash([5, 5]);
                ctx.strokeRect(area.x * canvasW, area.y * canvasH, area.width * canvasW, area.height * canvasH);
                ctx.setLineDash([]);
                ctx.fillStyle = areaColors[i % areaColors.length];
                ctx.fillRect(area.x * canvasW, area.y * canvasH, area.width * canvasW, area.height * canvasH);
                ctx.fillStyle = 'white';
                ctx.font = `${Math.max(11, canvasW * 0.012)}px sans-serif`;
                ctx.textAlign = 'left';
                ctx.fillText(area.label, area.x * canvasW + 5, area.y * canvasH + 15);
                // Resize handle (bottom-right)
                const handlePx = 10;
                ctx.fillStyle = activeAreaId === area.id ? '#3b82f6' : '#64748b';
                ctx.fillRect(
                    (area.x + area.width) * canvasW - handlePx,
                    (area.y + area.height) * canvasH - handlePx,
                    handlePx, handlePx
                );
            });
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designScale, designOffsetX, designOffsetY, designRotation, rotatingDesign, resizingDesign]);

    useEffect(() => {
        let rafId: number;
        const loop = () => {
            draw();
            rafId = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(rafId);
    }, [draw]);

    // Load area design images into ref cache; trigger redraw on load
    useEffect(() => {
        // Remove stale entries
        Object.keys(areaDesignImgsRef.current).forEach(id => {
            if (!areaDesigns[id]) delete areaDesignImgsRef.current[id];
        });
        Object.entries(areaDesigns).forEach(([areaId, design]) => {
            const newSrc = design.imageUrl.startsWith('http') ? design.imageUrl : `${API_BASE}/${design.imageUrl}`;
            const cached = areaDesignImgsRef.current[areaId];
            if (cached && cached.src === newSrc) return;
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.src = newSrc;
            img.onload = () => { areaDesignImgsRef.current[areaId] = img; draw(); };
            areaDesignImgsRef.current[areaId] = img;
        });
    }, [areaDesigns, draw]);

    // Mouse handlers
    const getCoords = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    const onMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);
        const hs = 0.02;

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
        if (printAreas.length > 0) {
            for (let i = printAreas.length - 1; i >= 0; i--) {
                const area = printAreas[i];
                // Resize handle (bottom-right corner)
                if (x >= area.x + area.width - hs && x <= area.x + area.width + hs &&
                    y >= area.y + area.height - hs && y <= area.y + area.height + hs) {
                    setResizingAreaId(area.id);
                    setActiveAreaId(area.id);
                    dragAreaStart.current = { mx: x, my: y, ax: area.x, ay: area.y, aw: area.width, ah: area.height };
                    e.preventDefault();
                    return;
                }
                // Move (inside area)
                if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
                    setDraggingAreaId(area.id);
                    setActiveAreaId(area.id);
                    dragAreaStart.current = { mx: x, my: y, ax: area.x, ay: area.y, aw: area.width, ah: area.height };
                    e.preventDefault();
                    return;
                }
            }
        }

        // Primary print area
        const phs = 0.03;
        if (x >= printArea.x + printArea.width - phs && x <= printArea.x + printArea.width + phs &&
            y >= printArea.y + printArea.height - phs && y <= printArea.y + printArea.height + phs) {
            setDragging('resize');
            dragStart.current = { mx: x, my: y, px: printArea.x, py: printArea.y, pw: printArea.width, ph: printArea.height };
            return;
        }
        if (x >= printArea.x && x <= printArea.x + printArea.width && y >= printArea.y && y <= printArea.y + printArea.height) {
            setDragging('move');
            dragStart.current = { mx: x, my: y, px: printArea.x, py: printArea.y, pw: printArea.width, ph: printArea.height };
        }
    };

    const onMouseMove = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);

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
        if (draggingAreaId) {
            const dx = x - dragAreaStart.current.mx;
            const dy = y - dragAreaStart.current.my;
            setPrintAreas(prev => prev.map(a => a.id !== draggingAreaId ? a : {
                ...a,
                x: Math.max(0, Math.min(1 - a.width, dragAreaStart.current.ax + dx)),
                y: Math.max(0, Math.min(1 - a.height, dragAreaStart.current.ay + dy)),
            }));
            return;
        }
        if (resizingAreaId) {
            setPrintAreas(prev => prev.map(a => {
                if (a.id !== resizingAreaId) return a;
                return {
                    ...a,
                    width: Math.max(0.05, Math.min(1 - a.x, x - a.x)),
                    height: Math.max(0.05, Math.min(1 - a.y, y - a.y)),
                };
            }));
            return;
        }

        // Primary print area drag/resize
        if (dragging) {
            const dx = x - dragStart.current.mx;
            const dy = y - dragStart.current.my;
            if (dragging === 'move') {
                setPrintArea({
                    x: Math.max(0, Math.min(1 - dragStart.current.pw, dragStart.current.px + dx)),
                    y: Math.max(0, Math.min(1 - dragStart.current.ph, dragStart.current.py + dy)),
                    width: dragStart.current.pw, height: dragStart.current.ph,
                });
            } else {
                setPrintArea({
                    x: dragStart.current.px, y: dragStart.current.py,
                    width: Math.max(0.05, Math.min(1 - dragStart.current.px, dragStart.current.pw + dx)),
                    height: Math.max(0.05, Math.min(1 - dragStart.current.py, dragStart.current.ph + dy)),
                });
            }
            return;
        }

        // Cursor hint
        const canvas = canvasRef.current;
        if (!canvas) return;

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
        for (let i = printAreas.length - 1; i >= 0; i--) {
            const area = printAreas[i];
            if (x >= area.x + area.width - hs && x <= area.x + area.width + hs &&
                y >= area.y + area.height - hs && y <= area.y + area.height + hs) {
                canvas.style.cursor = 'se-resize'; return;
            }
            if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
                canvas.style.cursor = 'move'; return;
            }
        }
        const phs = 0.03;
        if (x >= printArea.x + printArea.width - phs && x <= printArea.x + printArea.width + phs &&
            y >= printArea.y + printArea.height - phs && y <= printArea.y + printArea.height + phs) {
            canvas.style.cursor = 'se-resize';
        } else if (x >= printArea.x && x <= printArea.x + printArea.width &&
                   y >= printArea.y && y <= printArea.y + printArea.height) {
            canvas.style.cursor = 'move';
        } else {
            canvas.style.cursor = 'crosshair';
        }
    };

    const onMouseUp = () => {
        setDragging(null);
        setDraggingAreaId(null);
        setResizingAreaId(null);
        setRotatingDesign(false);
        setResizingDesign(false);
    };

    // Actions
    const saveConfig = async () => {
        setSaving(true);
        try {
            const updated = await apiMockups.updateTemplate(template.id, {
                configJson: {
                    printArea,
                    ...(printAreas.length > 0 && { printAreas }),
                    transform: { rotation, opacity, blendMode },
                    render: { renderMode: 'flat', displacementStrength: displacementStrength > 0 ? displacementStrength : undefined },
                },
            });
            onUpdated(updated);
            addToast('success', 'Template config saved');
        } catch (err: any) {
            addToast('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveToGallery = async () => {
        if (!renderResult) return;
        const primaryId = Object.values(areaDesigns)[0]?.id;
        setSavingToGallery(true);
        try {
            await apiGallery.saveMockup(renderResult, primaryId);
            addToast('success', 'Saved to gallery!');
        } catch (err: any) {
            addToast('error', err.message);
        } finally {
            setSavingToGallery(false);
        }
    };

    const handleRender = async () => {
        if (!template || Object.keys(areaDesigns).length === 0) return;
        setRendering(true);
        try {
            // Save config first
            const configPayload = {
                printArea,
                printAreas,
                transform: { rotation, opacity, blendMode },
                render: { renderMode: 'flat', displacementStrength: displacementStrength > 0 ? displacementStrength : undefined },
            };
            await apiMockups.updateTemplate(template.id, { configJson: configPayload });
            
            const renderPayload = {
                scale: designScale,
                offsetX: designOffsetX / 100,
                offsetY: designOffsetY / 100,
                rotation: designRotation,
                blendMode,
            };

            // Build areaDesigns map keyed by areaId for backend
            const areaDesignsForApi: Record<string, { imageId: string; imageUrl: string }> = {};
            Object.entries(areaDesigns).forEach(([areaId, design]) => {
                areaDesignsForApi[areaId] = { imageId: design.id, imageUrl: design.imageUrl };
            });

            const primaryId = Object.values(areaDesigns)[0].id;

            const result = await apiMockups.render(
                primaryId,
                template.id,
                renderPayload,
                Object.keys(areaDesignsForApi).length > 1 ? areaDesignsForApi : undefined,
                productColor
            );
            const renderedUrl = resolveUrl(result.mockupUrl);
            setRenderResult(renderedUrl);
            
            try {
                await apiGallery.saveMockup(renderedUrl, primaryId);
                addToast('success', 'Mockup rendered and saved to gallery!');
            } catch {
                addToast('info', 'Mockup rendered. Click "Save to Gallery" to save.');
            }
        } catch (err: any) {
            addToast('error', 'Render failed: ' + err.message);
        } finally {
            setRendering(false);
        }
    };


    return (
        <div className="fixed inset-0 z-50 flex bg-black/80 backdrop-blur-md">
            <div className="flex-1 flex flex-col bg-[#0f172a] m-3 rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/60 bg-gradient-to-r from-[#1a2332] to-[#1e293b]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                            <Grid3x3 className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-white">{template.name}</h2>
                            <p className="text-[11px] text-slate-400 capitalize">{template.category.replace('_', ' ')} • Template Editor</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={saveConfig} disabled={saving}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-600/50 text-white text-xs rounded-lg font-medium border border-slate-600/50 transition-colors">
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Config
                        </button>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/50 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Canvas Area */}
                    <div ref={containerRef} className="flex-1 flex items-center justify-center p-6 bg-[#0a0f1a]">
                        <canvas
                            ref={canvasRef}
                            className="max-w-full max-h-full rounded-lg shadow-2xl"
                            style={{ maxHeight: 'calc(100vh - 160px)', cursor: dragging ? 'grabbing' : 'crosshair' }}
                            onMouseDown={onMouseDown}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                            onMouseLeave={onMouseUp}
                        />
                    </div>

                    {/* Controls Panel */}
                    <div className="w-80 bg-[#1a2332] border-l border-slate-700/60 flex flex-col">
                        <div className="flex-1 overflow-y-auto p-5 space-y-6">
                            {/* Dark/Light Variant Toggle */}
                            {template.darkImagePath && (
                                <section>
                                    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Variant</h3>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setUseDark(false)}
                                            className={cn(
                                                'flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                                                !useDark
                                                    ? 'bg-slate-100/10 border-slate-400/50 text-white'
                                                    : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500'
                                            )}
                                        >
                                            ☀ Light
                                        </button>
                                        <button
                                            onClick={() => setUseDark(true)}
                                            className={cn(
                                                'flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                                                useDark
                                                    ? 'bg-slate-800 border-slate-400/50 text-white'
                                                    : 'bg-transparent border-slate-700 text-slate-500 hover:border-slate-500'
                                            )}
                                        >
                                            ☾ Dark
                                        </button>
                                    </div>
                                </section>
                            )}

                            {/* Print Area */}
                            <section>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                        {printAreas.length > 0 ? 'Print Areas' : 'Print Area'}
                                    </h3>
                                    <button
                                        onClick={() => {
                                            const newArea = {
                                                id: `area_${Date.now()}`,
                                                label: `Person ${printAreas.length + 1}`,
                                                x: 0.1 + (printAreas.length * 0.25),
                                                y: 0.3,
                                                width: 0.2,
                                                height: 0.25
                                            };
                                            setPrintAreas(prev => [...prev, newArea]);
                                            setActiveAreaId(newArea.id);
                                        }}
                                        className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] rounded-lg transition-colors"
                                    >
                                        <Plus className="w-3 h-3" /> Add Area
                                    </button>
                                </div>

                                {/* Primary print area coords — only show when no extra areas to avoid confusion */}
                                {printAreas.length === 0 && (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            {([['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']] as const).map(([key, label]) => (
                                                <div key={key}>
                                                    <label className="text-[10px] text-slate-500 mb-0.5 block font-medium">{label}</label>
                                                    <input type="number" step="0.01" min="0" max="1"
                                                        value={(printArea as any)[key].toFixed(3)}
                                                        onChange={e => setPrintArea(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                                                        className="w-full px-2 py-1.5 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white text-xs font-mono focus:border-blue-500/50 focus:outline-none" />
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[9px] text-slate-600 mt-1.5">Drag the print area on canvas to reposition. Drag bottom-right corner to resize.</p>
                                    </>
                                )}

                                {printAreas.length > 0 && (
                                    <div className="space-y-1 mt-1">
                                        {/* Info banner */}
                                        <div className="px-2.5 py-2 bg-blue-600/10 border border-blue-500/20 rounded-lg mb-2">
                                            <p className="text-[10px] text-blue-400 leading-relaxed">
                                                ✦ The selected design will be applied to <strong>all areas</strong>. Optionally assign a different design to each area.
                                            </p>
                                        </div>
                                        {printAreas.map(area => (
                                            <div
                                                key={area.id}
                                                onClick={() => setActiveAreaId(activeAreaId === area.id ? null : area.id)}
                                                className={cn(
                                                    'px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-xs',
                                                    activeAreaId === area.id
                                                        ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
                                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-transparent'
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span onClick={() => setActiveAreaId(area.id)}>{area.label}</span>
                                                    <div className="flex items-center gap-1">
                                                        {!areaDesigns[area.id] && (
                                                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-500 rounded">auto</span>
                                                        )}
                                                        <button
                                                            onClick={e => { e.stopPropagation(); setPickingDesignForAreaId(area.id); }}
                                                            className="text-[10px] px-1.5 py-0.5 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30 transition-colors"
                                                        >
                                                            {areaDesigns[area.id] ? 'Change' : '+ Custom'}
                                                        </button>
                                                        {areaDesigns[area.id] && (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={areaDesigns[area.id].imageUrl.startsWith('http') ? areaDesigns[area.id].imageUrl : `${API_BASE}/${areaDesigns[area.id].imageUrl}`}
                                                                alt=""
                                                                className="w-6 h-6 object-contain rounded border border-slate-600"
                                                            />
                                                        )}
                                                        <button
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setPrintAreas(prev => prev.filter(a => a.id !== area.id));
                                                                if (activeAreaId === area.id) setActiveAreaId(null);
                                                            }}
                                                            className="text-slate-500 hover:text-red-400 transition-colors"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <p className="text-[9px] text-slate-600 mt-1.5">Drag areas on canvas to reposition. Drag bottom-right corner to resize.</p>
                                    </div>
                                )}
                            </section>

                            {/* Appearance */}
                            <section>
                                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Appearance</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] text-slate-500 mb-1.5 block font-medium">Opacity: {(opacity * 100).toFixed(0)}%</label>
                                        <input type="range" min="0" max="1" step="0.01" value={opacity}
                                            onChange={e => setOpacity(parseFloat(e.target.value))}
                                            className="w-full accent-blue-500 h-1.5" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 mb-1.5 block font-medium">Blend Mode</label>
                                        <select value={blendMode} onChange={e => setBlendMode(e.target.value)}
                                            className="w-full px-2 py-1.5 bg-slate-800/80 border border-slate-600/50 rounded-lg text-white text-xs focus:border-blue-500/50 focus:outline-none">
                                            <option value="auto">Auto (recommended)</option>
                                            <option value="multiply">Multiply</option>
                                            <option value="over">Over</option>
                                            <option value="normal">Normal</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 mb-1.5 block font-medium flex items-center gap-1">
                                            <RotateCw className="w-3 h-3" /> Rotation: {rotation}°
                                        </label>
                                        <input type="range" min="-180" max="180" step="1" value={rotation}
                                            onChange={e => setRotation(parseInt(e.target.value))}
                                            className="w-full accent-blue-500 h-1.5" />
                                    </div>
                                    {template.shadowImagePath && (
                                        <div>
                                            <label className="text-[10px] text-slate-500 mb-1.5 block font-medium">
                                                Displacement: {displacementStrength === 0 ? 'Off' : `${displacementStrength}px`}
                                            </label>
                                            <input type="range" min="0" max="25" step="1" value={displacementStrength}
                                                onChange={e => setDisplacementStrength(parseInt(e.target.value))}
                                                className="w-full accent-purple-500 h-1.5" />
                                            <p className="text-[9px] text-slate-600 mt-1">Warps design to follow fabric texture using shadow layer.</p>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Design Picker */}
                            <section>
                                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Apply Design</h3>

                                {/* ── Print Area Pill Selector (multi-area mode) ── */}
                                {printAreas.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-3">
                                        {printAreas.map(area => {
                                            const hasDesign = !!areaDesigns[area.id];
                                            const isActive = activeAreaId === area.id;
                                            return (
                                                <button
                                                    key={area.id}
                                                    onClick={() => setActiveAreaId(area.id)}
                                                    className={cn(
                                                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                                                        isActive
                                                            ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white border-purple-500/50 shadow shadow-purple-600/20'
                                                            : 'bg-slate-800/40 text-gray-400 border-slate-700 hover:border-slate-500 hover:text-slate-300'
                                                    )}
                                                >
                                                    {hasDesign && <span className="text-emerald-400 text-[10px]">✓</span>}
                                                    {area.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* ── Global design picker (single-area mode) ── */}
                                {printAreas.length === 0 && (
                                    !areaDesigns['main'] ? (
                                        <button onClick={() => setShowDesignPicker(true)}
                                            className="w-full px-3 py-3 bg-slate-800/50 border-2 border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:border-blue-500/50 hover:text-blue-400 transition-all flex flex-col items-center gap-1.5">
                                            <Search className="w-5 h-5" />
                                            Select an approved design
                                        </button>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="p-2 bg-slate-800/50 border border-slate-600/50 rounded-xl">
                                                <img src={areaDesigns['main'].imageUrl.startsWith('http') ? areaDesigns['main'].imageUrl : `${API_BASE}/${areaDesigns['main'].imageUrl}`}
                                                    alt="Design" className="w-full h-24 object-contain rounded-lg" />
                                            </div>
                                            <button onClick={() => setShowDesignPicker(true)}
                                                className="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors">
                                                Change design
                                            </button>
                                        </div>
                                    )
                                )}

                                {/* ── Multi-area: seçili alan için tasarım göster/seç ── */}
                                {activeAreaId && (
                                    <div className="space-y-2">
                                        {areaDesigns[activeAreaId] ? (
                                            <>
                                                <div className="p-2 bg-slate-800/50 border border-slate-600/50 rounded-xl">
                                                    <img
                                                        src={areaDesigns[activeAreaId].imageUrl.startsWith('http')
                                                            ? areaDesigns[activeAreaId].imageUrl
                                                            : `${API_BASE}/${areaDesigns[activeAreaId].imageUrl}`}
                                                        alt="Design"
                                                        className="w-full h-20 object-contain rounded-lg"
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setShowDesignPicker(true)}
                                                        className="flex-1 py-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                                                    >
                                                        Change
                                                    </button>
                                                    <button
                                                        onClick={() => setAreaDesigns(prev => {
                                                            const next = { ...prev };
                                                            delete next[activeAreaId];
                                                            return next;
                                                        })}
                                                        className="flex-1 py-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <button
                                                onClick={() => setShowDesignPicker(true)}
                                                className="w-full px-3 py-3 bg-slate-800/50 border-2 border-dashed border-slate-600 rounded-xl text-xs text-slate-400 hover:border-purple-500/50 hover:text-purple-400 transition-all flex flex-col items-center gap-1.5"
                                            >
                                                <Search className="w-4 h-4" />
                                                Assign design to <strong>{printAreas.find(a => a.id === activeAreaId)?.label || 'selected area'}</strong>
                                            </button>
                                        )}
                                    </div>
                                )}

                                {printAreas.length > 0 && !activeAreaId && (
                                    <p className="text-[11px] text-slate-500 text-center py-3">
                                        Select a print area above to assign a design
                                    </p>
                                )}
                            </section>

                            {/* Design Transform Controls */}
                            {Object.keys(areaDesigns).length > 0 && (
                                <section>
                                    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                        Design Position
                                    </h3>
                                    <div className="space-y-3">
                                        {/* Scale */}
                                        <div>
                                            <label className="text-xs text-slate-400 flex items-center justify-between mb-1">
                                                <span>Size</span>
                                                <span className="font-mono">{Math.round(designScale * 100)}%</span>
                                            </label>
                                            <input type="range" min="20" max="150" step="1"
                                                value={Math.round(designScale * 100)}
                                                onChange={e => setDesignScale(parseInt(e.target.value) / 100)}
                                                className="w-full accent-blue-500 h-1.5"
                                            />
                                        </div>
                                        
                                        {/* Horizontal offset */}
                                        <div>
                                            <label className="text-xs text-slate-400 flex items-center justify-between mb-1">
                                                <span>Horizontal</span>
                                                <span className="font-mono">{designOffsetX}</span>
                                            </label>
                                            <input type="range" min="-50" max="50" step="1"
                                                value={designOffsetX}
                                                onChange={e => setDesignOffsetX(parseInt(e.target.value))}
                                                className="w-full accent-blue-500 h-1.5"
                                            />
                                        </div>
                                        
                                        {/* Vertical offset */}
                                        <div>
                                            <label className="text-xs text-slate-400 flex items-center justify-between mb-1">
                                                <span>Vertical</span>
                                                <span className="font-mono">{designOffsetY}</span>
                                            </label>
                                            <input type="range" min="-50" max="50" step="1"
                                                value={designOffsetY}
                                                onChange={e => setDesignOffsetY(parseInt(e.target.value))}
                                                className="w-full accent-blue-500 h-1.5"
                                            />
                                        </div>
                                        
                                        {/* Rotation */}
                                        <div>
                                            <label className="text-xs text-slate-400 flex items-center justify-between mb-1">
                                                <RotateCw className="w-3 h-3" />
                                                <span>Rotation: {designRotation}°</span>
                                            </label>
                                            <input type="range" min="-180" max="180" step="1"
                                                value={designRotation}
                                                onChange={e => setDesignRotation(parseInt(e.target.value))}
                                                className="w-full accent-blue-500 h-1.5"
                                            />
                                        </div>
                                        
                                        {/* Reset button */}
                                        <button
                                            onClick={() => { setDesignScale(1); setDesignOffsetX(0); setDesignOffsetY(0); setDesignRotation(0); }}
                                            className="w-full py-1.5 text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
                                        >
                                            Reset Position
                                        </button>
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="p-4 border-t border-slate-700/60 space-y-2">
                            {template.configJson?.meta?.isPsdDerived && (
                                <div className="pb-2 border-b border-slate-700/60 space-y-2">
                                    {/* Yuppion Model Bağlantısı */}
                                    <div>
                                        <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wide">Yuppion Model</p>
                                        <div className="flex gap-1.5">
                                            <input
                                                type="text"
                                                value={catalogModelId}
                                                onChange={e => setCatalogModelId(e.target.value.toUpperCase())}
                                                placeholder="BC3001, CC1717, G18500…"
                                                className="flex-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-[10px] text-white font-mono focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
                                            />
                                            <button
                                                onClick={() => saveModelId(catalogModelId)}
                                                disabled={savingModelId}
                                                className="px-2 py-1 text-[10px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded border border-blue-500/30 disabled:opacity-40 transition-colors"
                                            >
                                                {savingModelId ? '…' : 'Kaydet'}
                                            </button>
                                        </div>
                                        {catalogColors.length > 0 && (
                                            <p className="text-[9px] text-emerald-400 mt-0.5">
                                                ✓ {catalogColors.length} renk yüklendi
                                            </p>
                                        )}
                                        {!template.configJson?.meta?.yuppionModelId && (
                                            <p className="text-[9px] text-slate-500 mt-0.5">
                                                Model ID atanınca Yuppion renkleri otomatik yüklenir
                                            </p>
                                        )}
                                    </div>

                                    {/* Renk Paleti */}
                                    <div>
                                        <p className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wide flex items-center gap-1">
                                            Ürün Rengi
                                            {catalogLoading && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                            {catalogColors.length > 0 && <span className="text-[8px] text-emerald-400 normal-case">Yuppion</span>}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5 mb-2 max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
                                            {displayColors.map(c => (
                                                <button
                                                    key={c.hex}
                                                    title={c.name}
                                                    onClick={() => onColorChange?.(c.hex)}
                                                    className={cn(
                                                        'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0',
                                                        productColor === c.hex ? 'border-blue-400 scale-110' : 'border-slate-600',
                                                    )}
                                                    style={{ backgroundColor: c.hex }}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={productColor || '#FFFFFF'}
                                                onChange={e => onColorChange?.(e.target.value)}
                                                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                                            />
                                            <input
                                                type="text"
                                                value={productColor || '#FFFFFF'}
                                                onChange={e => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onColorChange?.(e.target.value); }}
                                                placeholder="#FFFFFF"
                                                className="flex-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-[10px] text-white font-mono focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={handleRender}
                                disabled={rendering || Object.keys(areaDesigns).length === 0}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                            >
                                {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                                {rendering ? 'Rendering...' : `Place Design & Render${
                                    printAreas.length > 0
                                        ? ` (${Object.keys(areaDesigns).length}/${printAreas.length} areas)`
                                        : ''
                                }`}
                            </button>
                            {renderResult && (
                                <div className="p-3 bg-emerald-600/10 border border-emerald-500/30 rounded-xl space-y-2">
                                    <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Mockup rendered!
                                    </p>
                                    {(() => {
                                        const resolvedRenderUrl = resolveUrl(renderResult);
                                        const downloadMockup = async () => {
                                            try {
                                                const response = await fetch(resolvedRenderUrl, { mode: 'cors' });
                                                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                                                const blob = await response.blob();
                                                console.log('[Download] Blob type:', blob.type, 'size:', blob.size);
                                                if (blob.size < 1000) throw new Error('File too small');
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `mockup-${template.name}-${Date.now()}.png`;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                URL.revokeObjectURL(url);
                                            } catch (err) {
                                                console.error('[Download] Failed:', err);
                                                window.open(resolvedRenderUrl, '_blank');
                                            }
                                        };
                                        return (
                                            <>
                                    <img src={resolvedRenderUrl} alt="Rendered" className="w-full rounded-lg shadow" />
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={downloadMockup}
                                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                                        >
                                            <Download className="w-3 h-3" /> Download
                                        </button>
                                        <button
                                            onClick={async () => {
                                                const response = await fetch('/api/etsy-browser/pin-pinterest', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    credentials: 'include',
                                                    body: JSON.stringify({
                                                        imageUrl: renderResult,
                                                        title: template.name,
                                                        description: `Check out this amazing design on Etsy! ${template.name}`,
                                                        link: 'https://www.etsy.com/your-shop'
                                                    })
                                                });
                                                const data = await response.json();
                                                if (data.success) addToast('success', 'Pinned to Pinterest!');
                                                else addToast('error', data.error || 'Pinterest pin failed');
                                            }}
                                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 font-medium"
                                        >
                                            📌 Pin to Pinterest
                                        </button>
                                    </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                            {renderResult && (
                                <div className="p-3 border-t border-slate-700/60 space-y-3">
                                    <p className="text-xs font-semibold text-slate-300">🎬 Create Video Mockup</p>
                                    <select
                                        value={motionType}
                                        onChange={e => setMotionType(e.target.value as 'subtle' | 'rotate' | 'wave' | 'zoom')}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs"
                                    >
                                        <option value="subtle">Subtle Movement</option>
                                        <option value="rotate">360° Rotation</option>
                                        <option value="wave">Fabric Wave</option>
                                        <option value="zoom">Zoom In</option>
                                    </select>
                                    <button
                                        onClick={async () => {
                                            if (!renderResult || renderResult.includes('localhost')) {
                                                addToast('error', 'Video requires a public URL. Make sure the mockup is saved to Supabase (not localhost).');
                                                return;
                                            }
                                            setVideoRendering(true);
                                            setVideoResult(null);
                                            try {
                                                console.log('[Video] mockupImageUrl being sent:', renderResult);
                                                const res = await fetch('/api/mockups/templates/render-video', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    credentials: 'include',
                                                    body: JSON.stringify({ mockupImageUrl: renderResult, duration: 5, motionType })
                                                });
                                                const responseText = await res.text();
                                                console.log('[Video] Response status:', res.status);
                                                console.log('[Video] Response body:', responseText);
                                                const data = JSON.parse(responseText);
                                                if (data.videoUrl) {
                                                    setVideoResult(data.videoUrl);
                                                    addToast('success', 'Video mockup created!');
                                                } else {
                                                    addToast('error', data.error || 'Video failed');
                                                    console.error('[Video] Error detail:', data.detail);
                                                }
                                            } catch (err: any) {
                                                addToast('error', err.message);
                                            } finally {
                                                setVideoRendering(false);
                                            }
                                        }}
                                        disabled={videoRendering}
                                        className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all"
                                    >
                                        {videoRendering
                                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating video (~30-60s)...</>
                                            : <>🎬 Create Video Mockup</>
                                        }
                                    </button>
                                    {videoResult && (
                                        <div className="space-y-2">
                                            <video src={videoResult} controls autoPlay loop className="w-full rounded-lg" />
                                            <a
                                                href={videoResult}
                                                download={`video-mockup-${Date.now()}.mp4`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition-colors"
                                            >
                                                <Download className="w-3.5 h-3.5" /> Download Video
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showDesignPicker && (
                <DesignPickerModal
                    onClose={() => setShowDesignPicker(false)}
                    onSelect={(img) => {
                        if (activeAreaId) {
                            setAreaDesigns(prev => ({
                                ...prev,
                                [activeAreaId]: img,
                            }));
                        }
                        setShowDesignPicker(false);
                    }}
                />
            )}

            {pickingDesignForAreaId && (
                <DesignPickerModal
                    onClose={() => setPickingDesignForAreaId(null)}
                    onSelect={(img) => {
                        setAreaDesigns(prev => ({
                            ...prev,
                            [pickingDesignForAreaId]: { id: img.id, imageUrl: img.imageUrl }
                        }));
                        setPickingDesignForAreaId(null);
                    }}
                />
            )}

        </div>
    );
}

// ─── Design Picker ───────────────────────────────────────────────────────────
function DesignPickerModal({ onClose, onSelect }: {
    onClose: () => void;
    onSelect: (img: GalleryImage) => void;
}) {
    const [mode, setMode] = useState<'gallery' | 'upload'>('gallery');
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        apiGallery.getRecent()
            .then(all => setImages(all.filter((i: GalleryImage) => i.engine !== 'mockup')))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const filtered = search
        ? images.filter(i => i.id.toLowerCase().includes(search.toLowerCase()))
        : images;

    const handleUpload = async (file: File) => {
        if (!file.type.startsWith('image/')) { setUploadError('Lütfen bir görsel dosyası seçin'); return; }
        setUploading(true);
        setUploadError(null);
        try {
            const result = await apiGallery.uploadExternal(file);
            onSelect({
                id: result.id,
                imageUrl: result.imageUrl,
                placeholderUrl: null,
                status: 'COMPLETED',
                isApproved: true,
                engine: 'external_upload',
                seed: null,
                cost: 0,
                createdAt: new Date().toISOString(),
            });
        } catch (err: unknown) {
            setUploadError(err instanceof Error ? err.message : 'Yükleme başarısız');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Select a Design</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex gap-1 p-1 bg-slate-800 rounded-xl border border-slate-700 w-fit">
                    <button
                        onClick={() => setMode('gallery')}
                        className={cn(
                            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            mode === 'gallery' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                        )}
                    >
                        <ImageIcon className="w-3.5 h-3.5" /> Galeriden Seç
                    </button>
                    <button
                        onClick={() => setMode('upload')}
                        className={cn(
                            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            mode === 'upload' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                        )}
                    >
                        <Upload className="w-3.5 h-3.5" /> Bilgisayardan Yükle
                    </button>
                </div>

                {mode === 'gallery' ? (
                    <>
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by ID..."
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-blue-500"
                            autoFocus
                        />
                        <div className="flex-1 overflow-y-auto">
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">No designs found</div>
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
                                                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                                                    <span className="text-[9px] text-white/70 font-mono uppercase mb-1">
                                                        {img.engine === 'bg_remove' ? '✂ BG Removed' :
                                                         img.engine === 'upscale' ? '⬆ Upscaled' :
                                                         img.engine === 'mockup' ? '🖼 Mockup' : '✨ Generated'}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 overflow-y-auto space-y-3">
                        <div
                            className={cn(
                                'flex flex-col items-center justify-center gap-3 py-16 rounded-xl border-2 border-dashed cursor-pointer transition-all',
                                dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-800/60 hover:border-slate-500'
                            )}
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={e => {
                                e.preventDefault();
                                setDragOver(false);
                                const f = e.dataTransfer.files?.[0];
                                if (f) handleUpload(f);
                            }}
                            onClick={() => !uploading && fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                            />
                            {uploading ? (
                                <>
                                    <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                                    <p className="text-sm text-slate-300">Yükleniyor…</p>
                                </>
                            ) : (
                                <>
                                    <Upload className="w-10 h-10 text-slate-500" />
                                    <p className="text-sm font-medium text-slate-200">Sürükle bırak veya <span className="text-blue-400">seç</span></p>
                                    <p className="text-xs text-slate-500">JPG, PNG, WEBP</p>
                                </>
                            )}
                        </div>
                        {uploadError && (
                            <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
                                {uploadError}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Rendered Mockups Section (date-grouped accordion) ───────────────────────
function RenderedMockupsSection({ renderedMockups, refetchMockups, addToast }: {
    renderedMockups: GalleryImage[];
    refetchMockups: () => void;
    addToast: (type: ToastType, msg: string) => void;
}) {
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);

    const grouped = useMemo(() => {
        const map = new Map<string, GalleryImage[]>();
        for (const img of renderedMockups) {
            const date = new Date(img.createdAt).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
            });
            if (!map.has(date)) map.set(date, []);
            map.get(date)!.push(img);
        }
        return Array.from(map.entries());
    }, [renderedMockups]);

    const toggle = (date: string) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(date)) next.delete(date); else next.add(date);
        return next;
    });

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const handleDelete = async (imageId: string) => {
        try {
            await fetch(`${API_BASE}/api/gallery/${imageId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            refetchMockups();
            addToast('success', 'Mockup deleted');
        } catch {
            addToast('error', 'Failed to delete');
        }
    };

    const handleBulkDelete = async () => {
        if (!confirm(`${selectedIds.size} mockup'u silmek istediğine emin misin?`)) return;
        setBulkDeleting(true);
        try {
            await Promise.all(Array.from(selectedIds).map(id =>
                fetch(`${API_BASE}/api/gallery/${id}`, { method: 'DELETE', credentials: 'include' })
            ));
            setSelectedIds(new Set());
            refetchMockups();
            addToast('success', `${selectedIds.size} mockup silindi`);
        } catch {
            addToast('error', 'Silme başarısız');
        } finally {
            setBulkDeleting(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <ImageIcon className="w-5 h-5 text-purple-400" />
                    Rendered Mockups ({renderedMockups.length})
                </h2>
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">{selectedIds.size} seçili</span>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            Temizle
                        </button>
                        <button
                            onClick={handleBulkDelete}
                            disabled={bulkDeleting}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                            <Trash2 className="w-3 h-3" />
                            {bulkDeleting ? 'Siliniyor...' : `Sil (${selectedIds.size})`}
                        </button>
                    </div>
                )}
            </div>
            <div className="space-y-3">
                {grouped.map(([date, imgs]) => {
                    const isOpen = !collapsed.has(date);
                    return (
                        <div key={date} className="bg-slate-800/40 border border-slate-700/60 rounded-2xl overflow-hidden">
                            <button
                                onClick={() => toggle(date)}
                                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors"
                            >
                                <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shrink-0" />
                                    {date}
                                    <span className="text-xs text-slate-500 font-normal">
                                        ({imgs.length} mockup{imgs.length !== 1 ? 's' : ''})
                                    </span>
                                </span>
                                {isOpen
                                    ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                                    : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                                }
                            </button>
                            {isOpen && (
                                <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                                    {imgs.map(img => {
                                        const url = img.imageUrl.startsWith('http')
                                            ? img.imageUrl
                                            : `${API_BASE}/${img.imageUrl}`;
                                        const isSelected = selectedIds.has(img.id);
                                        return (
                                            <div
                                                key={img.id}
                                                className={cn(
                                                    'group relative aspect-square bg-slate-900/50 border rounded-xl overflow-hidden transition-all cursor-pointer',
                                                    isSelected
                                                        ? 'border-purple-500 ring-2 ring-purple-500/50'
                                                        : 'border-slate-700 hover:border-purple-500/50'
                                                )}
                                                onClick={() => toggleSelect(img.id)}
                                            >
                                                <img
                                                    src={url}
                                                    alt="Mockup"
                                                    className="w-full h-full object-cover"
                                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                                />
                                                {/* Checkbox top-left */}
                                                <div className={cn(
                                                    'absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                                                    isSelected
                                                        ? 'bg-purple-500 border-purple-500'
                                                        : 'bg-black/40 border-slate-500 opacity-0 group-hover:opacity-100'
                                                )}>
                                                    {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                                </div>
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2"
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                const r = await fetch(url);
                                                                const blob = await r.blob();
                                                                const a = document.createElement('a');
                                                                a.href = URL.createObjectURL(blob);
                                                                a.download = `mockup-${img.id.slice(0, 8)}.png`;
                                                                a.click();
                                                            } catch { window.open(url, '_blank'); }
                                                        }}
                                                        className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                                                        title="Download"
                                                    >
                                                        <Download className="w-4 h-4 text-white" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(img.id)}
                                                        className="p-2 bg-red-500/40 hover:bg-red-500/60 rounded-lg transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-4 h-4 text-white" />
                                                    </button>
                                                </div>
                                                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                                                    <p className="text-[9px] text-white/60 font-mono">
                                                        {new Date(img.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

type BulkFileEntry = {
    file: File;
    status: 'pending' | 'uploading' | 'success' | 'error';
    error?: string;
    type: 'psd' | 'png' | 'jpg' | 'other';
};

function getFileType(file: File): BulkFileEntry['type'] {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'psd') return 'psd';
    if (ext === 'png') return 'png';
    if (['jpg', 'jpeg', 'webp'].includes(ext)) return 'jpg';
    return 'other';
}

function FileBadge({ type }: { type: BulkFileEntry['type'] }) {
    const styles: Record<string, string> = {
        psd:   'bg-purple-600/20 text-purple-400 border-purple-500/30',
        png:   'bg-green-600/20 text-green-400 border-green-500/30',
        jpg:   'bg-blue-600/20 text-blue-400 border-blue-500/30',
        other: 'bg-slate-600/20 text-slate-400 border-slate-500/30',
    };
    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase tracking-wide ${styles[type] || styles.other}`}>
            {type.toUpperCase()}
        </span>
    );
}

function BulkUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [entries, setEntries] = useState<BulkFileEntry[]>([]);
    const [category, setCategory] = useState('tshirt');
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const BATCH_SIZE = 20;

    const addFiles = (fileList: FileList | null) => {
        if (!fileList) return;
        const allowed = ['jpg', 'jpeg', 'png', 'webp', 'psd'];
        const newEntries = Array.from(fileList)
            .filter(f => allowed.includes(f.name.split('.').pop()?.toLowerCase() || ''))
            .map(f => ({ file: f, status: 'pending' as const, type: getFileType(f) }));
        setEntries(prev => [...prev, ...newEntries]);
    };

    const removeEntry = (idx: number) =>
        setEntries(prev => prev.filter((_, i) => i !== idx));

    const startUpload = async () => {
        if (entries.length === 0 || isRunning) return;
        setIsRunning(true);

        const files = entries.map(e => e.file);
        let done = 0;
        setProgress({ done: 0, total: files.length });

        setEntries(prev => prev.map(e => ({ ...e, status: 'pending' })));

        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batchFiles = files.slice(i, i + BATCH_SIZE);
            const batchIndices = batchFiles.map((_, j) => i + j);

            setEntries(prev => prev.map((e, idx) =>
                batchIndices.includes(idx) ? { ...e, status: 'uploading' } : e
            ));

            try {
                const fd = new FormData();
                batchFiles.forEach(f => fd.append('images', f));
                fd.append('category', category);

                const res = await fetch(`${API_BASE}/api/mockups/templates/bulk-upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                });
                const data = await res.json();
                const batchResults: any[] = data.results || [];

                setEntries(prev => {
                    const next = [...prev];
                    batchIndices.forEach((origIdx, batchIdx) => {
                        const r = batchResults[batchIdx];
                        if (!r) { next[origIdx] = { ...next[origIdx], status: 'error', error: 'No result' }; return; }
                        next[origIdx] = {
                            ...next[origIdx],
                            status: r.status === 'success' ? 'success' : 'error',
                            error: r.error,
                        };
                    });
                    return next;
                });
            } catch (err: any) {
                setEntries(prev => prev.map((e, idx) =>
                    batchIndices.includes(idx) ? { ...e, status: 'error', error: err.message } : e
                ));
            }

            done += batchFiles.length;
            setProgress({ done, total: files.length });
        }

        setIsRunning(false);
        onSuccess();
    };

    const successCount = entries.filter(e => e.status === 'success').length;
    const errorCount = entries.filter(e => e.status === 'error').length;
    const isDone = !isRunning && entries.length > 0 && entries.every(e => e.status === 'success' || e.status === 'error');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-2xl p-6 space-y-5 shadow-2xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <PackageOpen className="w-5 h-5 text-purple-400" /> Toplu Mockup Aktarımı
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">PNG, JPG ve PSD desteklenir — PSD&apos;ler otomatik analiz edilir</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                {/* Category */}
                {!isRunning && !isDone && (
                    <div className="shrink-0">
                        <label className="text-xs text-slate-400 mb-1.5 block">Kategori (tüm dosyalar için)</label>
                        <select
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                        >
                            {CATEGORIES.filter(c => c !== 'all').map(c => (
                                <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Drop zone */}
                {!isRunning && !isDone && (
                    <div
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all shrink-0 ${
                            isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-slate-600 hover:border-slate-400'
                        }`}
                    >
                        <input ref={fileInputRef} type="file" multiple accept="image/*,.psd" className="hidden"
                            onChange={e => addFiles(e.target.files)} />
                        <Upload className="w-7 h-7 text-slate-500 mx-auto mb-2" />
                        <p className="text-sm text-slate-300">Dosyaları buraya sürükleyin veya seçin</p>
                        <p className="text-xs text-slate-500 mt-1">
                            <span className="text-purple-400">PSD</span> · <span className="text-green-400">PNG</span> · <span className="text-blue-400">JPG</span> — sınırsız dosya
                        </p>
                    </div>
                )}

                {/* Progress bar */}
                {isRunning && (
                    <div className="shrink-0 space-y-1.5">
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>İşleniyor...</span>
                            <span>{progress.done}/{progress.total}</span>
                        </div>
                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-300"
                                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Done summary */}
                {isDone && (
                    <div className="shrink-0 flex gap-3">
                        <div className="flex-1 bg-emerald-600/10 border border-emerald-500/30 rounded-xl p-3 text-center">
                            <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
                            <p className="text-xs text-emerald-300 mt-0.5">Başarılı</p>
                        </div>
                        {errorCount > 0 && (
                            <div className="flex-1 bg-red-600/10 border border-red-500/30 rounded-xl p-3 text-center">
                                <p className="text-2xl font-bold text-red-400">{errorCount}</p>
                                <p className="text-xs text-red-300 mt-0.5">Hatalı</p>
                            </div>
                        )}
                    </div>
                )}

                {/* File list */}
                {entries.length > 0 && (
                    <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span>{entries.length} dosya</span>
                            {!isRunning && !isDone && (
                                <button onClick={() => setEntries([])} className="hover:text-red-400 transition-colors">Temizle</button>
                            )}
                        </div>
                        {entries.map((entry, idx) => (
                            <div key={idx} className={cn(
                                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors',
                                entry.status === 'success' && 'bg-emerald-500/10',
                                entry.status === 'error' && 'bg-red-500/10',
                                entry.status === 'uploading' && 'bg-blue-500/10',
                                entry.status === 'pending' && 'bg-slate-800/60',
                            )}>
                                <FileBadge type={entry.type} />
                                <span className="flex-1 text-slate-300 truncate">{entry.file.name}</span>
                                <span className="text-slate-500 shrink-0">{(entry.file.size / 1024 / 1024).toFixed(1)}MB</span>
                                {entry.status === 'pending' && <span className="text-slate-500 shrink-0">bekliyor</span>}
                                {entry.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />}
                                {entry.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                                {entry.status === 'error' && (
                                    <span className="text-red-400 shrink-0 max-w-[140px] truncate" title={entry.error}>{entry.error}</span>
                                )}
                                {!isRunning && !isDone && (
                                    <button onClick={() => removeEntry(idx)} className="text-slate-600 hover:text-red-400 transition-colors shrink-0">
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 shrink-0 pt-1">
                    <button onClick={onClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-xl transition-colors">
                        {isDone ? 'Kapat' : 'İptal'}
                    </button>
                    {!isDone && (
                        <button
                            onClick={startUpload}
                            disabled={isRunning || entries.length === 0}
                            className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {isRunning
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor ({progress.done}/{progress.total})</>
                                : <><Upload className="w-4 h-4" /> {entries.length} Dosya Yükle</>
                            }
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
