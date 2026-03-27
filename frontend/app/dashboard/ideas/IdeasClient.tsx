'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiIdeas, type Idea } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { FileDropzone } from '@/components/shared/FileDropzone';
import { Lightbulb, Upload, RefreshCw, CheckCircle, XCircle, Factory, AlertTriangle, Loader2 } from 'lucide-react';

export function IdeasClient() {
    const queryClient = useQueryClient();
    const [uploading, setUploading] = useState(false);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [sortField, setSortField] = useState<keyof Idea>('status');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const { data: ideas = [], isLoading } = useQuery({
        queryKey: ['ideas'],
        queryFn: apiIdeas.list,
        staleTime: 30000,
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: string }) => apiIdeas.updateStatus(id, status),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ideas'] }),
        onError: () => toast.error('Update failed'),
    });

    const factoryMutation = useMutation({
        mutationFn: (id: string) => apiIdeas.sendToFactory(id),
        onSuccess: (data) => {
            toast.success(`Job created: ${data.jobId.substring(0, 8)}`);
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
        },
        onError: () => toast.error('Failed to send to factory'),
    });

    const handleGenerate = async () => {
        if (!csvFile) { toast.error('Select a CSV file first'); return; }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', csvFile);
            const result = await apiIdeas.generate(fd);
            toast.success(result.message || 'Ideas generated!');
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setUploading(false);
        }
    };

    const toggleSort = (field: keyof Idea) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const sorted = [...ideas].sort((a, b) => {
        const av = a[sortField] ?? '';
        const bv = b[sortField] ?? '';
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
    });

    const pendingCount = ideas.filter(i => i.status === 'PENDING').length;
    const approvedCount = ideas.filter(i => i.status === 'APPROVED').length;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Ideas Engine</h1>
                <p className="text-sm text-slate-400 mt-0.5">Upload EverBee / eRank CSV to generate safe POD design ideas</p>
            </div>

            {/* Upload card */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-yellow-400" /> Generate Ideas
                </h2>
                <FileDropzone
                    onFile={setCsvFile}
                    accept=".csv"
                    label="Drop EverBee / eRank CSV here"
                />
                <button
                    onClick={handleGenerate}
                    disabled={uploading || !csvFile}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? 'Generating…' : 'Import & Generate'}
                </button>
            </div>

            {/* Ideas Table */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-wrap gap-3">
                    <h2 className="text-sm font-semibold text-slate-200">
                        Generated Ideas {ideas.length > 0 && (
                            <span className="text-slate-500 font-normal ml-1">
                                ({ideas.length} total · {pendingCount} pending · {approvedCount} approved)
                            </span>
                        )}
                    </h2>
                    <div className="flex items-center gap-2">
                        {approvedCount > 0 && (
                            <button
                                onClick={() => {
                                    const approved = ideas.filter(i => i.status === 'APPROVED');
                                    approved.forEach(i => factoryMutation.mutate(i.id));
                                }}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg transition-colors"
                            >
                                <Factory className="w-3.5 h-3.5" /> Send All Approved ({approvedCount})
                            </button>
                        )}
                        <button
                            onClick={() => queryClient.invalidateQueries({ queryKey: ['ideas'] })}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Refresh
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="divide-y divide-slate-800">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-5 py-3 animate-pulse">
                                <div className="h-3 bg-slate-700 rounded w-24" />
                                <div className="h-3 bg-slate-700 rounded w-32" />
                                <div className="h-3 bg-slate-700 rounded flex-1" />
                                <div className="h-5 bg-slate-700 rounded w-16" />
                            </div>
                        ))}
                    </div>
                ) : sorted.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                        <Lightbulb className="w-10 h-10 mb-2 opacity-30" />
                        <p className="text-sm">No ideas yet. Upload a CSV to generate.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-700 bg-slate-800/40">
                                    {(['niche', 'mainKeyword', 'hook', 'styleEnum', 'status'] as const).map(field => (
                                        <th
                                            key={field}
                                            onClick={() => toggleSort(field)}
                                            className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-200 transition-colors select-none"
                                        >
                                            {field === 'mainKeyword' ? 'Keyword' : field === 'styleEnum' ? 'Style' : field.charAt(0).toUpperCase() + field.slice(1)}
                                            {sortField === field && <span className="ml-1 text-blue-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                                        </th>
                                    ))}
                                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {sorted.map(idea => (
                                    <tr key={idea.id} className="hover:bg-slate-800/40 transition-colors">
                                        <td className="px-4 py-3 text-slate-300 font-medium">{idea.niche}</td>
                                        <td className="px-4 py-3 text-slate-400">{idea.mainKeyword}</td>
                                        <td className="px-4 py-3 text-slate-400 max-w-xs truncate">{idea.hook}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">{idea.styleEnum}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5">
                                                <StatusBadge status={idea.status} />
                                                {idea.trademarkRisk && (
                                                    <div className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded">
                                                        <AlertTriangle className="w-3 h-3" /> Risk
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {idea.status === 'PENDING' && (
                                                    <>
                                                        <button
                                                            onClick={() => updateMutation.mutate({ id: idea.id, status: 'APPROVED' })}
                                                            className="flex items-center gap-1 px-2 py-1 bg-green-600/80 hover:bg-green-600 text-white text-xs rounded-md transition-colors"
                                                        >
                                                            <CheckCircle className="w-3 h-3" /> Approve
                                                        </button>
                                                        <button
                                                            onClick={() => updateMutation.mutate({ id: idea.id, status: 'REJECTED' })}
                                                            className="flex items-center gap-1 px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white text-xs rounded-md transition-colors"
                                                        >
                                                            <XCircle className="w-3 h-3" /> Reject
                                                        </button>
                                                    </>
                                                )}
                                                {idea.status === 'APPROVED' && (
                                                    <button
                                                        onClick={() => factoryMutation.mutate(idea.id)}
                                                        disabled={factoryMutation.isPending}
                                                        className="flex items-center gap-1 px-2 py-1 bg-blue-600/80 hover:bg-blue-600 text-white text-xs rounded-md transition-colors disabled:opacity-50"
                                                    >
                                                        {factoryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Factory className="w-3 h-3" />}
                                                        To Factory
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
