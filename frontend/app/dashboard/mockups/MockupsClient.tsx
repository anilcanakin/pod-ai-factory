'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { apiMockups, MockupTemplate, MockupConfig, apiGallery, GalleryImage } from '@/lib/api';
import {
    Plus, Trash2, X, Image as ImageIcon, RotateCw, Layers,
    Eye, Download, Search, Loader2, Save, Grid3x3, CheckCircle2,
    AlertCircle, Package, ChevronDown, ChevronRight, Upload
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
    'tshirt', 'sweatshirt', 'hoodie',
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

    const { data: renderedMockups, refetch: refetchMockups } = useQuery({
        queryKey: ['rendered-mockups'],
        queryFn: async () => {
            const all = await apiGallery.getRecent();
            return all.filter((img: GalleryImage) => img.engine === 'mockup');
        },
        staleTime: 10000,
    });

    // Pre-select design from URL param (e.g. coming from Factory "Send to Mockup")
    const initialDesignUrl = searchParams.get('designUrl');
    const initialDesignImageId = searchParams.get('designImageId');

    // Bulk Render state
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
    const [bulkDesignUrl, setBulkDesignUrl] = useState<string | null>(null);
    const [bulkDesignImageId, setBulkDesignImageId] = useState<string | null>(null);
    const [bulkShowDesignPicker, setBulkShowDesignPicker] = useState(false);
    const [bulkRendering, setBulkRendering] = useState(false);
    const [bulkResults, setBulkResults] = useState<{ templateId: string; templateName: string; status: string; url?: string; error?: string }[]>([]);

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

    const handleBulkRender = async () => {
        if (!bulkDesignImageId || bulkSelectedIds.size === 0) return;
        setBulkRendering(true);
        setBulkResults([]);
        try {
            const result = await apiMockups.renderBatch(bulkDesignImageId, Array.from(bulkSelectedIds));
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
                        <button
                            onClick={() => setBulkSelectedIds(new Set())}
                            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            Clear selection
                        </button>
                    </div>

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
                                                        const url = resolveUrl(r.url);
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
                            onSelect={() => {
                                if (bulkMode) {
                                    setBulkSelectedIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                        return next;
                                    });
                                } else {
                                    setSelectedTemplate(t); setShowEditor(true);
                                }
                            }}
                            onDelete={() => handleDelete(t.id)}
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
                    initialDesignUrl={initialDesignUrl}
                    initialDesignImageId={initialDesignImageId}
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
function TemplateCard({ template, onSelect, onDelete, bulkMode, isSelected }: {
    template: MockupTemplate; onSelect: () => void; onDelete: () => void;
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
                {bulkMode ? (
                    <div className={cn(
                        'absolute inset-0 flex items-center justify-center transition-colors',
                        isSelected ? 'bg-purple-600/20' : 'bg-transparent hover:bg-purple-600/10'
                    )}>
                        <div className={cn(
                            'w-6 h-6 rounded-md border-2 flex items-center justify-center',
                            isSelected ? 'bg-purple-600 border-purple-500' : 'bg-transparent border-slate-400'
                        )}>
                            {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-4">
                        <span className="px-4 py-1.5 bg-blue-600 text-white text-xs rounded-full font-medium shadow-lg">Open Editor</span>
                    </div>
                )}
            </div>
            <div className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{template.name}</p>
                    <span className="inline-flex items-center mt-1 px-1.5 py-0.5 bg-slate-700 text-slate-400 text-[10px] rounded capitalize">
                        {template.category.replace('_', ' ')}
                    </span>
                </div>
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    className="p-1.5 text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-300 transition-all"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
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

// ─── Template Editor with Konva Canvas ───────────────────────────────────────
function TemplateEditor({ template, onClose, onUpdated, addToast, initialDesignUrl, initialDesignImageId }: {
    template: MockupTemplate;
    onClose: () => void;
    onUpdated: (t: MockupTemplate) => void;
    addToast: (type: ToastType, msg: string) => void;
    initialDesignUrl?: string | null;
    initialDesignImageId?: string | null;
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

    const [designScale, setDesignScale] = useState(1);
    const [designOffsetX, setDesignOffsetX] = useState(0);
    const [designOffsetY, setDesignOffsetY] = useState(0);
    const [designRotation, setDesignRotation] = useState(0);

    // Design
    const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl ?? null);
    const [designImageId, setDesignImageId] = useState<string | null>(initialDesignImageId ?? null);
    const [showDesignPicker, setShowDesignPicker] = useState(false);

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
    const [activeAreaId, setActiveAreaId] = useState<string | null>(null);

    // Per-area designs
    const [areaDesigns, setAreaDesigns] = useState<Record<string, { imageId: string; imageUrl: string }>>({});
    const [pickingDesignForAreaId, setPickingDesignForAreaId] = useState<string | null>(null);
    const areaDesignImgsRef = useRef<Record<string, HTMLImageElement>>({});

    // Dark/Light variant toggle
    const [useDark, setUseDark] = useState(false);

    // Canvas state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const baseImgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
    const designImgRef = useRef<HTMLImageElement | null>(null);
    const [baseLoaded, setBaseLoaded] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 800 });

    // Drag state (primary print area)
    const [dragging, setDragging] = useState<'move' | 'resize' | null>(null);
    const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0, pw: 0, ph: 0 });

    // Drag state (additional print areas)
    const [draggingAreaId, setDraggingAreaId] = useState<string | null>(null);
    const [resizingAreaId, setResizingAreaId] = useState<string | null>(null);
    const dragAreaStart = useRef({ mx: 0, my: 0, ax: 0, ay: 0, aw: 0, ah: 0 });

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

    // Load design image
    useEffect(() => {
        if (!designUrl) { designImgRef.current = null; return; }
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = designUrl.startsWith('http') ? designUrl : `${API_BASE}/${designUrl}`;
        img.onload = () => { designImgRef.current = img; };
    }, [designUrl]);

    // Sync printAreas from template config when template changes
    useEffect(() => {
        if (template.configJson?.printAreas) {
            setPrintAreas(template.configJson.printAreas);
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
        const paX = printArea.x * canvas.width;
        const paY = printArea.y * canvas.height;
        const paW = printArea.width * canvas.width;
        const paH = printArea.height * canvas.height;

        // Design
        if (designImgRef.current) {
            ctx.save();
            ctx.globalAlpha = opacity;
            if (blendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';

            const designImg = designImgRef.current;
            
            // Scale design to fit print area, then apply user scale
            const baseScale = Math.min(paW / designImg.width, paH / designImg.height);
            const finalScale = baseScale * designScale;
            const designW = designImg.width * finalScale;
            const designH = designImg.height * finalScale;

            // Center within print area + apply offsets
            const designX = paX + (paW - designW) / 2 + (designOffsetX / 100 * paW);
            const designY = paY + (paH - designH) / 2 + (designOffsetY / 100 * paH);

            // Draw with rotation
            ctx.translate(designX + designW / 2, designY + designH / 2);
            ctx.rotate((designRotation * Math.PI) / 180);
            ctx.drawImage(designImg, -designW / 2, -designH / 2, designW, designH);
            
            ctx.restore();
        }

        // Print region border
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
        ctx.lineWidth = Math.max(2, canvas.width * 0.003);
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(paX, paY, paW, paH);
        ctx.setLineDash([]);

        // Corner handles
        const hs = Math.max(10, canvas.width * 0.015);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(paX + paW - hs, paY + paH - hs, hs, hs); // bottom-right

        // Center label
        const labelCx = paX + paW / 2;
        const labelCy = paY + paH / 2;
        ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.font = `${Math.max(12, canvas.width * 0.015)}px sans-serif`;
        ctx.textAlign = 'center';
        if (!designImgRef.current) {
            ctx.fillText('Print Area', labelCx, labelCy);
        }

        // Additional print areas
        if (printAreas.length > 0) {
            const areaColors = ['rgba(59,130,246,0.25)', 'rgba(234,179,8,0.25)', 'rgba(34,197,94,0.25)', 'rgba(239,68,68,0.25)'];
            const canvasW = canvas.width;
            const canvasH = canvas.height;

            // Draw per-area design previews first (below borders)
            printAreas.forEach(area => {
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
    }, [printArea, printAreas, activeAreaId, areaDesigns, opacity, blendMode, rotation, baseLoaded, canvasSize, designUrl, designScale, designOffsetX, designOffsetY, designRotation]);

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
        setSavingToGallery(true);
        try {
            await apiGallery.saveMockup(renderResult, designImageId ?? undefined);
            addToast('success', 'Saved to gallery!');
        } catch (err: any) {
            addToast('error', err.message);
        } finally {
            setSavingToGallery(false);
        }
    };

    const handleRender = async () => {
        if (!designImageId || !template) return;
        setRendering(true);
        try {
            // Save config first — always include printAreas so multi-area mode is preserved in DB
            const configPayload = {
                printArea,
                printAreas,          // always send — empty array clears, non-empty sets multi-area
                transform: { rotation, opacity, blendMode },
            };
            console.log('[handleRender] Saving configPayload:', JSON.stringify(configPayload));
            await apiMockups.updateTemplate(template.id, { configJson: configPayload });
            
            const renderPayload = {
                scale: designScale,
                offsetX: designOffsetX / 100,
                offsetY: designOffsetY / 100,
                rotation: designRotation,
                blendMode,
            };
            const hasAreaDesigns = Object.keys(areaDesigns).length > 0;

            const result = await apiMockups.render(
                designImageId,
                template.id,
                renderPayload,
                hasAreaDesigns ? areaDesigns : undefined
            );
            const renderedUrl = resolveUrl(result.mockupUrl);
            setRenderResult(renderedUrl);
            // Auto-save to gallery
            try {
                await apiGallery.saveMockup(renderedUrl, designImageId ?? undefined);
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
                                </div>
                            </section>

                            {/* Design Picker */}
                            <section>
                                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Apply Design</h3>
                                {!designUrl ? (
                                    <button onClick={() => setShowDesignPicker(true)}
                                        className="w-full px-3 py-3 bg-slate-800/50 border-2 border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:border-blue-500/50 hover:text-blue-400 transition-all flex flex-col items-center gap-1.5">
                                        <Search className="w-5 h-5" />
                                        Select an approved design
                                    </button>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="p-2 bg-slate-800/50 border border-slate-600/50 rounded-xl">
                                            <img src={designUrl.startsWith('http') ? designUrl : `${API_BASE}/${designUrl}`}
                                                alt="Design" className="w-full h-24 object-contain rounded-lg" />
                                        </div>
                                        <button onClick={() => setShowDesignPicker(true)}
                                            className="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors">
                                            Change design
                                        </button>
                                    </div>
                                )}
                            </section>

                            {/* Design Transform Controls */}
                            {designImageId && (
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
                            <button onClick={handleRender} disabled={rendering || !designImageId}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20">
                                {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                                {rendering ? 'Rendering...' : 'Place Design & Render'}
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
                        setDesignUrl(img.imageUrl);
                        setDesignImageId(img.id);
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
                            [pickingDesignForAreaId]: { imageId: img.id, imageUrl: img.imageUrl }
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
                    <h3 className="text-lg font-semibold text-white">Select a Design</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
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

    return (
        <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-purple-400" />
                Rendered Mockups ({renderedMockups.length})
            </h2>
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
                                        return (
                                            <div key={img.id} className="group relative aspect-square bg-slate-900/50 border border-slate-700 rounded-xl overflow-hidden hover:border-purple-500/50 transition-all">
                                                <img
                                                    src={url}
                                                    alt="Mockup"
                                                    className="w-full h-full object-cover"
                                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                                />
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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

function BulkUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const [files, setFiles] = useState<File[]>([]);
    const [category, setCategory] = useState('tshirt');
    const [uploading, setUploading] = useState(false);
    const [results, setResults] = useState<any[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = (newFiles: FileList | null) => {
        if (!newFiles) return;
        const imageFiles = Array.from(newFiles).filter(f => f.type.startsWith('image/'));
        setFiles(prev => [...prev, ...imageFiles].slice(0, 20));
    };

    const handleUpload = async () => {
        if (files.length === 0) return;
        setUploading(true);
        try {
            const formData = new FormData();
            files.forEach(f => formData.append('images', f));
            formData.append('category', category);

            const res = await fetch('/api/mockups/templates/bulk-upload', {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await res.json();
            setResults(data.results || []);
            onSuccess();
        } catch (err: any) {
            alert('Upload failed: ' + err.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-2xl p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Bulk Upload Templates</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Upload up to 20 templates — AI will auto-detect print areas</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                {/* Category */}
                <div>
                    <label className="text-xs text-slate-400 mb-1.5 block">Category</label>
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

                {/* Drop zone */}
                <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                        isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 hover:border-slate-400'
                    }`}
                >
                    <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
                        onChange={e => handleFiles(e.target.files)} />
                    <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                    <p className="text-sm text-slate-300">Drop images here or click to browse</p>
                    <p className="text-xs text-slate-500 mt-1">JPG, PNG, WEBP — max 20 files</p>
                </div>

                {/* File list */}
                {files.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-400">{files.length} file{files.length > 1 ? 's' : ''} selected</p>
                            <button onClick={() => setFiles([])} className="text-xs text-slate-500 hover:text-red-400">Clear all</button>
                        </div>
                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                            {files.map((f, i) => (
                                <div key={i} className="relative group aspect-square bg-slate-800 rounded-lg overflow-hidden">
                                    <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                        className="absolute top-1 right-1 p-0.5 bg-black/60 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="w-3 h-3 text-white" />
                                    </button>
                                    <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/60">
                                        <p className="text-[8px] text-white truncate">{f.name}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Results */}
                {results.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-300">
                            ✅ {results.filter(r => r.status === 'success').length} uploaded successfully
                        </p>
                        {results.map((r, i) => (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                                r.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                                {r.status === 'success' ? '✓' : '✗'} {r.name}
                                {r.status === 'success' && (
                                    <span className="text-slate-400 ml-auto">
                                        Print area: {Math.round(r.printArea.x * 100)}%, {Math.round(r.printArea.y * 100)}% 
                                        ({Math.round(r.confidence)}% confidence)
                                    </span>
                                )}
                                {r.status === 'error' && <span className="ml-auto">{r.error}</span>}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-3 pt-2">
                    <button onClick={onClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-xl transition-colors">
                        {results.length > 0 ? 'Close' : 'Cancel'}
                    </button>
                    {results.length === 0 && (
                        <button
                            onClick={handleUpload}
                            disabled={uploading || files.length === 0}
                            className="flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            {uploading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Uploading & detecting...</>
                            ) : (
                                <><Upload className="w-4 h-4" /> Upload {files.length} Template{files.length > 1 ? 's' : ''}</>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
