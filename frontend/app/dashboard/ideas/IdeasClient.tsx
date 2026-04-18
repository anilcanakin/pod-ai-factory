'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiIdeas, type Idea, type MarketIntel, type MarketScoring } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { FileDropzone } from '@/components/shared/FileDropzone';
import {
    Lightbulb, Upload, RefreshCw, CheckCircle, XCircle, Factory,
    AlertTriangle, Loader2, Sparkles, TrendingUp, ShieldCheck,
    ChevronDown, ChevronUp, DollarSign, BarChart2, Globe, Target
} from 'lucide-react';

const TRENDING_NICHES = [
    'Patriotic 1776', 'Retro Nature', 'Cottagecore', 'Dark Academia', 'Vintage Sports',
];

// ── Score helpers ─────────────────────────────────────────────────────────────
function scoreColor(score: number) {
    if (score >= 70) return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/40';
    if (score >= 40) return 'text-yellow-400 bg-yellow-500/15 border-yellow-500/40';
    return 'text-red-400 bg-red-500/15 border-red-500/40';
}

function scoreRing(score: number) {
    if (score >= 70) return 'stroke-emerald-400';
    if (score >= 40) return 'stroke-yellow-400';
    return 'stroke-red-400';
}

function ScoreBadge({ score }: { score: number }) {
    const circumference = 2 * Math.PI * 14;
    const filled = (score / 100) * circumference;
    return (
        <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-bold', scoreColor(score))}>
            <svg width="22" height="22" viewBox="0 0 32 32" className="-ml-0.5">
                <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="4" />
                <circle
                    cx="16" cy="16" r="14" fill="none" strokeWidth="4"
                    className={scoreRing(score)}
                    strokeDasharray={`${filled} ${circumference}`}
                    strokeLinecap="round"
                    transform="rotate(-90 16 16)"
                />
            </svg>
            {score}
        </div>
    );
}

