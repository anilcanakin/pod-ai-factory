'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGallery, apiPipeline, apiExport } from '@/lib/api';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { truncateId, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
    Download, Play, Search, FileDown, Package, RefreshCw,
    Loader2, Filter, Image as ImageIcon, Frame
} from 'lucide-react';

type DateRange = '7d' | '30d' | 'all';
type StatusFilter = 'all' | 'approved';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
function resolveUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${API_BASE}/${url}`;
}

function filterByDate(dateStr: string, range: DateRange): boolean {
    if (range === 'all') return true;
    const days = range === '7d' ? 7 : 30;
    return Date.now() - new Date(dateStr).getTime() < days * 86400000;
}

export function ExportsClient() {
    const queryClient = useQueryClient();
    const [jobId, setJobId] = useState('');
    const [activeJobId, setActiveJobId] = useState('');
    const [pipelineConfirm, setPipelineConfirm] = useState(false);
    const [pipelineRunning, setPipelineRunning] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [mockupsOnly, setMockupsOnly] = useState(false);

    // Job-specific images
    const { data: jobImages = [], isLoading } = useQuery({
        queryKey: ['gallery', activeJobId],
        queryFn: () => apiGallery.getImages(activeJobId),
        enabled: !!activeJobId,
    });

    // All recent images (for mockup export panel)
    const { data: allRecent = [] } = useQuery({
        queryKey: ['gallery-recent'],
        queryFn: apiGallery.getRecent,
        staleTime: 60000,
    });

    // Apply filters to job images
    const filteredImages = jobImages.filter(img => {
        if (statusFilter === 'approved' && !img.isApproved && img.status !== 'APPROVED') return false;
        if (mockupsOnly && img.engine !== 'mockup') return false;
        if (img.createdAt && !filterByDate(img.createdAt, dateRange)) return false;
        return true;
    });

    const approvedImages = jobImages.filter(img => img.isApproved || img.status === 'APPROVED');
    const estimatedSizeMB = (filteredImages.filter(i => i.imageUrl && i.imageUrl !== 'PENDING').length * 0.5).toFixed(1);

    // Mockup images across all jobs
    const mockupImages = allRecent.filter(img =>
        img.engine === 'mockup' &&
        filterByDate(img.createdAt ?? '', dateRange)
    );

    const runPipeline = async () => {
        setPipelineRunning(true);
        setPipelineConfirm(false);
        try {
            const result = await apiPipeline.runJob(activeJobId);
            toast.success(result.message);
            queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] });
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Pipeline failed');
        } finally {
            setPipelineRunning(false);
        }
    };

    const DATE_RANGES: { label: string; value: DateRange }[] = [
        { label: 'Last 7 days', value: '7d' },
        { label: 'Last 30 days', value: '30d' },
        { label: 'All time', value: 'all' },
    ];

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Pipeline & Exports</h1>
                <p className="text-sm text-slate-400 mt-0.5">Run pipeline for approved images, then download assets</p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Filter className="w-3.5 h-3.5" /> Filters:
                </div>
                <div className="flex gap-1">
                    {DATE_RANGES.map(r => (
                        <button
                            key={r.value}
                            onClick={() => setDateRange(r.value)}
                            className={cn(
                                'px-3 py-1.5 text-xs rounded-full border transition-colors',
                                dateRange === r.value
                                    ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-1">
                    {(['all', 'approved'] as StatusFilter[]).map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={cn(
                                'px-3 py-1.5 text-xs rounded-full border transition-colors',
                                statusFilter === s
                                    ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                            )}
                        >
                            {s === 'all' ? 'All images' : 'Approved only'}
                        </button>
                    ))}
                </div>
                <button
                    onClick={() => setMockupsOnly(v => !v)}
                    className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors',
                        mockupsOnly
                            ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                    )}
                >
                    <Frame className="w-3 h-3" /> Mockups only
                </button>
            </div>

            {/* Job ID input */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-slate-200">Load Job</h2>
                <div className="flex gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            value={jobId}
                            onChange={e => setJobId(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && jobId.trim() && setActiveJobId(jobId.trim())}
                            placeholder="Enter Job ID…"
                            className="w-full bg-[#0f172a] border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                        />
                    </div>
                    <button
                        onClick={() => jobId.trim() && setActiveJobId(jobId.trim())}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        Load
                    </button>
                </div>
            </div>

            {/* Actions (once job loaded) */}
            {activeJobId && (
                <>
                    {/* Stats bar */}
                    <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                            <ImageIcon className="w-3.5 h-3.5" />
                            <span><span className="text-slate-200 font-medium">{filteredImages.length}</span> files shown</span>
                        </span>
                        <span className="text-slate-600">·</span>
                        <span><span className="text-slate-200 font-medium">~{estimatedSizeMB} MB</span> estimated ZIP size</span>
                        <span className="text-slate-600">·</span>
                        <span><span className="text-slate-200 font-medium">{approvedImages.length}</span> approved</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Pipeline */}
                        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                                    <Play className="w-4 h-4 text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-200">Run Pipeline</h3>
                                    <p className="text-xs text-slate-500">{approvedImages.length} approved images</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setPipelineConfirm(true)}
                                disabled={pipelineRunning || approvedImages.length === 0}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/40 text-white font-medium rounded-lg transition-colors text-sm"
                            >
                                {pipelineRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                {pipelineRunning ? 'Running…' : 'Run for Approved'}
                            </button>
                        </div>

                        {/* CSV Download */}
                        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                                    <FileDown className="w-4 h-4 text-green-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-200">Export CSV</h3>
                                    <p className="text-xs text-slate-500">Metadata + SKUs + image URLs</p>
                                </div>
                            </div>
                            <a
                                href={apiExport.csvUrl(activeJobId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-700 hover:bg-green-600 text-white font-medium rounded-lg transition-colors text-sm"
                            >
                                <Download className="w-4 h-4" /> Download CSV
                            </a>
                        </div>

                        {/* Bundle Download */}
                        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                            <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                                    <Package className="w-4 h-4 text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-200">Download Bundle</h3>
                                    <p className="text-xs text-slate-500">~{estimatedSizeMB} MB · full .zip</p>
                                </div>
                            </div>
                            <a
                                href={apiExport.bundleUrl(activeJobId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-700 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors text-sm"
                            >
                                <Download className="w-4 h-4" /> Download .zip
                            </a>
                        </div>
                    </div>
                </>
            )}

            {/* Export Mockups Only panel */}
            {mockupImages.length > 0 && (
                <div className="bg-[#1e293b] border border-purple-500/20 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            <Frame className="w-4 h-4 text-purple-400" /> Mockup Images
                            <span className="text-slate-500 font-normal">({mockupImages.length})</span>
                        </h2>
                        <p className="text-xs text-slate-500">Across all jobs · {dateRange === 'all' ? 'all time' : dateRange === '7d' ? 'last 7 days' : 'last 30 days'}</p>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3 p-4">
                        {mockupImages.slice(0, 24).map(img => (
                            <a
                                key={img.id}
                                href={resolveUrl(img.imageUrl)}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group aspect-square bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-purple-500/50 transition-all relative"
                                title="Download"
                            >
                                <img
                                    src={resolveUrl(img.imageUrl)}
                                    alt="Mockup"
                                    className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Download className="w-4 h-4 text-white drop-shadow" />
                                </div>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Assets list */}
            {activeJobId && (
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                        <h2 className="text-sm font-semibold text-slate-200">
                            Generated Assets
                            {filteredImages.length > 0 && (
                                <span className="text-slate-500 font-normal ml-1">
                                    ({filteredImages.length}{filteredImages.length !== jobImages.length ? ` of ${jobImages.length}` : ''})
                                </span>
                            )}
                        </h2>
                        <button
                            onClick={() => queryClient.invalidateQueries({ queryKey: ['gallery', activeJobId] })}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Refresh
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="divide-y divide-slate-800">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="flex items-center gap-4 px-5 py-3 animate-pulse">
                                    <div className="w-10 h-10 bg-slate-700 rounded-lg" />
                                    <div className="flex-1 h-3 bg-slate-700 rounded" />
                                    <div className="h-5 w-20 bg-slate-700 rounded" />
                                </div>
                            ))}
                        </div>
                    ) : filteredImages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <Package className="w-10 h-10 mb-2 opacity-30" />
                            <p className="text-sm">No assets match the current filters</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700 bg-slate-800/40">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Image</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">ID</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Created</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">URL</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {filteredImages.map(img => (
                                        <tr key={img.id} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="w-10 h-10 rounded-lg bg-slate-700 overflow-hidden">
                                                    {img.imageUrl && img.imageUrl !== 'PENDING' ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={resolveUrl(img.imageUrl)} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-400">{truncateId(img.id)}</td>
                                            <td className="px-4 py-3"><StatusBadge status={img.status} /></td>
                                            <td className="px-4 py-3 text-xs text-slate-500">{img.createdAt ? formatDate(img.createdAt) : '—'}</td>
                                            <td className="px-4 py-3">
                                                {img.imageUrl && img.imageUrl !== 'PENDING' ? (
                                                    <a
                                                        href={resolveUrl(img.imageUrl)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                                    >
                                                        <Download className="w-3 h-3" /> Open
                                                    </a>
                                                ) : (
                                                    <span className="text-xs text-slate-600">Pending…</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            <ConfirmModal
                open={pipelineConfirm}
                title="Run pipeline for approved images?"
                message={`Assets will be processed for ${approvedImages.length} approved image(s). This triggers the real pipeline endpoint.`}
                confirmLabel="Run Pipeline"
                onConfirm={runPipeline}
                onCancel={() => setPipelineConfirm(false)}
            />
        </div>
    );
}
