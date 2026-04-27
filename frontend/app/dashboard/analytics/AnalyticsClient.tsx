'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiAnalytics, apiDashboard, type PerformanceRecord } from '@/lib/api';
import { toast } from 'sonner';
import { cn, formatNumber, truncateId } from '@/lib/utils';
import { StatCard } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { FileDropzone } from '@/components/shared/FileDropzone';
import {
    BarChart3, Eye, MousePointerClick, Heart, ShoppingBag,
    DollarSign, TrendingUp, Upload, Loader2, ChevronUp, ChevronDown,
    Trophy, FileDown, ArrowUp, ArrowDown
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
function resolveUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${API_BASE}/${url}`;
}

type SortDir = 'asc' | 'desc';

export function AnalyticsClient({ onSendToBrainstorm }: { onSendToBrainstorm?: (nicheOrTitle: string) => void }) {
    const queryClient = useQueryClient();
    const [uploading, setUploading] = useState(false);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [sortField, setSortField] = useState<keyof PerformanceRecord>('score');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const { data: performances = [], isLoading } = useQuery({
        queryKey: ['analytics', 'performance'],
        queryFn: apiAnalytics.getPerformance,
        staleTime: 60000,
    });

    const { data: dash } = useQuery({
        queryKey: ['dashboard'],
        queryFn: apiDashboard.get,
        staleTime: 60000,
    });

    const handleImport = async () => {
        if (!csvFile) { toast.error('Select a CSV file first'); return; }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', csvFile);
            const result = await apiAnalytics.import(fd);
            toast.success(result.message || 'Stats imported!');
            queryClient.invalidateQueries({ queryKey: ['analytics'] });
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Import failed');
        } finally {
            setUploading(false);
        }
    };

    const toggleSort = (field: keyof PerformanceRecord) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('desc'); }
    };

    const sorted = [...performances].sort((a, b) => {
        const av = a[sortField] as number | string;
        const bv = b[sortField] as number | string;
        const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
    });

    const totalImpressions = performances.reduce((s, p) => s + p.impressions, 0);
    const totalVisits = performances.reduce((s, p) => s + p.visits, 0);
    const totalFavorites = performances.reduce((s, p) => s + p.favorites, 0);
    const totalOrders = performances.reduce((s, p) => s + p.orders, 0);
    const conversionRate = totalVisits > 0 ? ((totalOrders / totalVisits) * 100).toFixed(1) : '0';

    // Top listing by score
    const topListing = performances.length > 0
        ? performances.reduce((best, p) => p.score > best.score ? p : best, performances[0])
        : null;

    // Cost per approved image from weekly stats
    const weeklyStats = dash?.weeklyStats ?? [];
    const totalWeeklySpend = weeklyStats.reduce((s, d) => s + d.spend, 0);
    const totalWeeklyApproved = weeklyStats.reduce((s, d) => s + d.approved, 0);
    const costPerApproved = totalWeeklyApproved > 0 ? `$${(totalWeeklySpend / totalWeeklyApproved).toFixed(3)}` : '—';

    // This week vs last week (from weekly stats last 14 days)
    const thisWeekImages = weeklyStats.slice(-7).reduce((s, d) => s + d.images, 0);
    const lastWeekImages = weeklyStats.slice(-14, -7).reduce((s, d) => s + d.images, 0);
    const weeklyDiffPct = lastWeekImages > 0
        ? Math.round(((thisWeekImages - lastWeekImages) / lastWeekImages) * 100)
        : null;

    // CSV export
    const exportCSV = () => {
        const headers = ['SKU', 'Impressions', 'Visits', 'Favorites', 'Orders', 'Score', 'Flag'];
        const rows = sorted.map(p => [
            p.sku || p.imageId, p.impressions, p.visits,
            p.favorites, p.orders, p.score, p.flag || ''
        ].join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const SortIcon = ({ field }: { field: keyof PerformanceRecord }) => {
        if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-30" />;
        return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />;
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-white">Analytics</h1>
                <p className="text-sm text-slate-400 mt-0.5">Etsy performance feedback loop — upload CSV to update scores</p>
            </div>

            {/* Upload + KPI row */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
                {/* Upload card */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-3">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-blue-400" /> Import Etsy CSV
                    </h2>
                    <FileDropzone onFile={setCsvFile} accept=".csv" label="Drop Etsy analytics CSV" />
                    <button
                        onClick={handleImport}
                        disabled={uploading || !csvFile}
                        className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? 'Importing…' : 'Import Stats'}
                    </button>
                </div>

                {/* KPI cards */}
                <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Impressions" value={formatNumber(totalImpressions)} icon={Eye} color="blue" loading={isLoading} />
                    <StatCard label="Visits" value={formatNumber(totalVisits)} icon={MousePointerClick} color="blue" loading={isLoading} />
                    <StatCard label="Favorites" value={formatNumber(totalFavorites)} icon={Heart} color="purple" loading={isLoading} />
                    <StatCard label="Orders" value={formatNumber(totalOrders)} icon={ShoppingBag} color="green" loading={isLoading} />
                </div>
            </div>

            {/* Extra stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="Conversion Rate" value={conversionRate} icon={TrendingUp} color="green" loading={isLoading} suffix="%" />
                <StatCard label="Cost / Approved" value={costPerApproved} icon={DollarSign} color="yellow" loading={false} />
                <StatCard label="ROI Estimate" value="—" icon={TrendingUp} color="purple" loading={false} />
            </div>

            {/* Insights row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Best performing listing */}
                <div className="bg-[#1e293b] border border-yellow-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Trophy className="w-4 h-4 text-yellow-400" />
                        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Best Listing</h3>
                    </div>
                    {topListing ? (
                        <div>
                            <p className="text-sm font-mono text-slate-200 truncate">{topListing.sku || truncateId(topListing.imageId)}</p>
                            <p className="text-xs text-slate-500 mt-1">Score <span className="text-yellow-400 font-bold">{topListing.score}</span> · {topListing.orders} orders · {formatNumber(topListing.impressions)} impr.</p>
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500">No data yet</p>
                    )}
                </div>

                {/* This week vs last week */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <BarChart3 className="w-4 h-4 text-blue-400" />
                        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">This Week vs Last</h3>
                    </div>
                    <div className="flex items-end gap-2">
                        <span className="text-2xl font-bold text-slate-200">{thisWeekImages}</span>
                        <span className="text-xs text-slate-500 mb-1">images</span>
                        {weeklyDiffPct !== null && (
                            <span className={cn(
                                'flex items-center gap-0.5 text-xs font-medium mb-1',
                                weeklyDiffPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                            )}>
                                {weeklyDiffPct >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                {Math.abs(weeklyDiffPct)}%
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Last week: {lastWeekImages} images</p>
                </div>

                {/* Export CSV */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <FileDown className="w-4 h-4 text-green-400" />
                            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Export Analytics</h3>
                        </div>
                        <p className="text-xs text-slate-500">{performances.length} records as CSV</p>
                    </div>
                    <button
                        onClick={exportCSV}
                        disabled={performances.length === 0}
                        className="mt-3 w-full flex items-center justify-center gap-2 py-2 bg-green-700/80 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                        <FileDown className="w-3.5 h-3.5" /> Download CSV
                    </button>
                </div>
            </div>

            {/* Performance Table */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-200">
                        Product Performance {performances.length > 0 && <span className="text-slate-500 font-normal ml-1">({performances.length})</span>}
                    </h2>
                    <p className="text-xs text-slate-500">Click column headers to sort</p>
                </div>

                {isLoading ? (
                    <div className="divide-y divide-slate-800">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-5 py-3 animate-pulse">
                                <div className="w-10 h-10 bg-slate-700 rounded-lg" />
                                <div className="flex-1 space-y-1.5">
                                    <div className="h-3 bg-slate-700 rounded w-24" />
                                    <div className="h-2.5 bg-slate-700 rounded w-16" />
                                </div>
                                {[...Array(5)].map((_, j) => <div key={j} className="h-3 bg-slate-700 rounded w-12" />)}
                            </div>
                        ))}
                    </div>
                ) : sorted.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                        <BarChart3 className="w-10 h-10 mb-2 opacity-30" />
                        <p className="text-sm">No analytics data. Import an Etsy CSV to begin.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-700 bg-slate-800/40">
                                    <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Image</th>
                                    {([
                                        { key: 'sku', label: 'SKU' },
                                        { key: 'impressions', label: 'Impressions' },
                                        { key: 'visits', label: 'Visits' },
                                        { key: 'favorites', label: 'Favorites' },
                                        { key: 'orders', label: 'Orders' },
                                        { key: 'score', label: 'Score' },
                                        { key: 'flag', label: 'Flag' },
                                    ] as const).map(col => (
                                        <th
                                            key={col.key}
                                            onClick={() => toggleSort(col.key as keyof PerformanceRecord)}
                                            className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-200 transition-colors select-none"
                                        >
                                            <div className="flex items-center gap-1">
                                                {col.label} <SortIcon field={col.key as keyof PerformanceRecord} />
                                            </div>
                                        </th>
                                    ))}
                                    <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {sorted.map(p => (
                                    <tr key={p.id} className={cn('hover:bg-slate-800/40 transition-colors', p.flag === 'WINNER' && 'bg-yellow-500/5')}>
                                        <td className="px-4 py-3">
                                            <div className="w-10 h-10 rounded-lg bg-slate-700 overflow-hidden">
                                                {p.imageUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={resolveUrl(p.imageUrl)} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-600 text-[10px]">IMG</div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-slate-300 font-mono text-xs">{p.sku || truncateId(p.imageId)}</td>
                                        <td className="px-4 py-3 text-slate-300 tabular-nums">{formatNumber(p.impressions)}</td>
                                        <td className="px-4 py-3 text-slate-300 tabular-nums">{formatNumber(p.visits)}</td>
                                        <td className="px-4 py-3 text-slate-300 tabular-nums">{formatNumber(p.favorites)}</td>
                                        <td className="px-4 py-3 text-slate-300 tabular-nums font-medium">{p.orders}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-sm font-bold text-slate-200 tabular-nums">{p.score}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusBadge status={p.flag || 'PENDING'} />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {p.flag === 'WINNER' && (
                                                <a
                                                    href={`/dashboard/factory`}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-yellow-600/80 hover:bg-yellow-600 text-white text-xs rounded-lg transition-colors ml-auto w-fit"
                                                >
                                                    <TrendingUp className="w-3 h-3" /> Scale Winner
                                                </a>
                                            )}
                                            {(p.score < 50 || p.flag === 'LOSER') && onSendToBrainstorm && (
                                                <button
                                                    onClick={() => onSendToBrainstorm(p.sku || p.imageId)}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors ml-auto w-fit border border-red-500/20"
                                                    title="Send to Brainstorm as Negative Constraint"
                                                >
                                                    <ArrowDown className="w-3 h-3" /> Exclude
                                                </button>
                                            )}
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