// ── Market Panel ──────────────────────────────────────────────────────────────
function MarketPanel({ intel, scoring }: { intel: MarketIntel; scoring: MarketScoring }) {
    return (
        <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-4 mt-2 space-y-3">
            {/* Score summary */}
            <div className="flex flex-wrap gap-4 items-start">
                <div className="flex-1 min-w-[180px]">
                    <p className="text-xs text-slate-500 mb-1">Recommendation</p>
                    <p className="text-xs text-slate-300">{scoring.recommendation}</p>
                </div>
                <div className="flex gap-4">
                    <div className="text-center">
                        <p className="text-xs text-slate-500 mb-0.5">Competition</p>
                        <span className={cn(
                            'text-xs font-semibold px-2 py-0.5 rounded',
                            intel.competitionLevel === 'Düşük' ? 'bg-emerald-500/20 text-emerald-300' :
                            intel.competitionLevel === 'Orta' ? 'bg-yellow-500/20 text-yellow-300' :
                            'bg-red-500/20 text-red-300'
                        )}>
                            {intel.competitionLevel}
                        </span>
                    </div>
                    {intel.averagePrice && (
                        <div className="text-center">
                            <p className="text-xs text-slate-500 mb-0.5">Avg Price</p>
                            <span className="text-xs font-semibold text-slate-200">${intel.averagePrice}</span>
                        </div>
                    )}
                    {intel.estimatedMonthly && (
                        <div className="text-center">
                            <p className="text-xs text-slate-500 mb-0.5">Est./Month</p>
                            <span className="text-xs font-semibold text-slate-200">~{intel.estimatedMonthly}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Strengths & Risks */}
            <div className="grid grid-cols-2 gap-3">
                {scoring.strengths?.length > 0 && (
                    <div>
                        <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">Strengths</p>
                        <ul className="space-y-0.5">
                            {scoring.strengths.map((s, i) => (
                                <li key={i} className="text-xs text-slate-400 flex items-start gap-1">
                                    <span className="text-emerald-500 mt-0.5">+</span>{s}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {scoring.risks?.length > 0 && (
                    <div>
                        <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">Risks</p>
                        <ul className="space-y-0.5">
                            {scoring.risks.map((r, i) => (
                                <li key={i} className="text-xs text-slate-400 flex items-start gap-1">
                                    <span className="text-red-500 mt-0.5">−</span>{r}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {/* Trend terms */}
            {intel.trendTerms?.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5">Etsy Trend Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                        {intel.trendTerms.slice(0, 8).map((t, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-full">{t}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Pinterest */}
            {intel.pinterestTrends?.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold text-pink-400 uppercase tracking-wider mb-1.5">Pinterest Aesthetic Signals</p>
                    <div className="flex flex-wrap gap-1.5">
                        {intel.pinterestTrends.slice(0, 5).map((t, i) => (
                            <span key={i} className="text-[10px] px-2 py-0.5 bg-pink-500/10 border border-pink-500/20 text-pink-300 rounded-full truncate max-w-[200px]">{t}</span>
                        ))}
                    </div>
                </div>
            )}

            {intel.isFallback && (
                <p className="text-[10px] text-slate-500 italic">* Score based on AI analysis only — live Apify data unavailable (APIFY_API_TOKEN not set)</p>
            )}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function IdeasClient() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const [uploading, setUploading] = useState(false);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [sortField, setSortField] = useState<keyof Idea>('status');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [nicheInput, setNicheInput] = useState('');
    const [bulkGenerating, setBulkGenerating] = useState(false);
    const [validatingIds, setValidatingIds] = useState<Set<string>>(new Set());
    const [expandedId, setExpandedId] = useState<string | null>(null);

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
            toast.success('Generating image — redirecting to Gallery...');
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
            router.push(`/dashboard/gallery?jobId=${data.jobId}`);
        },
        onError: () => toast.error('Failed to send to factory'),
    });

    const handleValidate = async (id: string) => {
        if (validatingIds.has(id)) return;
        setValidatingIds(prev => new Set([...prev, id]));
        try {
            const result = await apiIdeas.validate(id);
            toast.success(`Score: ${result.scoring.score}/100 — ${result.scoring.scoreLabel}`);
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
            setExpandedId(id); // auto-expand after validation
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Validation failed');
        } finally {
            setValidatingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

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

    const handleGenerateBulk = async () => {
        if (!nicheInput.trim()) { toast.error('Enter a niche first'); return; }
        setBulkGenerating(true);
        try {
            const result = await apiIdeas.generateBulk(nicheInput.trim());
            toast.success(result.message || '5 ideas generated!');
            queryClient.invalidateQueries({ queryKey: ['ideas'] });
            setNicheInput('');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setBulkGenerating(false);
        }
    };

    const toggleSort = (field: keyof Idea) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    };

    const sorted = [...ideas].sort((a, b) => {
        // Sort by marketScore first if that column is active, otherwise normal
        if (sortField === 'marketScore') {
            const av = a.marketScore ?? -1;
            const bv = b.marketScore ?? -1;
            return sortDir === 'asc' ? av - bv : bv - av;
        }
        const av = a[sortField] ?? '';
        const bv = b[sortField] ?? '';
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
    });

    const pendingCount = ideas.filter(i => i.status === 'PENDING').length;
    const approvedCount = ideas.filter(i => i.status === 'APPROVED').length;
    const validatedCount = ideas.filter(i => i.marketScore != null).length;

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

            {/* Generate from Niche */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
                <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" /> Generate from Niche
                </h2>
                <div>
                    <p className="text-xs text-slate-400 mb-2">Trending niches:</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {TRENDING_NICHES.map(n => (
                            <button
                                key={n}
                                onClick={() => setNicheInput(n)}
                                className={cn(
                                    'text-xs px-2.5 py-1 rounded-full border transition-colors',
                                    nicheInput === n
                                        ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-300'
                                        : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                                )}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={nicheInput}
                            onChange={e => setNicheInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleGenerateBulk()}
                            placeholder="or type a custom niche…"
                            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                        <button
                            onClick={handleGenerateBulk}
                            disabled={bulkGenerating || !nicheInput.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/40 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {bulkGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            {bulkGenerating ? 'Generating…' : 'Generate 5 Ideas'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Ideas Table */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-wrap gap-3">
                    <h2 className="text-sm font-semibold text-slate-200">
                        Generated Ideas {ideas.length > 0 && (
                            <span className="text-slate-500 font-normal ml-1">
                                ({ideas.length} total · {pendingCount} pending · {approvedCount} approved
                                {validatedCount > 0 && ` · ${validatedCount} validated`})
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
                                    {/* Score column header */}
                                    <th
                                        onClick={() => toggleSort('marketScore')}
                                        className="text-center px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-200 transition-colors select-none"
                                    >
                                        Score
                                        {sortField === 'marketScore' && <span className="ml-1 text-blue-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                                    </th>
                                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {sorted.map(idea => {
                                    const isValidating = validatingIds.has(idea.id);
                                    const isExpanded = expandedId === idea.id;
                                    const marketData = idea.marketData as (typeof idea.marketData & { intel: Parameters<typeof MarketPanel>[0]['intel']; scoring: Parameters<typeof MarketPanel>[0]['scoring'] }) | null | undefined;
                                    return (
                                        <React.Fragment key={idea.id}>
                                            <tr className="hover:bg-slate-800/40 transition-colors">
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
                                                {/* Score cell */}
                                                <td className="px-4 py-3 text-center">
                                                    {idea.marketScore != null ? (
                                                        <button
                                                            onClick={() => setExpandedId(isExpanded ? null : idea.id)}
                                                            className="inline-flex items-center gap-1"
                                                            title="Click to toggle market details"
                                                        >
                                                            <ScoreBadge score={idea.marketScore} />
                                                            {isExpanded
                                                                ? <ChevronUp className="w-3 h-3 text-slate-500" />
                                                                : <ChevronDown className="w-3 h-3 text-slate-500" />
                                                            }
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-slate-600">—</span>
                                                    )}
                                                </td>
                                                {/* Actions */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {/* Validate button — always available */}
                                                        <button
                                                            onClick={() => handleValidate(idea.id)}
                                                            disabled={isValidating}
                                                            title="Run market validation (Apify + Claude scoring)"
                                                            className={cn(
                                                                'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
                                                                idea.marketScore != null
                                                                    ? 'bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-600'
                                                                    : 'bg-violet-600/80 hover:bg-violet-600 text-white'
                                                            )}
                                                        >
                                                            {isValidating
                                                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                                                : <ShieldCheck className="w-3 h-3" />
                                                            }
                                                            {isValidating ? 'Validating…' : idea.marketScore != null ? 'Re-validate' : 'Validate'}
                                                        </button>

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
                                            {/* Expandable market detail panel */}
                                            {isExpanded && marketData && (
                                                <tr className="bg-slate-900/40">
                                                    <td colSpan={7} className="px-4 pb-4 pt-0">
                                                        <MarketPanel intel={marketData.intel} scoring={marketData.scoring} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
