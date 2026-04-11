'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    TrendingUp, Calendar, Zap, AlertTriangle,
    RefreshCw, Loader2, ChevronRight, Tag,
    ArrowRight, Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const urgencyColors: Record<string, string> = {
    'very high': 'bg-red-500/20 text-red-400 border-red-500/30',
    'high':      'bg-orange-500/20 text-orange-400 border-orange-500/30',
    'medium':    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'low':       'bg-green-500/20 text-green-400 border-green-500/30',
};

const competitionColors: Record<string, string> = {
    'low':    'text-green-400',
    'medium': 'text-yellow-400',
    'high':   'text-red-400',
};

interface HotNiche {
    niche: string;
    reason: string;
    keywords: string[];
    urgency: string;
    competition: string;
    estimatedDemand: string;
}

interface Opportunity {
    niche: string;
    timeframe: string;
    keywords: string[];
    daysUntilPeak: number;
}

interface AvoidItem {
    niche: string;
    reason: string;
}

interface TrendsData {
    hotNiches: HotNiche[];
    upcomingOpportunities: Opportunity[];
    avoidNow: AvoidItem[];
    weeklyFocus: string;
    generatedAt: string;
    etsySuggestionsCount: number;
    month: string;
}

interface CalendarMonth {
    month: string;
    events: string[];
    niches: string[];
    urgency: string;
}

