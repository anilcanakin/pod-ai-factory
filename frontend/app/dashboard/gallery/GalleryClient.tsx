'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGallery, apiPipeline, apiExport, type GalleryImage } from '@/lib/api';
import { toast } from 'sonner';
import { cn, truncateId } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { useSearchParams } from 'next/navigation';
import {
    Search, CheckCircle, XCircle, RefreshCw, Loader2,
    Download, Play, Maximize2, Copy, Image as ImageIcon, Info
} from 'lucide-react';

export function GalleryClient() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
            </div>
        }>
            <GalleryInner />
        </Suspense>
    );
}

function GalleryInner() {
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const urlJobId = searchParams.get('jobId') || '';
    const [jobId, setJobId] = useState(urlJobId);
    const [activeJobId, setActiveJobId] = useState(urlJobId);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
    const [viewImg, setViewImg] = useState<GalleryImage | null>(null);
    const [bulkConfirm, setBulkConfirm] = useState<null | 'reject' | 'pipeline'>(null);
    const [filter, setFilter] = useState<'all' | 'PENDING' | 'COMPLETED' | 'APPROVED' | 'REJECTED'>('all');

    // Auto-load when navigating from Overview recent jobs
    useEffect(() => {
        if (urlJobId && urlJobId !== activeJobId) {
            setJobId(urlJobId);
            setActiveJobId(urlJobId);
        }
    }, [urlJobId, activeJobId]);

    const { data: images = [], isLoading } = useQuery({
        queryKey: ['gallery', activeJobId],
        queryFn: () => apiGallery.getImages(activeJobId),
        enabled: !!activeJobId,
        refetchInterval: activeJobId ? 5000 : false,
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
        for (const id of selected) { try { await apiGallery.approve(id); } catch { } }
        queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
        toast.success(`Approved ${selected.size} images`);
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

    return (
        <div className="space-y-5 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Gallery</h1>
                    <p className="text-sm text-slate-400 mt-0.5">Review + approve generated designs</p>
                </div>
                {activeJobId && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                        <Info className="w-3 h-3" />
                        <kbd className="px-1 bg-slate-700 rounded text-[10px]">A</kbd> approve ·
                        <kbd className="px-1 bg-slate-700 rounded text-[10px]">R</kbd> reject ·
                        <kbd className="px-1 bg-slate-700 rounded text-[10px]">←→</kbd> navigate ·
                        <kbd className="px-1 bg-slate-700 rounded text-[10px]">Shift</kbd> range ·
                        <kbd className="px-1 bg-slate-700 rounded text-[10px]">Esc</kbd> clear
                    </div>
                )}
            </div>

            {/* Job ID bar */}
            <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        value={jobId}
                        onChange={e => setJobId(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && jobId.trim() && setActiveJobId(jobId.trim())}
                        placeholder="Enter Job ID and press Enter…"
                        className="w-full bg-[#1e293b] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                    />
                </div>
                <button
                    onClick={() => jobId.trim() && setActiveJobId(jobId.trim())}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    Load
                </button>
            </div>

            {/* Toolbar */}
            {activeJobId && images.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-1">
                        {(['all', 'PENDING', 'COMPLETED', 'APPROVED', 'REJECTED'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={cn(
                                    'px-2.5 py-1 text-xs rounded-md font-medium transition-colors',
                                    filter === f ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                                )}
                            >
                                {f === 'all' ? 'All' : f}
                            </button>
                        ))}
                    </div>

                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                        {selected.size > 0 && <span className="text-xs text-blue-400 font-medium">{selected.size} selected</span>}
                        <button onClick={selectAll} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-700 hover:border-slate-600 transition-colors">Select All</button>
                        {selected.size > 0 && (
                            <>
                                <button onClick={clearSelect} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-700 hover:border-slate-600 transition-colors">Clear</button>
                                <button onClick={bulkApprove} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600/80 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors">
                                    <CheckCircle className="w-3.5 h-3.5" /> Approve {selected.size}
                                </button>
                                <button onClick={() => setBulkConfirm('reject')} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors">
                                    <XCircle className="w-3.5 h-3.5" /> Reject {selected.size}
                                </button>
                            </>
                        )}
                        <button onClick={() => setBulkConfirm('pipeline')} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white text-xs font-medium rounded-lg transition-colors">
                            <Play className="w-3.5 h-3.5" /> Run Pipeline ({approvedCount} approved)
                        </button>
                        <a href={apiExport.bundleUrl(activeJobId)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium rounded-lg transition-colors" target="_blank" rel="noopener noreferrer">
                            <Download className="w-3.5 h-3.5" /> Bundle
                        </a>
                    </div>
                </div>
            )}

            {/* Gallery Grid */}
            {!activeJobId ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                    <ImageIcon className="w-12 h-12 mb-3 opacity-30" />
                    <p className="text-sm">Enter a Job ID to load images</p>
                    <p className="text-xs text-slate-600 mt-1">You can find Job IDs from the Factory page after a run</p>
                </div>
            ) : isLoading ? (
                <div className="masonry-grid">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="masonry-item">
                            <div className={cn('bg-[#1e293b] rounded-xl animate-pulse', i % 3 === 0 ? 'h-48' : i % 3 === 1 ? 'h-36' : 'h-56')} />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                    <ImageIcon className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm">No images match this filter</p>
                </div>
            ) : (
                <div className="masonry-grid">
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
                        />
                    ))}
                </div>
            )}

            {/* Fullscreen viewer */}
            {viewImg && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setViewImg(null)}>
                    <div className="relative max-w-3xl max-h-full" onClick={e => e.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={viewImg.imageUrl} alt="Full view" className="max-w-full max-h-[80vh] rounded-xl object-contain" />
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
                            <StatusBadge status={viewImg.status} />
                            <button onClick={() => { approveMutation.mutate(viewImg.id); setViewImg(null); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg">
                                <CheckCircle className="w-3.5 h-3.5" /> Approve
                            </button>
                            <button onClick={() => { rejectMutation.mutate(viewImg.id); setViewImg(null); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg">
                                <XCircle className="w-3.5 h-3.5" /> Reject
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
}

function GalleryCard({ img, selected, onToggleSelect, onApprove, onReject, onView, onCopyPrompt, onRegenerate }: GalleryCardProps) {
    const isPending = img.imageUrl === 'PENDING' || !img.imageUrl;
    const isRejected = img.status === 'REJECTED';

    return (
        <div className={cn('masonry-item relative group rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer', selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-700 hover:border-slate-600', isRejected && 'opacity-50')}>
            <div className="absolute top-2 left-2 z-10" onClick={e => { e.stopPropagation(); onToggleSelect(e); }}>
                <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center transition-all', selected ? 'bg-blue-600 border-blue-600' : 'bg-black/40 border-slate-500 opacity-0 group-hover:opacity-100')}>
                    {selected && <CheckCircle className="w-3 h-3 text-white" />}
                </div>
            </div>
            <div className="absolute top-2 right-2 z-10"><StatusBadge status={img.status} /></div>

            {isPending ? (
                <div className="h-36 bg-slate-800 flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.imageUrl} alt="Generated design" className="w-full object-cover block" onClick={onView} />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3">
                <div className="flex items-center gap-1.5">
                    <button onClick={e => { e.stopPropagation(); onApprove(); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600/90 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors backdrop-blur-sm">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button onClick={e => { e.stopPropagation(); onReject(); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600/90 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors backdrop-blur-sm"><XCircle className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); onView(); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors backdrop-blur-sm"><Maximize2 className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); onCopyPrompt(); }} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors backdrop-blur-sm"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); onRegenerate(); }} className="ml-auto flex items-center gap-1 px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors backdrop-blur-sm"><RefreshCw className="w-3.5 h-3.5" /></button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 font-mono">{truncateId(img.id)}</p>
            </div>
        </div>
    );
}
