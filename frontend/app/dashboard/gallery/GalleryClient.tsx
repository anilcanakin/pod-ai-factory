'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGallery, apiPipeline, apiExport, apiJobs, apiTools, type GalleryImage } from '@/lib/api';
import { toast } from 'sonner';
import { cn, truncateId } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
    CheckCircle, XCircle, RefreshCw, Loader2,
    Download, Play, Maximize2, Copy, Image as ImageIcon, Images, Info,
    History, Scissors, ZoomIn
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

    const approvedCount = images.filter(i => i.isApproved || i.status === 'APPROVED').length;
    const FILTERS = ['all', 'PENDING', 'COMPLETED', 'APPROVED', 'REJECTED'] as const;

    return (
        <div className="flex gap-6 h-[calc(100vh-8rem)] animate-fade-in">

            {/* Left Column: Job History */}
            <div className="w-80 flex flex-col bg-bg-surface border border-border-default rounded-[12px] overflow-hidden shadow-sm shrink-0">
                <div className="p-4 border-b border-border-default flex items-center justify-between bg-bg-base">
                    <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-text-secondary" />
                        <h2 className="text-sm font-semibold text-text-primary">History</h2>
                    </div>
                    <div className="px-2 py-0.5 bg-accent/10 text-accent text-[10px] font-medium rounded-full">
                        {jobs.length} Jobs
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {/* All Images shortcut */}
                    <button
                        onClick={() => setActiveJobId('__all__')}
                        className={cn(
                            "w-full flex items-center gap-3 p-2.5 rounded-[8px] transition-all text-left border mb-2",
                            activeJobId === '__all__'
                                ? "bg-accent-subtle border-accent"
                                : "hover:bg-bg-elevated border-transparent"
                        )}
                    >
                        <div className="w-10 h-10 rounded-[6px] bg-bg-elevated flex items-center justify-center border border-border-subtle shrink-0">
                            <Images className="w-4 h-4 text-text-tertiary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className={cn("text-[11px] font-semibold", activeJobId === '__all__' ? "text-accent" : "text-text-primary")}>All Images</div>
                            <div className="text-[10px] text-text-tertiary">Recent across all jobs</div>
                        </div>
                    </button>
                    <div className="border-t border-border-subtle mb-2" />

                    {isJobsLoading ? (
                        <div className="space-y-2 p-2">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="w-full flex items-center gap-3 p-2.5 rounded-[8px] border border-border-subtle">
                                    <div className="w-10 h-10 rounded-full skeleton-shimmer bg-bg-elevated shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-3 w-1/2 rounded bg-bg-elevated skeleton-shimmer" />
                                        <div className="h-2 w-1/3 rounded bg-bg-elevated skeleton-shimmer" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="text-center py-10 px-4 text-sm text-text-tertiary">
                            No jobs yet
                        </div>
                    ) : (
                        jobs.map(job => (
                            <button
                                key={job.id}
                                onClick={() => setActiveJobId(job.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-2.5 rounded-[8px] transition-all text-left border relative group",
                                    activeJobId === job.id
                                        ? "bg-accent-subtle border-accent"
                                        : "hover:bg-bg-elevated border-transparent"
                                )}
                            >
                                {job.previewUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={job.previewUrl} alt="Preview" className="w-10 h-10 rounded-[6px] object-cover bg-bg-elevated shadow-sm shrink-0 border border-border-subtle" />
                                ) : (
                                    <div className="w-10 h-10 rounded-[6px] bg-bg-elevated flex items-center justify-center border border-border-subtle shrink-0">
                                        <ImageIcon className="w-4 h-4 text-text-tertiary opacity-40" />
                                    </div>
                                )}
                                
                                <div className="flex-1 min-w-0 pr-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className={cn(
                                            "text-[10px] font-mono font-medium truncate",
                                            activeJobId === job.id ? "text-accent" : "text-text-primary"
                                        )}>
                                            {truncateId(job.id)}
                                        </span>
                                        <div className="flex items-center transform scale-75 origin-right">
                                            <StatusBadge status={job.status} />
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-between items-center text-[10px] text-text-tertiary">
                                        <span>{timeAgo(job.createdAt)}</span>
                                        <span className="flex items-center gap-1 font-medium bg-bg-elevated px-1.5 py-0.5 rounded border border-border-subtle">
                                            {job.imageCount} images
                                        </span>
                                    </div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Gallery Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-bg-surface border border-border-default rounded-[12px] p-6 overflow-hidden shadow-sm relative">

                {activeJobId && (
                    <div className="flex flex-col gap-4 mb-6 sticky top-0 bg-bg-surface z-20 pb-2 border-b border-border-subtle">
                        {/* Header area inside content */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
                                    {allImagesMode ? (
                                        <span className="text-accent bg-accent/10 px-2 py-0.5 rounded text-base">All Images</span>
                                    ) : (
                                        <span className="font-mono text-accent bg-accent/10 px-2 py-0.5 rounded text-base">{truncateId(activeJobId)}</span>
                                    )}
                                    Gallery
                                </h1>
                                <p className="text-xs text-text-secondary mt-1">
                                    {allImagesMode ? 'Latest 100 images across all jobs' : 'Review + approve generated designs'}
                                </p>
                            </div>
                            
                            <div className="flex items-center gap-1.5 text-xs text-text-tertiary bg-bg-elevated px-3 py-1.5 rounded-[8px] border border-border-default">
                                <Info className="w-3 h-3" />
                                <kbd className="px-1 bg-bg-overlay rounded text-[10px]">A</kbd> approve ·
                                <kbd className="px-1 bg-bg-overlay rounded text-[10px]">R</kbd> reject ·
                                <kbd className="px-1 bg-bg-overlay rounded text-[10px]">←→</kbd> navigate ·
                                <kbd className="px-1 bg-bg-overlay rounded text-[10px]">Shift</kbd> range ·
                                <kbd className="px-1 bg-bg-overlay rounded text-[10px]">Esc</kbd> clear
                            </div>
                        </div>

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
                                <div className="flex items-center gap-2">
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
                                        </>
                                    )}

                                    <div className="w-px h-5 bg-border-default mx-1"></div>

                                    <button onClick={() => setBulkConfirm('pipeline')} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-subtle hover:bg-[rgba(124,58,237,0.18)] text-accent text-xs font-medium rounded-[6px] border border-accent-border transition-colors">
                                        <Play className="w-3.5 h-3.5" /> Run Pipeline ({approvedCount})
                                    </button>
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
                        <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
                            <p className="text-sm font-medium text-text-secondary cursor-default select-none pointer-events-none">← Select a job from history to view images</p>
                        </div>
                    ) : isLoading ? (
                        <div className="masonry-grid">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="masonry-item">
                                    <div className={cn('rounded-[10px] skeleton-shimmer', i % 3 === 0 ? 'h-56' : i % 3 === 1 ? 'h-40' : 'h-64')} />
                                </div>
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
                            <ImageIcon className="w-10 h-10 mb-2 opacity-30" />
                            <p className="text-sm">No images match this filter</p>
                        </div>
                    ) : (
                        <div className="masonry-grid pb-20">
                            {filtered.map((img, idx) => (
                                <GalleryCard
                                    key={img.id}
                                    img={img}
                                    selected={selected.has(img.id)}
                                    onToggleSelect={(e) => handleSelect(idx, e)}
                                    onApprove={() => approveMutation.mutate(img.id)}
                                    onReject={() => rejectMutation.mutate(img.id)}
                                    onView={() => setViewImg(img)}
                                    onCopyPrompt={() => { navigator.clipboard.writeText(img.rawResponse || img.id); toast.success('Prompt copied'); }}
                                    onRegenerate={() => pipelineMutation.mutate(img.id)}
                                    onRemoveBg={(model) => handleRemoveBg(img.id, img.imageUrl, model)}
                                    onUpscale={(scale) => handleUpscale(img.id, img.imageUrl, scale)}
                                    isProcessing={processingImage === img.id}
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
                                <CheckCircle className="w-4 h-4" /> Approve Focus (A)
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
        </div>
    );
}

interface GalleryCardProps {
    img: GalleryImage; selected: boolean;
    onToggleSelect: (e: React.MouseEvent) => void; onApprove: () => void; onReject: () => void;
    onView: () => void; onCopyPrompt: () => void; onRegenerate: () => void;
    onRemoveBg: (model: 'birefnet' | 'bria') => void;
    onUpscale: (scale: 2 | 4) => void;
    isProcessing: boolean;
}

function GalleryCard({ img, selected, onToggleSelect, onApprove, onReject, onView, onCopyPrompt, onRegenerate, onRemoveBg, onUpscale, isProcessing }: GalleryCardProps) {
    const isPending = img.imageUrl === 'PENDING' || !img.imageUrl;
    const isRejected = img.status === 'REJECTED';

    return (
        <div className={cn(
            'masonry-item relative group rounded-[10px] overflow-hidden border transition-all duration-200 cursor-pointer shadow-sm',
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
                <img src={img.imageUrl} alt="Generated design" className="w-full object-cover block" onClick={onView} />
            )}

            {/* Hover Overlay */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 pt-12">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={e => { e.stopPropagation(); onApprove(); }} className="flex-1 flex justify-center items-center gap-1.5 px-2 py-2 bg-success-subtle text-success text-xs font-medium rounded-[8px] border border-[rgba(34,197,94,0.20)] transition-colors backdrop-blur-md hover:bg-[rgba(34,197,94,0.18)]">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button onClick={e => { e.stopPropagation(); onReject(); }} className="flex-1 flex justify-center items-center gap-1.5 px-2 py-2 bg-danger-subtle text-danger text-xs font-medium rounded-[8px] border border-[rgba(239,68,68,0.20)] transition-colors backdrop-blur-md hover:bg-[rgba(239,68,68,0.18)]">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                </div>
                
                <div className="flex items-center justify-center gap-1.5 mt-2">
                    <button onClick={e => { e.stopPropagation(); onView(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 text-white text-[10px] font-medium rounded-[6px] transition-colors backdrop-blur-md hover:bg-black/80 border border-white/10">
                        <Maximize2 className="w-3 h-3" /> View
                    </button>
                    <button onClick={e => { e.stopPropagation(); onCopyPrompt(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 text-white text-[10px] font-medium rounded-[6px] transition-colors backdrop-blur-md hover:bg-black/80 border border-white/10">
                        <Copy className="w-3 h-3" /> Prompt
                    </button>
                    <button onClick={e => { e.stopPropagation(); onRegenerate(); }} title="Regenerate Pipeline" className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 text-white text-[10px] font-medium rounded-[6px] transition-colors backdrop-blur-md hover:bg-black/80 border border-white/10">
                        <RefreshCw className="w-3 h-3" />
                    </button>
                    
                    {/* Remove BG butonu — dropdown ile model seçimi */}
                    <div className="relative group/bg">
                        <button 
                            onClick={e => { e.stopPropagation(); onRemoveBg('birefnet'); }}
                            disabled={isProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 bg-black/60 text-white text-[10px] font-medium rounded-[6px] transition-colors backdrop-blur-md hover:bg-black/80 border border-white/10 disabled:opacity-50"
                            title="Remove Background"
                        >
                            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                        </button>
                        {/* Bria seçeneği — hover'da görünür */}
                        <div className="absolute bottom-full left-0 mb-1 hidden group-hover/bg:block z-20">
                            <button
                                onClick={e => { e.stopPropagation(); onRemoveBg('bria'); }}
                                className="whitespace-nowrap text-[10px] px-2 py-1 bg-bg-elevated border border-accent/30 text-accent rounded-[4px] hover:bg-accent-subtle"
                            >
                                Bria (Premium)
                            </button>
                        </div>
                    </div>

                    {/* Upscale butonu */}
                    <button 
                        onClick={e => { e.stopPropagation(); onUpscale(4); }}
                        disabled={isProcessing}
                        className="flex items-center gap-1 px-3 py-1.5 bg-black/60 text-white text-[10px] font-medium rounded-[6px] transition-colors backdrop-blur-md hover:bg-black/80 border border-white/10 disabled:opacity-50"
                        title="Upscale 4x"
                    >
                        {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ZoomIn className="w-3 h-3" />}
                    </button>
                </div>
                <p className="text-[9px] text-white/50 mt-2 font-mono text-center tracking-widest uppercase">{truncateId(img.id)}</p>
            </div>
        </div>
    );
}
