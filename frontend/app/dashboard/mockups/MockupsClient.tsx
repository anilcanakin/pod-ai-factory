'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiMockups, MockupTemplate, MockupConfig, apiGallery, apiJobs, GalleryImage, JobSummary } from '@/lib/api';
import {
    Plus, Trash2, X, Image as ImageIcon, RotateCw, Layers,
    Eye, Download, Search, Loader2, Save, Grid3x3, CheckCircle2,
    AlertCircle, Package
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
const CATEGORIES = ['all', 'tshirt', 'sweatshirt', 'hoodie', 'mug', 'sticker', 'phone_case'];

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
    const [selectedTemplate, setSelectedTemplate] = useState<MockupTemplate | null>(null);
    const [showEditor, setShowEditor] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { toasts, addToast } = useToast();

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
            addToast('success', `Rendered ${successCount} of ${result.results.length} mockups`);
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
                        id="upload-template-btn"
                        onClick={() => setShowUpload(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-blue-600/20"
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
                            {cat === 'all' ? '🎯 All' : cat.replace('_', ' ')}
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
                                            <img src={`${API_BASE}/${r.url}`} alt={r.templateName} className="w-full aspect-square object-contain" />
                                            <div className="p-2 flex items-center justify-between">
                                                <p className="text-[10px] text-slate-400 truncate">{r.templateName}</p>
                                                <button
                                                    onClick={async () => {
                                                        const url = `${API_BASE}/${r.url}`;
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
                            className="mt-6 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
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

            {showUpload && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-semibold text-white">Upload Mockup Template</h2>
                            <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
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
        transform: { rotation: 0, opacity: 1, blendMode: 'normal' },
        render: { renderMode: 'flat', displacementMapPath: null, perspective: null },
        meta: { view: 'front', background: 'studio', color: 'white', hasHumanModel: false },
    };
    const transform = config.transform || { rotation: 0, opacity: 1, blendMode: 'normal' };
    const [printArea, setPrintArea] = useState(config.printArea);
    const [opacity, setOpacity] = useState(transform.opacity);
    const [blendMode, setBlendMode] = useState(transform.blendMode);
    const [rotation, setRotation] = useState(transform.rotation);

    // Design
    const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl ?? null);
    const [designImageId, setDesignImageId] = useState<string | null>(initialDesignImageId ?? null);
    const [showDesignPicker, setShowDesignPicker] = useState(false);
    const [showPlacementEditor, setShowPlacementEditor] = useState(false);

    // Rendering
    const [rendering, setRendering] = useState(false);
    const [batchRendering, setBatchRendering] = useState(false);
    const [renderResult, setRenderResult] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savingToGallery, setSavingToGallery] = useState(false);

    // Dark/Light variant toggle
    const [useDark, setUseDark] = useState(false);

    // Canvas state
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const baseImgRef = useRef<HTMLImageElement | null>(null);
    const designImgRef = useRef<HTMLImageElement | null>(null);
    const [baseLoaded, setBaseLoaded] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 800 });

    // Drag state
    const [dragging, setDragging] = useState<'move' | 'resize' | null>(null);
    const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0, pw: 0, ph: 0 });

    // Load base image (switches when dark/light toggled)
    const activePath = useDark && template.darkImagePath ? template.darkImagePath : template.baseImagePath;
    useEffect(() => {
        setBaseLoaded(false);
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = resolveUrl(activePath);
        img.onload = () => {
            baseImgRef.current = img;
            setBaseLoaded(true);
            setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
        };
    }, [activePath]);

    // Load design image
    useEffect(() => {
        if (!designUrl) { designImgRef.current = null; return; }
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = designUrl.startsWith('http') ? designUrl : `${API_BASE}/${designUrl}`;
        img.onload = () => { designImgRef.current = img; };
    }, [designUrl]);

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

            const cx = paX + paW / 2;
            const cy = paY + paH / 2;

            if (rotation !== 0) {
                ctx.translate(cx, cy);
                ctx.rotate((rotation * Math.PI) / 180);
                ctx.drawImage(designImgRef.current, -paW / 2, -paH / 2, paW, paH);
            } else {
                ctx.drawImage(designImgRef.current, paX, paY, paW, paH);
            }
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

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [printArea, opacity, blendMode, rotation, baseLoaded, canvasSize, designUrl]);

    useEffect(() => { draw(); }, [draw]);

    // Interval for smooth design preview
    useEffect(() => {
        if (!designImgRef.current) return;
        const id = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(id);
    }, [draw, designUrl]);

    // Mouse handlers
    const getCoords = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    };

    const onMouseDown = (e: React.MouseEvent) => {
        const { x, y } = getCoords(e);
        const hs = 0.03;
        // Resize handle
        if (x >= printArea.x + printArea.width - hs && x <= printArea.x + printArea.width + hs &&
            y >= printArea.y + printArea.height - hs && y <= printArea.y + printArea.height + hs) {
            setDragging('resize');
            dragStart.current = { mx: x, my: y, px: printArea.x, py: printArea.y, pw: printArea.width, ph: printArea.height };
            return;
        }
        // Move
        if (x >= printArea.x && x <= printArea.x + printArea.width && y >= printArea.y && y <= printArea.y + printArea.height) {
            setDragging('move');
            dragStart.current = { mx: x, my: y, px: printArea.x, py: printArea.y, pw: printArea.width, ph: printArea.height };
        }
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragging) return;
        const { x, y } = getCoords(e);
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
    };

    const onMouseUp = () => setDragging(null);

    // Actions
    const saveConfig = async () => {
        setSaving(true);
        try {
            const updated = await apiMockups.updateTemplate(template.id, {
                configJson: {
                    printArea,
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
            await apiGallery.saveMockup(renderResult);
            addToast('success', 'Saved to gallery!');
        } catch (err: any) {
            addToast('error', err.message);
        } finally {
            setSavingToGallery(false);
        }
    };

    const handlePlacementSave = async (placement: { scale: number; offsetX: number; offsetY: number; rotation: number }) => {
        if (!designImageId || !template) return;
        setShowPlacementEditor(false);
        setRendering(true);
        try {
            // Save config first (Standard v1 shape)
            await apiMockups.updateTemplate(template.id, { configJson: { printArea, transform: { rotation, opacity, blendMode } } });
            const result = await apiMockups.render(designImageId, template.id, placement);
            setRenderResult(`${API_BASE}/${result.mockupUrl}`);
            addToast('success', 'Mockup rendered!');
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
                                <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Print Area</h3>
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
                                            <option value="normal">Normal</option>
                                            <option value="multiply">Multiply</option>
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
                        </div>

                        {/* Action Buttons */}
                        <div className="p-4 border-t border-slate-700/60 space-y-2">
                            <button onClick={() => setShowPlacementEditor(true)} disabled={rendering || !designImageId}
                                className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20">
                                {rendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                                {rendering ? 'Rendering...' : 'Place Design & Render'}
                            </button>
                            {renderResult && (
                                <div className="p-3 bg-emerald-600/10 border border-emerald-500/30 rounded-xl space-y-2">
                                    <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Mockup rendered!
                                    </p>
                                    <img src={renderResult} alt="Rendered" className="w-full rounded-lg shadow" />
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={async () => {
                                                const slug = template.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                                                const filename = `mockup-${slug}-${Date.now()}.png`;
                                                try {
                                                    const r = await fetch(renderResult!);
                                                    const blob = await r.blob();
                                                    const url = URL.createObjectURL(blob);
                                                    const a = document.createElement('a');
                                                    a.href = url; a.download = filename; a.click();
                                                    URL.revokeObjectURL(url);
                                                } catch { window.open(renderResult!, '_blank'); }
                                            }}
                                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                                        >
                                            <Download className="w-3 h-3" /> Download
                                        </button>
                                        <button
                                            onClick={handleSaveToGallery}
                                            disabled={savingToGallery}
                                            className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium transition-colors disabled:opacity-40"
                                        >
                                            {savingToGallery ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                            {savingToGallery ? 'Saving…' : 'Save to Gallery'}
                                        </button>
                                    </div>
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

            {showPlacementEditor && template && designUrl && (
                <DesignPlacementEditor
                    template={template}
                    designUrl={designUrl}
                    onSave={handlePlacementSave}
                    onCancel={() => setShowPlacementEditor(false)}
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
    const [jobs, setJobs] = useState<JobSummary[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [selectedJobId, setSelectedJobId] = useState('');
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loadingImages, setLoadingImages] = useState(false);

    useEffect(() => {
        apiJobs.list()
            .then(setJobs)
            .catch(() => {})
            .finally(() => setLoadingJobs(false));
    }, []);

    const loadJob = async (jobId: string) => {
        setSelectedJobId(jobId);
        setLoadingImages(true);
        try {
            const imgs = await apiGallery.getImages(jobId);
            setImages(imgs.filter(i => i.isApproved || i.status === 'PROCESSED' || i.status === 'COMPLETED'));
        } catch (err: any) {
            setImages([]);
        } finally {
            setLoadingImages(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
            <div className="bg-[#1a2332] border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
                    <h3 className="text-lg font-semibold text-white">Select a Design</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Job list sidebar */}
                    <div className="w-52 border-r border-slate-700 overflow-y-auto p-2 space-y-1 shrink-0">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-2 pb-1">Job History</p>
                        {loadingJobs ? (
                            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
                        ) : jobs.length === 0 ? (
                            <p className="text-center text-slate-500 text-xs py-8">No jobs yet</p>
                        ) : (
                            jobs.map(job => (
                                <button
                                    key={job.id}
                                    onClick={() => loadJob(job.id)}
                                    className={cn(
                                        'w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors border',
                                        selectedJobId === job.id
                                            ? 'bg-blue-600/20 border-blue-500/40'
                                            : 'border-transparent hover:bg-slate-800'
                                    )}
                                >
                                    {job.previewUrl ? (
                                        <img src={job.previewUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0 border border-slate-600" />
                                    ) : (
                                        <div className="w-9 h-9 rounded bg-slate-700 flex items-center justify-center shrink-0">
                                            <ImageIcon className="w-4 h-4 text-slate-500" />
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className={cn('text-[11px] font-mono truncate', selectedJobId === job.id ? 'text-blue-300' : 'text-slate-300')}>
                                            {job.id.slice(0, 8)}…
                                        </p>
                                        <p className="text-[10px] text-slate-500">{job.imageCount} imgs</p>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    {/* Images panel */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {!selectedJobId ? (
                            <p className="text-center text-slate-500 py-16 text-sm">← Select a job to browse approved designs</p>
                        ) : loadingImages ? (
                            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
                        ) : images.length === 0 ? (
                            <div className="text-center py-16">
                                <AlertCircle className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-400 font-medium">No approved designs found</p>
                                <p className="text-slate-500 text-sm mt-1">Approve a design first in Gallery</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-3">
                                {images.map(img => (
                                    <button key={img.id} onClick={() => onSelect(img)}
                                        className="relative aspect-square bg-slate-900/60 rounded-xl overflow-hidden border-2 border-transparent hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-600/10">
                                        <img src={img.imageUrl.startsWith('http') ? img.imageUrl : `${API_BASE}/${img.imageUrl}`}
                                            alt="Design" className="w-full h-full object-contain p-2" />
                                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
                                            <span className="text-[10px] text-slate-300 font-medium">{img.status} • {img.engine}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