export function TrendsClient() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'weekly' | 'calendar'>('weekly');

    const { data: trends, isLoading, refetch, isRefetching } = useQuery<TrendsData>({
        queryKey: ['trends-weekly'],
        queryFn: async () => {
            const res = await fetch('/api/trends/weekly', { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch trends');
            return res.json();
        },
        staleTime: 30 * 60 * 1000, // 30 minutes cache
    });

    const { data: calendar } = useQuery<CalendarMonth[]>({
        queryKey: ['trends-seasonal'],
        queryFn: async () => {
            const res = await fetch('/api/trends/seasonal', { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch calendar');
            return res.json();
        },
        staleTime: 24 * 60 * 60 * 1000, // 24 hours cache
    });

    const handleGenerateDesign = (niche: string, keywords: string[]) => {
        const prompt = `${niche} design for t-shirt, ${keywords.slice(0, 3).join(', ')}`;
        router.push(`/dashboard/factory?prompt=${encodeURIComponent(prompt)}`);
    };

    const handleGenerateSEO = (keywords: string[]) => {
        router.push(`/dashboard/seo?keyword=${encodeURIComponent(keywords[0] || '')}`);
    };

    return (
        <div className="space-y-6 p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                        <TrendingUp className="w-6 h-6 text-green-400" />
                        Trend Analysis
                    </h1>
                    <p className="text-sm text-text-tertiary mt-1">
                        Real-time Etsy trends + seasonal opportunities for your POD business
                    </p>
                </div>
                <button
                    onClick={() => refetch()}
                    disabled={isRefetching}
                    className="flex items-center gap-2 px-4 py-2 bg-bg-elevated hover:bg-bg-overlay text-text-secondary text-sm rounded-xl border border-border-subtle transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
                    Refresh
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
                {(['weekly', 'calendar'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            'px-4 py-2 text-sm font-medium rounded-xl transition-colors',
                            activeTab === tab
                                ? 'bg-accent text-white'
                                : 'bg-bg-elevated text-text-tertiary hover:text-text-primary border border-border-subtle'
                        )}
                    >
                        {tab === 'weekly' ? '🔥 This Week' : '📅 Seasonal Calendar'}
                    </button>
                ))}
            </div>

            {/* ── Weekly Tab ─────────────────────────────────────────── */}
            {activeTab === 'weekly' && (
                <>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-24">
                            <div className="text-center space-y-3">
                                <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
                                <p className="text-text-tertiary text-sm">Analyzing Etsy trends with AI...</p>
                            </div>
                        </div>
                    ) : trends ? (
                        <div className="space-y-6">

                            {/* Weekly Focus Banner */}
                            {trends.weeklyFocus && (
                                <div className="bg-accent/5 border border-accent/20 rounded-2xl p-5">
                                    <div className="flex items-start gap-3">
                                        <Sparkles className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-1">
                                                Weekly Focus — {trends.month}
                                            </p>
                                            <p className="text-text-primary font-medium">{trends.weeklyFocus}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Hot Niches */}
                            {trends.hotNiches?.length > 0 && (
                                <div className="space-y-3">
                                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                                        <Zap className="w-4 h-4 text-yellow-400" />
                                        Hot Niches Right Now
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {trends.hotNiches.map((niche, i) => (
                                            <div key={i} className="bg-bg-elevated border border-border-subtle rounded-xl p-4 space-y-3 hover:border-border-default transition-colors">
                                                <div className="flex items-start justify-between gap-2">
                                                    <h3 className="font-semibold text-text-primary">{niche.niche}</h3>
                                                    <span className={cn(
                                                        'text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase tracking-wide flex-shrink-0',
                                                        urgencyColors[niche.urgency] || urgencyColors.medium
                                                    )}>
                                                        {niche.urgency}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-text-tertiary">{niche.reason}</p>
                                                <div className="flex items-center gap-3 text-xs">
                                                    <span className="text-text-tertiary">Competition:</span>
                                                    <span className={competitionColors[niche.competition] || 'text-text-secondary'}>
                                                        {niche.competition}
                                                    </span>
                                                    <span className="text-text-tertiary">Demand:</span>
                                                    <span className="text-green-400">{niche.estimatedDemand}</span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {niche.keywords?.slice(0, 3).map((kw, j) => (
                                                        <span key={j} className="text-[10px] px-2 py-0.5 bg-bg-overlay text-text-tertiary rounded-full font-mono border border-border-subtle">
                                                            {kw}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="flex gap-2 pt-1">
                                                    <button
                                                        onClick={() => handleGenerateDesign(niche.niche, niche.keywords)}
                                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent text-xs rounded-lg border border-accent/20 transition-colors"
                                                    >
                                                        <Sparkles className="w-3 h-3" /> Generate Design
                                                    </button>
                                                    <button
                                                        onClick={() => handleGenerateSEO(niche.keywords)}
                                                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-green-600/10 hover:bg-green-600/20 text-green-400 text-xs rounded-lg border border-green-500/20 transition-colors"
                                                    >
                                                        <Tag className="w-3 h-3" /> Generate SEO
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Upcoming Opportunities */}
                            {trends.upcomingOpportunities?.length > 0 && (
                                <div className="space-y-3">
                                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-purple-400" />
                                        Upcoming Opportunities
                                    </h2>
                                    <div className="space-y-2">
                                        {trends.upcomingOpportunities.map((opp, i) => (
                                            <div key={i} className="bg-bg-elevated border border-border-subtle rounded-xl p-4 flex items-center gap-4">
                                                <div className="text-center bg-accent/10 border border-accent/20 rounded-xl px-3 py-2 flex-shrink-0 min-w-[52px]">
                                                    <p className="text-lg font-bold text-accent">{opp.daysUntilPeak}</p>
                                                    <p className="text-[9px] text-text-tertiary uppercase">days</p>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-text-primary">{opp.niche}</p>
                                                    <p className="text-xs text-text-tertiary mt-0.5">{opp.timeframe}</p>
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {opp.keywords?.slice(0, 2).map((kw, j) => (
                                                            <span key={j} className="text-[10px] px-1.5 py-0.5 bg-bg-overlay text-text-tertiary rounded font-mono border border-border-subtle">
                                                                {kw}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleGenerateDesign(opp.niche, opp.keywords)}
                                                    className="flex-shrink-0 p-2 bg-bg-overlay hover:bg-bg-base rounded-lg border border-border-subtle transition-colors"
                                                >
                                                    <ArrowRight className="w-4 h-4 text-text-secondary" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Avoid Now */}
                            {trends.avoidNow?.length > 0 && (
                                <div className="space-y-3">
                                    <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                                        <AlertTriangle className="w-4 h-4 text-red-400" />
                                        Avoid Right Now
                                    </h2>
                                    <div className="space-y-2">
                                        {trends.avoidNow.map((item, i) => (
                                            <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-center gap-3">
                                                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-red-300">{item.niche}</p>
                                                    <p className="text-xs text-text-tertiary">{item.reason}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <p className="text-[10px] text-text-tertiary text-center">
                                Generated at {new Date(trends.generatedAt).toLocaleTimeString()} ·{' '}
                                Based on {trends.etsySuggestionsCount} real Etsy searches ·{' '}
                                Refreshes every 30 minutes
                            </p>
                        </div>
                    ) : null}
                </>
            )}

            {/* ── Calendar Tab ────────────────────────────────────────── */}
            {activeTab === 'calendar' && calendar && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {calendar.map((month, i) => {
                        const isCurrentMonth = new Date().getMonth() === i;
                        return (
                            <div key={i} className={cn(
                                'border rounded-xl p-4 space-y-3 transition-all',
                                isCurrentMonth
                                    ? 'bg-accent/5 border-accent/30'
                                    : 'bg-bg-elevated border-border-subtle'
                            )}>
                                <div className="flex items-center justify-between">
                                    <h3 className={cn(
                                        'font-semibold',
                                        isCurrentMonth ? 'text-accent' : 'text-text-primary'
                                    )}>
                                        {isCurrentMonth && '📍 '}{month.month}
                                    </h3>
                                    <span className={cn(
                                        'text-[10px] px-2 py-0.5 rounded-full border font-medium uppercase',
                                        urgencyColors[month.urgency] || urgencyColors.low
                                    )}>
                                        {month.urgency}
                                    </span>
                                </div>
                                <div className="space-y-1">
                                    {month.events.map((event, j) => (
                                        <p key={j} className="text-xs text-text-secondary flex items-center gap-1.5">
                                            <ChevronRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
                                            {event}
                                        </p>
                                    ))}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {month.niches.slice(0, 3).map((niche, j) => (
                                        <button
                                            key={j}
                                            onClick={() => handleGenerateDesign(niche, [niche + ' shirt'])}
                                            className="text-[10px] px-2 py-0.5 bg-bg-overlay hover:bg-accent/10 text-text-tertiary hover:text-accent rounded border border-border-subtle hover:border-accent/30 transition-colors"
                                        >
                                            {niche}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
