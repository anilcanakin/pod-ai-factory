'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGallery, apiPipeline, apiExport, apiJobs, apiTools, apiSeo, apiEtsy, type GalleryImage } from '@/lib/api';
import { toast } from 'sonner';
import { cn, truncateId } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
    CheckCircle, CheckCircle2, XCircle, RefreshCw, Loader2,
    Download, Play, Maximize2, Copy, Image as ImageIcon, Images, Info,
    History, Scissors, ZoomIn, Store, Trash2, Zap,
    Check, X, Layers, Tag, Clock, ChevronUp, ChevronDown
} from 'lucide-react';

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

export function GalleryClient() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 text-text-tertiary animate-spin" />
            </div>
        }>
            <GalleryInner />
        </Suspense>
    );
}

function GalleryInner() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const activeJobId = searchParams.get('jobId') || '';
    const allImagesMode = activeJobId === '__all__';

    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
    const [viewImg, setViewImg] = useState<GalleryImage | null>(null);
    const [bulkConfirm, setBulkConfirm] = useState<null | 'reject' | 'pipeline'>(null);
    const [filter, setFilter] = useState<'all' | 'PENDING' | 'COMPLETED' | 'APPROVED' | 'REJECTED'>('all');
    
    const [processingImage, setProcessingImage] = useState<string | null>(null);
    const [bgModel, setBgModel] = useState<'birefnet' | 'bria'>('birefnet');
    const [publishingImage, setPublishingImage] = useState<string | null>(null);
    const [listingPrice, setListingPrice] = useState('19.99');
    const [showHistory, setShowHistory] = useState(false);
    const historyRef = useRef<HTMLDivElement>(null);
    const [pipelineImage, setPipelineImage] = useState<GalleryImage | null>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
                setShowHistory(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const setActiveJobId = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (id) params.set('jobId', id);
        else params.delete('jobId');
        router.push(`${pathname}?${params.toString()}`);
        setSelected(new Set()); // Clear selection when changing jobs
    };

    // Fetch Job History
    const { data: jobs = [], isLoading: isJobsLoading } = useQuery({
        queryKey: ['jobs-list'],
        queryFn: apiJobs.list,
        refetchInterval: 10000,
    });

    // Fetch images for active job (or all recent images)
    const { data: images = [], isLoading } = useQuery({
        queryKey: ['gallery', activeJobId],
        queryFn: () => allImagesMode ? apiGallery.getRecent() : apiGallery.getImages(activeJobId),
        enabled: !!activeJobId,
        refetchInterval: activeJobId && !allImagesMode ? 5000 : false,
    });

    const approveMutation = useMutation({
        mutationFn: apiGallery.approve,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
            toast.success('Image approved');
        },
        onError: () => toast.error('Approve failed'),
    });

    const rejectMutation = useMutation({
        mutationFn: apiGallery.reject,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
            toast.success('Image rejected');
        },
        onError: () => toast.error('Reject failed'),
    });

    const pipelineMutation = useMutation({
        mutationFn: apiPipeline.run,
        onSuccess: () => toast.success('Pipeline started for image'),
        onError: () => toast.error('Pipeline failed'),
    });

    const handleRemoveBg = async (imgId: string, imgUrl: string, model: 'birefnet' | 'bria') => {
        setProcessingImage(imgId);
        try {
            const result = await apiTools.removeBg(imgUrl, model);
            // Yeni tab'da aç — kullanıcı indirsin
            window.open(result.url, '_blank');
            toast.success(`Background removed with ${result.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'BG removal failed');
        } finally {
            setProcessingImage(null);
        }
    };

    const handlePublishToEtsy = async (imgId: string) => {
        setPublishingImage(imgId);
        const toastId = toast.loading('Assembling assets and preparing Etsy draft...');
        try {
            const result = await apiEtsy.dispatch(imgId);
            if (result.success) {
                toast.success('Successfully created draft on Etsy!', { id: toastId });
            } else {
                throw new Error(result.message);
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Publish failed', { id: toastId });
        } finally {
            setPublishingImage(null);
        }
    };

    const handleUpscale = async (imgId: string, imgUrl: string, scale: 2 | 4) => {
        setProcessingImage(imgId);
        try {
            const result = await apiTools.upscale(imgUrl, scale);
            window.open(result.url, '_blank');
            toast.success(`Upscaled ${result.scale} with ${result.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Upscale failed');
        } finally {
            setProcessingImage(null);
        }
    };

    const filtered = images.filter(img => filter === 'all' || img.status === filter);

    // Keyboard shortcuts
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement).tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;

        // Fullscreen mode
        if (viewImg) {
            const idx = filtered.findIndex(i => i.id === viewImg.id);
            if (e.key === 'ArrowRight' && idx > -1 && idx < filtered.length - 1) {
                setViewImg(filtered[idx + 1]);
            } else if (e.key === 'ArrowLeft' && idx > 0) {
                setViewImg(filtered[idx - 1]);
            } else if (e.key === 'a' || e.key === 'A') {
                approveMutation.mutate(viewImg.id);
                if (idx > -1 && idx < filtered.length - 1) setViewImg(filtered[idx + 1]); else setViewImg(null);
            } else if (e.key === 'r' || e.key === 'R') {
                rejectMutation.mutate(viewImg.id);
                if (idx > -1 && idx < filtered.length - 1) setViewImg(filtered[idx + 1]); else setViewImg(null);
            } else if (e.key === 'Escape') {
                setViewImg(null);
            }
            return;
        }

        // Bulk mode
        if (e.key === 'a' || e.key === 'A') {
            if (selected.size > 0) {
                selected.forEach(id => approveMutation.mutate(id));
                setSelected(new Set());
                setLastSelectedIdx(null);
            }
        } else if ((e.key === 'r' || e.key === 'R') && selected.size > 0) {
            setBulkConfirm('reject');
        } else if (e.key === 'Escape') {
            setSelected(new Set());
            setLastSelectedIdx(null);
        }
    }, [selected, viewImg, filtered, approveMutation, rejectMutation]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handleSelect = (idx: number, e: React.MouseEvent) => {
        const id = filtered[idx].id;
        setSelected(prev => {
            const n = new Set(prev);
            if (e.shiftKey && lastSelectedIdx !== null) {
                const start = Math.min(lastSelectedIdx, idx);
                const end = Math.max(lastSelectedIdx, idx);
                for (let i = start; i <= end; i++) n.add(filtered[i].id);
            } else {
                n.has(id) ? n.delete(id) : n.add(id);
                setLastSelectedIdx(idx);
            }
            return n;
        });
    };

    const selectAll = () => setSelected(new Set(filtered.map(i => i.id)));
    const clearSelect = () => { setSelected(new Set()); setLastSelectedIdx(null); };

    const bulkApprove = async () => {
        const ids = Array.from(selected);
        let done = 0;
        for (const id of ids) {
            try {
                await apiGallery.approve(id);
                done++;
                toast.loading(`Approving ${done} of ${ids.length}…`, { id: 'bulk-approve' });
            } catch { }
        }
        toast.dismiss('bulk-approve');
        queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
        toast.success(`Approved ${done} images`);
        clearSelect();
    };

    const bulkReject = async () => {
        for (const id of selected) { try { await apiGallery.reject(id); } catch { } }
        queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
        toast.success(`Rejected ${selected.size} images`);
        clearSelect();
        setBulkConfirm(null);
    };

    const runPipelineForApproved = async () => {
        const approvedIds = images.filter(img => img.isApproved || img.status === 'APPROVED').map(img => img.id);
        if (approvedIds.length === 0) { toast.warning('No approved images'); setBulkConfirm(null); return; }
        let success = 0;
        for (const id of approvedIds) { try { await apiPipeline.run(id); success++; } catch { } }
        toast.success(`Pipeline started for ${success}/${approvedIds.length} approved images`);
        setBulkConfirm(null);
    };

    const bulkPublishToEtsy = async () => {
        const ids = Array.from(selected);
        if (ids.length === 0) { toast.error('No images selected'); return; }

        let done = 0;
        for (const id of ids) {
            setPublishingImage(id);
            const toastId = `publish-${id}`;
            toast.loading(`Publishing ${done + 1}/${ids.length}…`, { id: toastId });
            try {
                const result = await apiEtsy.dispatch(id);
                if (result.success) {
                    done++;
                    toast.dismiss(toastId);
                } else {
                    toast.error(`Failed ${id}: ${result.message}`, { id: toastId });
                }
            } catch (err: unknown) {
                toast.error(err instanceof Error ? err.message : 'Publish failed', { id: toastId });
            }
        }
        setPublishingImage(null);
        toast.success(`Dispatched ${done} items to your Etsy Drafts.`);
        clearSelect();
    };

    const handleDelete = async (imageId: string) => {
        if (!confirm('Delete this image permanently?')) return;
        try {
            await fetch(`/api/gallery/${imageId}`, { method: 'DELETE', credentials: 'include' });
            queryClient.setQueryData(['gallery', activeJobId], (old: GalleryImage[] | undefined) =>
                old ? old.filter(i => i.id !== imageId) : []
            );
            toast.success('Image deleted');
        } catch {
            toast.error('Failed to delete');
        }
    };

    const bulkDelete = async () => {
        if (!confirm(`Delete ${selected.size} images?`)) return;
        const ids = Array.from(selected);
        for (const id of ids) {
            await fetch(`/api/gallery/${id}`, { method: 'DELETE', credentials: 'include' });
        }
        queryClient.setQueryData(['gallery', activeJobId], (old: GalleryImage[] | undefined) =>
            old ? old.filter(i => !ids.includes(i.id)) : []
        );
        clearSelect();
        toast.success(`Deleted ${ids.length} images`);
    };

    const approvedCount = images.filter(i => i.isApproved || i.status === 'APPROVED').length;
    const FILTERS = ['all', 'PENDING', 'COMPLETED', 'APPROVED', 'REJECTED'] as const;

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in gap-4">

            {/* Top Bar: History Dropdown + Active Job Info + Shortcuts */}
            <div className="flex items-center gap-3">
                {/* History Dropdown */}
                <div ref={historyRef} className="relative">
                    <button
                        onClick={() => setShowHistory(v => !v)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-[8px] border text-sm font-medium transition-all",
                            showHistory
                                ? "bg-accent-subtle border-accent text-accent"
                                : "bg-bg-surface border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong"
                        )}
                    >
                        <History className="w-4 h-4" />
                        History
                        <span className="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] font-medium rounded-full">{jobs.length}</span>
                        {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {showHistory && (
                        <div className="absolute top-full left-0 z-30 w-80 mt-1 bg-bg-surface border border-border-default rounded-[12px] shadow-lg overflow-hidden">
                            <div className="p-2 max-h-96 overflow-y-auto custom-scrollbar space-y-1">
                                <button
                                    onClick={() => { setActiveJobId('__all__'); setShowHistory(false); }}
                                    className={cn(
                                        "w-full flex items-center gap-3 p-2.5 rounded-[8px] transition-all text-left border mb-2",
                                        activeJobId === '__all__'
                                            ? "bg-accent-subtle border-accent"
                                            : "hover:bg-bg-elevated border-transparent"
                                    )}
                                >
                                    <div className="w-8 h-8 rounded-[6px] bg-bg-elevated flex items-center justify-center border border-border-subtle shrink-0">
                                        <Images className="w-3.5 h-3.5 text-text-tertiary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className={cn("text-[11px] font-semibold", activeJobId === '__all__' ? "text-accent" : "text-text-primary")}>All Images</div>
                                        <div className="text-[10px] text-text-tertiary">Recent across all jobs</div>
                                    </div>
                                </button>
                                <div className="border-t border-border-subtle mb-2" />
                                {isJobsLoading ? (
                                    <div className="space-y-2 p-1">
                                        {[...Array(3)].map((_, i) => (
                                            <div key={i} className="w-full flex items-center gap-3 p-2.5 rounded-[8px] border border-border-subtle">
                                                <div className="w-8 h-8 rounded-full skeleton-shimmer bg-bg-elevated shrink-0" />
                                                <div className="flex-1 space-y-1">
                                                    <div className="h-2.5 w-1/2 rounded bg-bg-elevated skeleton-shimmer" />
                                                    <div className="h-2 w-1/3 rounded bg-bg-elevated skeleton-shimmer" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : jobs.length === 0 ? (
                                    <div className="text-center py-6 text-xs text-text-tertiary">No jobs yet</div>
                                ) : (
                                    jobs.map(job => (
                                        <button
                                            key={job.id}
                                            onClick={() => { setActiveJobId(job.id); setShowHistory(false); }}
                                            className={cn(
                                                "w-full flex items-center gap-3 p-2.5 rounded-[8px] transition-all text-left border",
                                                activeJobId === job.id
                                                    ? "bg-accent-subtle border-accent"
                                                    : "hover:bg-bg-elevated border-transparent"
                                            )}
                                        >
                                            {job.previewUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={job.previewUrl} alt="Preview" className="w-8 h-8 rounded-[6px] object-cover bg-bg-elevated shrink-0 border border-border-subtle" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-[6px] bg-bg-elevated flex items-center justify-center border border-border-subtle shrink-0">
                                                    <ImageIcon className="w-3.5 h-3.5 text-text-tertiary opacity-40" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0 pr-1">
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <span className={cn("text-[10px] font-mono font-medium truncate", activeJobId === job.id ? "text-accent" : "text-text-primary")}>
                                                        {truncateId(job.id)}
                                                    </span>
                                                    <div className="flex items-center transform scale-75 origin-right">
                                                        <StatusBadge status={job.status} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center text-[10px] text-text-tertiary">
                                                    <span>{timeAgo(job.createdAt)}</span>
                                                    <span>{job.imageCount} img</span>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Active job title */}
                {activeJobId && (
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
                            {allImagesMode ? (
                                <span className="text-accent bg-accent/10 px-2 py-0.5 rounded text-sm">All Images</span>
                            ) : (
                                <span className="font-mono text-accent bg-accent/10 px-2 py-0.5 rounded text-sm">{truncateId(activeJobId)}</span>
                            )}
                            Gallery
                        </h1>
                        <span className="text-xs text-text-tertiary hidden sm:block">
                            {allImagesMode ? 'Latest 100 across all jobs' : 'Review + approve generated designs'}
                        </span>
                    </div>
                )}

                <div className="ml-auto flex items-center gap-1.5 text-xs text-text-tertiary bg-bg-surface px-3 py-1.5 rounded-[8px] border border-border-default">
                    <Info className="w-3 h-3" />
                    <kbd className="px-1 bg-bg-overlay rounded text-[10px]">A</kbd> approve ·
                    <kbd className="px-1 bg-bg-overlay rounded text-[10px]">R</kbd> reject ·
                    <kbd className="px-1 bg-bg-overlay rounded text-[10px]">←→</kbd> navigate ·
                    <kbd className="px-1 bg-bg-overlay rounded text-[10px]">Esc</kbd> clear
                </div>
            </div>

            {/* Full-width Gallery Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-bg-surface border border-border-default rounded-[12px] p-6 overflow-hidden shadow-sm relative">

                {activeJobId && (
                    <div className="flex flex-col gap-4 mb-6 sticky top-0 bg-bg-surface z-20 pb-2 border-b border-border-subtle">
                        {/* Toolbar */}
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            {/* Filters */}
                            {images.length > 0 && (
                                <div className="flex gap-1.5">
                                    {FILTERS.map(f => (
                                        <button
                                            key={f}
                                            onClick={() => setFilter(f)}
                                            className={cn(
                                                'px-3 py-1.5 text-xs rounded-full font-medium transition-all border',
                                                filter === f
                                                    ? 'bg-accent-subtle text-accent border-accent-border shadow-sm'
                                                    : 'bg-bg-elevated text-text-secondary border-border-default hover:text-text-primary hover:border-border-strong'
                                            )}
                                        >
                                            {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Batch Actions */}
                            {images.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {selected.size > 0 && <span className="text-xs text-accent font-medium">{selected.size} selected</span>}
                                    <button onClick={selectAll} className="text-xs text-text-secondary hover:text-text-primary px-2.5 py-1.5 rounded-[6px] border border-border-default hover:border-border-strong transition-colors bg-bg-base">Select All</button>

                                    {selected.size > 0 && (
                                        <>
                                            <button onClick={clearSelect} className="text-xs text-text-secondary hover:text-text-primary px-2.5 py-1.5 rounded-[6px] border border-border-default hover:border-border-strong transition-colors bg-bg-base">Clear</button>
                                            <button onClick={bulkApprove} className="flex items-center gap-1.5 px-3 py-1.5 bg-success-subtle hover:bg-[rgba(34,197,94,0.18)] text-success text-xs font-medium rounded-[6px] border border-[rgba(34,197,94,0.20)] transition-colors">
                                                <CheckCircle className="w-3.5 h-3.5" /> Approve ({selected.size})
                                            </button>
                                            <button onClick={() => setBulkConfirm('reject')} className="flex items-center gap-1.5 px-3 py-1.5 bg-danger-subtle hover:bg-[rgba(239,68,68,0.18)] text-danger text-xs font-medium rounded-[6px] border border-[rgba(239,68,68,0.20)] transition-colors">
                                                <XCircle className="w-3.5 h-3.5" /> Reject
                                            </button>
                                            <button onClick={bulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-danger-subtle hover:bg-danger text-danger hover:text-white text-xs font-medium rounded-[6px] border border-danger/30 transition-colors">
                                                <Trash2 className="w-3.5 h-3.5" /> Delete ({selected.size})
                                            </button>
                                            <button onClick={bulkPublishToEtsy} disabled={!!publishingImage} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 text-xs font-medium rounded-[6px] border border-orange-500/30 transition-colors disabled:opacity-40">
                                                {publishingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Store className="w-3.5 h-3.5" />}
                                                Publish to Etsy ({selected.size})
                                            </button>
                                        </>
                                    )}

                                    <div className="w-px h-5 bg-border-default mx-1"></div>

                                    <button onClick={() => setBulkConfirm('pipeline')} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-subtle hover:bg-[rgba(124,58,237,0.18)] text-accent text-xs font-medium rounded-[6px] border border-accent-border transition-colors">
                                        <Play className="w-3.5 h-3.5" /> Run Pipeline ({approvedCount})
                                    </button>
                                    <div className="flex items-center gap-1 bg-bg-elevated border border-border-default rounded-[6px] px-2 h-[30px]">
                                        <span className="text-text-tertiary text-xs">$</span>
                                        <input type="number" min="0.01" step="0.01" value={listingPrice} onChange={e => setListingPrice(e.target.value)} className="w-14 bg-transparent text-text-primary text-xs focus:outline-none" title="Default listing price for Etsy drafts" />
                                    </div>
                                    <a href={apiExport.bundleUrl(activeJobId)} className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated hover:bg-bg-overlay text-text-primary text-xs font-medium rounded-[6px] border border-border-default transition-colors shadow-sm" target="_blank" rel="noopener noreferrer">
                                        <Download className="w-3.5 h-3.5" /> Bundle
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {!activeJobId ? (
                        <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
                            <History className="w-8 h-8 opacity-30" />
                            <p className="text-sm font-medium text-text-secondary">Open History to select a job</p>
                        </div>
                    ) : isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="aspect-square rounded-[10px] skeleton-shimmer bg-bg-elevated" />
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
                            <ImageIcon className="w-10 h-10 mb-2 opacity-30" />
                            <p className="text-sm">No images match this filter</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-20">
                            {filtered.map((img, idx) => (
                                <GalleryCard
                                    key={img.id}
                                    img={img}
                                    selected={selected.has(img.id)}
                                    onToggleSelect={(e) => handleSelect(idx, e)}
                                    onApprove={() => approveMutation.mutate(img.id)}
                                    onReject={() => rejectMutation.mutate(img.id)}
                                    onDelete={() => handleDelete(img.id)}
                                    onView={() => setViewImg(img)}
                                    onCopyPrompt={() => { navigator.clipboard.writeText(img.rawResponse || img.id); toast.success('Prompt copied'); }}
                                    onRegenerate={() => pipelineMutation.mutate(img.id)}
                                    onRemoveBg={(model) => handleRemoveBg(img.id, img.imageUrl, model)}
                                    onUpscale={(scale) => handleUpscale(img.id, img.imageUrl, scale)}
                                    onPublishToEtsy={() => handlePublishToEtsy(img.id)}
                                    onMockup={() => router.push(`/dashboard/mockups?designUrl=${encodeURIComponent(img.imageUrl)}&designImageId=${img.id}`)}
                                    onSeo={() => router.push(`/dashboard/seo?imageUrl=${encodeURIComponent(img.imageUrl)}`)}
                                    onPipeline={() => setPipelineImage(img)}
                                    isProcessing={processingImage === img.id}
                                    isPublishing={publishingImage === img.id}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Fade overlay at bottom of grid */}
                {activeJobId && images.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-surface to-transparent pointer-events-none" />
                )}
            </div>

            {/* Fullscreen viewer */}
            {viewImg && (
                <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setViewImg(null)}>
                    <div className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center gap-6" onClick={e => e.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={viewImg.imageUrl} alt="Full view" className="max-w-full max-h-[85vh] rounded-[16px] object-contain shadow-2xl" />
                        <div className="flex items-center gap-3 bg-bg-surface p-3 rounded-2xl border border-border-default shadow-lg">
                            <StatusBadge status={viewImg.status} className="px-3" />
                            <div className="w-px h-6 bg-border-default"></div>
                            <button onClick={() => { approveMutation.mutate(viewImg.id); setViewImg(null); }} className="flex items-center gap-2 px-4 py-2 bg-success-subtle hover:bg-[rgba(34,197,94,0.18)] text-success text-sm font-medium rounded-[10px] border border-[rgba(34,197,94,0.20)] transition-colors">
                                <CheckCircle className="w-4 h-4" /> Approve (A)
                            </button>
                            <button onClick={() => { rejectMutation.mutate(viewImg.id); setViewImg(null); }} className="flex items-center gap-2 px-4 py-2 bg-danger-subtle hover:bg-[rgba(239,68,68,0.18)] text-danger text-sm font-medium rounded-[10px] border border-[rgba(239,68,68,0.20)] transition-colors">
                                <XCircle className="w-4 h-4" /> Reject (R)
                            </button>
                            <div className="w-px h-6 bg-border-default ml-2"></div>
                            <button onClick={() => setViewImg(null)} className="text-text-tertiary hover:text-text-primary px-3 text-sm transition-colors">
                                Close (Esc)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal open={bulkConfirm === 'reject'} title="Reject selected images?" message={`This will reject ${selected.size} image(s).`} confirmLabel="Reject All" variant="danger" onConfirm={bulkReject} onCancel={() => setBulkConfirm(null)} />
            <ConfirmModal open={bulkConfirm === 'pipeline'} title="Run pipeline for approved images?" message={`Asset pipeline will run for ${approvedCount} approved image(s).`} confirmLabel="Run Pipeline" onConfirm={runPipelineForApproved} onCancel={() => setBulkConfirm(null)} />

            {pipelineImage && (
                <PipelineModal
                    image={pipelineImage}
                    onClose={() => setPipelineImage(null)}
                />
            )}
        </div>
    );
}

interface GalleryCardProps {
    img: GalleryImage; selected: boolean;
    onToggleSelect: (e: React.MouseEvent) => void; onApprove: () => void; onReject: () => void;
    onDelete: () => void;
    onView: () => void; onCopyPrompt: () => void; onRegenerate: () => void;
    onRemoveBg: (model: 'birefnet' | 'bria') => void;
    onUpscale: (scale: 2 | 4) => void;
    onPublishToEtsy: () => void;
    onMockup: () => void;
    onSeo: () => void;
    onPipeline: () => void;
    isProcessing: boolean;
    isPublishing: boolean;
}

function GalleryCard({ img, selected, onToggleSelect, onApprove, onReject, onDelete, onView, onCopyPrompt, onRegenerate, onRemoveBg, onUpscale, onPublishToEtsy, onMockup, onSeo, onPipeline, isProcessing, isPublishing }: GalleryCardProps) {
    const isPending = img.imageUrl === 'PENDING' || !img.imageUrl;
    const isRejected = img.status === 'REJECTED';

    const handleDownload = async () => {
        const url = img.imageUrl.startsWith('http') ? img.imageUrl : `/${img.imageUrl}`;
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `design-${img.id.slice(0, 8)}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(url, '_blank');
        }
    };

    return (
        <div className={cn(
            'relative group rounded-[10px] overflow-hidden border transition-all duration-200 cursor-pointer shadow-sm',
            selected ? 'border-accent ring-2 ring-accent/30' : 'border-border-subtle hover:border-border-strong',
            isRejected && 'opacity-40 grayscale-[0.8]'
        )}>
            {/* Checkbox */}
            <div className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggleSelect(e); }}>
                <div className={cn(
                    'w-6 h-6 rounded-[6px] border-2 flex items-center justify-center transition-all shadow-sm',
                    selected ? 'bg-accent border-accent scale-100' : 'bg-black/40 border-border-strong opacity-0 group-hover:opacity-100 backdrop-blur-md'
                )}>
                    {selected && <CheckCircle className="w-4 h-4 text-white" />}
                </div>
            </div>

            {/* Status Badge */}
            <div className="absolute top-2 right-2 z-10 shadow-sm"><StatusBadge status={img.status} /></div>

            {/* Image or Pending Skeleton */}
            {isPending ? (
                <div className="h-48 skeleton-shimmer flex items-center justify-center min-h-[160px] bg-bg-elevated">
                    <Loader2 className="w-6 h-6 text-text-tertiary animate-spin opacity-50" />
                </div>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.imageUrl} alt="Generated design" className="w-full aspect-square object-cover block" onClick={onView} />
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col">
                {/* Top row: approve/reject */}
                <div className="flex items-center justify-between p-2">
                    <button onClick={e => { e.stopPropagation(); onApprove(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-success/80 hover:bg-success text-white text-[10px] font-medium rounded-[6px] transition-colors">
                        <Check className="w-3 h-3" /> Approve
                    </button>
                    <button onClick={e => { e.stopPropagation(); onReject(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-danger/80 hover:bg-danger text-white text-[10px] font-medium rounded-[6px] transition-colors">
                        <X className="w-3 h-3" /> Reject
                    </button>
                </div>

                {/* Middle: empty space for image visibility */}
                <div className="flex-1" />

                {/* Bottom row: action buttons */}
                <div className="flex items-center gap-1 p-2 flex-wrap">
                    <button onClick={e => { e.stopPropagation(); handleDownload(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 text-white text-[10px] rounded-[6px] border border-white/10 transition-colors">
                        <Download className="w-3 h-3" /> Save
                    </button>
                    <button onClick={e => { e.stopPropagation(); onRemoveBg('birefnet'); }}
                        disabled={isProcessing}
                        className="flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 text-white text-[10px] rounded-[6px] border border-white/10 transition-colors disabled:opacity-50">
                        {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />} BG
                    </button>
                    <button onClick={e => { e.stopPropagation(); onUpscale(4); }}
                        disabled={isProcessing}
                        className="flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 text-white text-[10px] rounded-[6px] border border-white/10 transition-colors disabled:opacity-50">
                        {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ZoomIn className="w-3 h-3" />} 4x
                    </button>
                    <button onClick={e => { e.stopPropagation(); onMockup(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 text-white text-[10px] rounded-[6px] border border-white/10 transition-colors">
                        <Layers className="w-3 h-3" /> Mockup
                    </button>
                    <button onClick={e => { e.stopPropagation(); onSeo(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-black/60 hover:bg-black/80 text-white text-[10px] rounded-[6px] border border-white/10 transition-colors">
                        <Tag className="w-3 h-3" /> SEO
                    </button>
                    <button onClick={e => { e.stopPropagation(); onPipeline(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-purple-600/80 hover:bg-purple-500 text-white text-[10px] font-medium rounded-[6px] transition-colors"
                        title="Run One-Click Pipeline">
                        <Zap className="w-3 h-3" /> Pipeline
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDelete(); }}
                        className="flex items-center gap-1 px-2 py-1 bg-danger/60 hover:bg-danger text-white text-[10px] rounded-[6px] transition-colors ml-auto">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Pipeline Modal ────────────────────────────────────────────────────────
function PipelineModal({ image, onClose }: { image: GalleryImage; onClose: () => void }) {
    const [running, setRunning] = useState(false);
    const [results, setPipelineResults] = useState<Record<string, unknown> | null>(null);
    const [templates, setTemplates] = useState<Array<{ id: string; name: string; baseImagePath: string }>>([]);
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
    const [options, setOptions] = useState({ bgRemove: true, seo: true });
    const [bgModel, setBgModel] = useState<'birefnet' | 'bria' | 'pixelcut'>('birefnet');

    useEffect(() => {
        fetch('/api/mockups/templates', { credentials: 'include' })
            .then(r => r.json())
            .then(data => setTemplates(data.templates || []))
            .catch(() => { });
    }, []);

    const runPipeline = async () => {
        setRunning(true);
        setPipelineResults(null);
        try {
            const res = await fetch('/api/pipeline/one-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    imageId: image.id,
                    imageUrl: image.imageUrl.startsWith('http') ? image.imageUrl : `${window.location.origin}/${image.imageUrl}`,
                    templateIds: selectedTemplateIds,
                    bgModel,
                    options
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Pipeline failed');
            setPipelineResults(data);
            toast.success('Pipeline completed!');
        } catch (err) {
            toast.error('Pipeline failed: ' + (err as Error).message);
        } finally {
            setRunning(false);
        }
    };

    const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const resolveUrl = (p: string) =>
        p?.startsWith('http') ? p : `${API_BASE}/${p?.startsWith('/') ? p.slice(1) : p}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const steps = results ? (results.steps as any) : null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div
                className="bg-[#111827] border border-slate-700/60 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-700/60">
                    <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <Zap className="w-5 h-5 text-purple-400" /> One-Click Pipeline
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">BG Remove → Mockup → SEO · automated in one shot</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Source image */}
                    <div className="flex items-center gap-4 p-3 bg-slate-800/40 rounded-xl border border-slate-700/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={image.imageUrl.startsWith('http') ? image.imageUrl : `/${image.imageUrl}`}
                            alt="Source"
                            className="w-16 h-16 object-contain rounded-lg bg-slate-900 shrink-0"
                        />
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Source Design</p>
                            <p className="text-sm text-white font-mono mt-0.5">{image.id.slice(0, 8)}…</p>
                        </div>
                    </div>

                    {/* Pipeline steps */}
                    <div className="space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pipeline Steps</p>

                        {/* BG Remove */}
                        <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
                                <input
                                    type="checkbox"
                                    checked={options.bgRemove}
                                    onChange={e => setOptions(o => ({ ...o, bgRemove: e.target.checked }))}
                                    className="w-4 h-4 accent-purple-500"
                                />
                                <div>
                                    <p className="text-sm font-semibold text-white">✂ Background Removal</p>
                                    <p className="text-xs text-slate-400">Result feeds into mockups & SEO</p>
                                </div>
                            </label>
                            {options.bgRemove && (
                                <div className="ml-7 flex gap-2">
                                    {(['birefnet', 'bria', 'pixelcut'] as const).map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setBgModel(m)}
                                            className={cn(
                                                'text-[10px] px-2 py-1 rounded border transition-colors',
                                                bgModel === m
                                                    ? 'bg-purple-600/20 border-purple-500/40 text-purple-400'
                                                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-500'
                                            )}
                                        >
                                            {m === 'birefnet' ? 'BiRefNet (Free)' : m === 'bria' ? 'Bria Pro' : 'Pixelcut'}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Template picker */}
                        <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/40 space-y-2">
                            <p className="text-sm font-semibold text-white">🖼 Mockup Templates</p>
                            <p className="text-xs text-slate-400">Select up to 5 templates to render</p>
                            {templates.length === 0 ? (
                                <p className="text-xs text-slate-500 italic">No templates found. Upload in the Mockups page first.</p>
                            ) : (
                                <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                                    {templates.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => setSelectedTemplateIds(prev =>
                                                prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id]
                                            )}
                                            className={cn(
                                                'relative aspect-square rounded-lg overflow-hidden border-2 transition-all',
                                                selectedTemplateIds.includes(t.id)
                                                    ? 'border-purple-500'
                                                    : 'border-slate-700 hover:border-slate-500'
                                            )}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={resolveUrl(t.baseImagePath)}
                                                alt={t.name}
                                                className="w-full h-full object-cover"
                                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            {selectedTemplateIds.includes(t.id) && (
                                                <div className="absolute inset-0 bg-purple-600/30 flex items-center justify-center">
                                                    <CheckCircle2 className="w-5 h-5 text-purple-300" />
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* SEO */}
                        <label className="flex items-center gap-3 p-3 bg-slate-800/40 rounded-xl border border-slate-700/40 cursor-pointer hover:border-purple-500/30 transition-colors">
                            <input
                                type="checkbox"
                                checked={options.seo}
                                onChange={e => setOptions(o => ({ ...o, seo: e.target.checked }))}
                                className="w-4 h-4 accent-purple-500"
                            />
                            <div>
                                <p className="text-sm font-semibold text-white">🏷 SEO Generation</p>
                                <p className="text-xs text-slate-400">Auto-generate title, description & 13 tags via AI</p>
                            </div>
                        </label>
                    </div>

                    {/* Results */}
                    {steps && (
                        <div className="space-y-2 border-t border-slate-700/60 pt-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Results</p>

                            {steps.bgRemove && (
                                <div className={cn('flex items-center gap-3 text-xs p-3 rounded-xl',
                                    steps.bgRemove.status === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
                                )}>
                                    <span>{steps.bgRemove.status === 'success' ? '✓' : '✗'} BG Remove</span>
                                    {steps.bgRemove.url && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={steps.bgRemove.url} className="w-10 h-10 object-contain ml-auto rounded" alt="bg removed" />
                                    )}
                                </div>
                            )}

                            {steps.mockups?.map((m: { status: string; templateName: string; url?: string; templateId: string }, i: number) => (
                                <div key={i} className={cn('flex items-center gap-3 text-xs p-3 rounded-xl',
                                    m.status === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
                                )}>
                                    <span>{m.status === 'success' ? '✓' : '✗'} Mockup: {m.templateName}</span>
                                    {m.url && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={m.url.startsWith('http') ? m.url : `/${m.url}`} className="w-10 h-10 object-contain ml-auto rounded" alt="mockup" />
                                    )}
                                </div>
                            ))}

                            {steps.seo?.status === 'success' && (
                                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-2">
                                    <p className="text-xs font-bold text-green-400">✓ SEO Generated</p>
                                    <p className="text-xs text-slate-300 line-clamp-2 font-medium">{steps.seo.title}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {steps.seo.tags?.slice(0, 7).map((tag: string, i: number) => (
                                            <span key={i} className="text-[10px] px-2 py-0.5 bg-slate-700/80 text-slate-300 rounded-full">{tag}</span>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => {
                                            const text = `TITLE:\n${steps.seo.title}\n\nDESCRIPTION:\n${steps.seo.description}\n\nTAGS:\n${steps.seo.tags.join(', ')}`;
                                            navigator.clipboard.writeText(text);
                                            toast.success('SEO copied to clipboard!');
                                        }}
                                        className="text-[10px] px-3 py-1.5 bg-green-600/20 text-green-400 rounded-lg border border-green-500/30 hover:bg-green-600/30 transition-colors font-semibold"
                                    >
                                        Copy All SEO
                                    </button>
                                </div>
                            )}

                            {steps.seo?.status === 'failed' && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400">
                                    ✗ SEO failed: {steps.seo.error}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-6 pt-0">
                    <button onClick={onClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold rounded-xl transition-colors">
                        {results ? 'Close' : 'Cancel'}
                    </button>
                    {!results && (
                        <button
                            onClick={runPipeline}
                            disabled={running}
                            className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all"
                        >
                            {running ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Running Pipeline…</>
                            ) : (
                                <><Zap className="w-4 h-4" /> Run Pipeline</>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
