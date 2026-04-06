'use client';

import { useQuery } from '@tanstack/react-query';
import { apiDashboard, apiStatus, WeeklyStatDay } from '@/lib/api';
import { StatCard } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { truncateId, formatDate } from '@/lib/utils';
import Link from 'next/link';
import {
    Cpu, CheckCircle, DollarSign, TrendingUp, Zap, Eye, Activity,
    Clock, Image as ImageIcon, Images, ThumbsUp, ExternalLink, RefreshCw
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

function resolveUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${API_BASE}/${url}`;
}

function WeeklyChart({ data }: { data: WeeklyStatDay[] }) {
    const maxImages = Math.max(...data.map(d => d.images), 1);
    return (
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" /> Last 7 Days
            </h2>
            <div className="flex items-end gap-2 h-24">
                {data.map(day => {
                    const pct = Math.round((day.images / maxImages) * 100);
                    const label = new Date(day.date + 'T12:00:00').toLocaleDateString('en', { weekday: 'short' });
                    return (
                        <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                            <div className="relative w-full flex flex-col justify-end" style={{ height: '72px' }}>
                                <div
                                    className="w-full rounded-t bg-blue-600/70 group-hover:bg-blue-500 transition-colors relative"
                                    style={{ height: `${Math.max(pct, 4)}%` }}
                                    title={`${day.images} images · ${day.approved} approved · $${day.spend.toFixed(3)}`}
                                >
                                    {day.approved > 0 && (
                                        <div
                                            className="absolute bottom-0 left-0 right-0 bg-emerald-500/70 rounded-t"
                                            style={{ height: `${Math.round((day.approved / Math.max(day.images, 1)) * 100)}%` }}
                                        />
                                    )}
                                </div>
                            </div>
                            <span className="text-[9px] text-slate-500">{label}</span>
                            <span className="text-[9px] text-slate-400 font-medium">{day.images}</span>
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-600/70 inline-block" /> Generated</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" /> Approved</span>
            </div>
        </div>
    );
}

export function OverviewClient() {
    const { data: dash, isLoading, refetch } = useQuery({
        queryKey: ['dashboard'],
        queryFn: apiDashboard.get,
        refetchInterval: 30000,
        staleTime: 10000,
    });

    const { data: statusData } = useQuery({
        queryKey: ['status'],
        queryFn: apiStatus.get,
        refetchInterval: 15000,
        staleTime: 10000,
    });

    return (
        <div className="space-y-7 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Overview</h1>
                    <p className="text-sm text-slate-400 mt-0.5">POD AI Factory · Performance at a glance</p>
                </div>
                <button
                    onClick={() => refetch()}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
            </div>

            {/* KPI Cards — today's production stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard label="Runs Today" value={String(dash?.runsToday ?? 0)} icon={Cpu} color="blue" loading={isLoading} />
                <StatCard label="Images (24h)" value={String(dash?.imagesGeneratedToday ?? 0)} icon={ImageIcon} color="blue" loading={isLoading} />
                <StatCard label="Approved Today" value={String(dash?.approvedToday ?? 0)} icon={ThumbsUp} color="green" loading={isLoading} />
                <StatCard label="Spend Today" value={`$${(statusData?.dailySpend ?? 0).toFixed(2)}`} icon={DollarSign} color="yellow" loading={isLoading} />
                <StatCard label="Success Rate" value={String(dash?.successRate ?? 0)} icon={TrendingUp} color="green" loading={isLoading} suffix="%" />
                <StatCard label="Avg Time" value={dash?.avgGenerationTime ? `${dash.avgGenerationTime}s` : '—'} icon={Clock} color="purple" loading={isLoading} />
            </div>

            {/* Weekly Chart */}
            {dash?.weeklyStats && dash.weeklyStats.length > 0 && (
                <WeeklyChart data={dash.weeklyStats} />
            )}

            {/* Projects Grid */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Your Projects</h2>
                    <Link href="/dashboard/factory" className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-blue-900/20">
                        <Zap className="w-4 h-4" /> New Project
                    </Link>
                </div>

                {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {[...Array(8)].map((_, i) => (
                            <div key={i} className="bg-[#1e293b] rounded-xl aspect-[4/3] animate-pulse border border-slate-700" />
                        ))}
                    </div>
                ) : !dash?.recentJobs?.length ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-[#1e293b] border border-slate-700 rounded-xl border-dashed">
                        <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
                            <Images className="w-8 h-8 text-blue-400" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
                        <p className="text-sm text-slate-400 mb-6 text-center max-w-sm">
                            Create your first project to start generating designs, extracting prompts, and building mockups automatically.
                        </p>
                        <Link href="/dashboard/factory" className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
                            <Zap className="w-4 h-4" /> Start First Project
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
                        {dash.recentJobs.map(job => (
                            <Link
                                key={job.id}
                                href={`/dashboard/gallery?jobId=${job.id}`}
                                className="group flex flex-col bg-[#1e293b] border border-slate-700 hover:border-blue-500/50 rounded-xl overflow-hidden transition-all hover:shadow-xl hover:shadow-blue-900/10"
                            >
                                {/* Thumbnail */}
                                <div className="aspect-square w-full relative bg-slate-800 border-b border-slate-700 overflow-hidden">
                                    <img
                                        src={resolveUrl(job.previewUrl) || resolveUrl(job.originalImage)}
                                        alt="Reference Thumbnail"
                                        className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-transform group-hover:scale-105"
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                    <div className="absolute inset-0 ring-1 ring-inset ring-black/10" />
                                </div>

                                {/* Card Body */}
                                <div className="p-4 flex flex-col gap-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-xs font-mono text-slate-300 truncate">Run • {truncateId(job.id)}</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">{formatDate(job.createdAt)}</p>
                                        </div>
                                        <div className="shrink-0 scale-90 origin-top-right">
                                            <StatusBadge status={job.status} />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/50">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                            <ImageIcon className="w-3.5 h-3.5" />
                                            <span>{job.imageCount} imgs</span>
                                        </div>
                                        <div className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">
                                            ${(job.spend || 0).toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
