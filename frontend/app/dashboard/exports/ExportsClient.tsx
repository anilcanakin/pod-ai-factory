'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGallery, apiPipeline, apiExport } from '@/lib/api';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { truncateId, formatDate } from '@/lib/utils';
import { Download, Play, Search, FileDown, Package, RefreshCw, Loader2 } from 'lucide-react';

export function ExportsClient() {
    const queryClient = useQueryClient();
    const [jobId, setJobId] = useState('');
    const [activeJobId, setActiveJobId] = useState('');
    const [pipelineConfirm, setPipelineConfirm] = useState(false);
    const [pipelineRunning, setPipelineRunning] = useState(false);

    const { data: images = [], isLoading } = useQuery({
        queryKey: ['gallery', activeJobId],
        queryFn: () => apiGallery.getImages(activeJobId),
        enabled: !!activeJobId,
    });

    const approvedImages = images.filter(img => img.isApproved || img.status === 'APPROVED');

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


    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Pipeline & Exports</h1>
                <p className="text-sm text-slate-400 mt-0.5">Run pipeline for approved images, then download assets</p>
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
                                <p className="text-xs text-slate-500">Full .zip with all assets</p>
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
            )}

            {/* Assets list */}
            {activeJobId && (
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                        <h2 className="text-sm font-semibold text-slate-200">
                            Generated Assets {images.length > 0 && <span className="text-slate-500 font-normal ml-1">({images.length})</span>}
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
                    ) : images.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <Package className="w-10 h-10 mb-2 opacity-30" />
                            <p className="text-sm">No assets found for this job</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700 bg-slate-800/40">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Image</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">ID</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">URL</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800">
                                    {images.map(img => (
                                        <tr key={img.id} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="w-10 h-10 rounded-lg bg-slate-700 overflow-hidden">
                                                    {img.imageUrl && img.imageUrl !== 'PENDING' ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={img.imageUrl} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <Loader2 className="w-4 h-4 text-slate-600 animate-spin" />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-400">{truncateId(img.id)}</td>
                                            <td className="px-4 py-3"><StatusBadge status={img.status} /></td>
                                            <td className="px-4 py-3">
                                                {img.imageUrl && img.imageUrl !== 'PENDING' ? (
                                                    <a
                                                        href={img.imageUrl}
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
