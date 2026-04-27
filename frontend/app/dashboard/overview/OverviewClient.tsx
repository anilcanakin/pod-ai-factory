'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { apiDashboard, apiStatus, apiGallery, apiFinance, apiAgent, apiBatch, BatchStatus, FinancialSummary, AgentPackage, PrepareResult, WeeklyStatDay, NicheROIItem } from '@/lib/api';
import { StatCard } from '@/components/shared/StatCard';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { truncateId, formatDate } from '@/lib/utils';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    Cpu, DollarSign, TrendingUp, Zap, Activity,
    Clock, Image as ImageIcon, Images, ThumbsUp, ExternalLink, RefreshCw,
    Scissors, Tag, Frame, Brain, Flame, BarChart3, Target, ArrowUpRight,
    ArrowDownRight, Minus, PiggyBank, Bot, Sparkles, Copy,
    CheckCheck, Loader2, PackageCheck, Rocket, ChevronDown,
    ChevronUp, Lock, Unlock, ShoppingCart, Percent, Layers, X, ChevronRight
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

function resolveUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    return `${API_BASE}/${url}`;
}

// ─── Agent Recommendations ────────────────────────────────────────────────────

function AgentRecommendations() {
    const [preparing, setPreparing] = useState<string | null>(null);
    const [results,   setResults]   = useState<Record<string, PrepareResult>>({});
    const [copied,    setCopied]    = useState<string | null>(null);
    const [expanded,  setExpanded]  = useState<string | null>(null);
    const [running,   setRunning]   = useState(false);

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['agent-packages'],
        queryFn:  () => apiAgent.getPackages(8),
        staleTime: 60000,
        refetchInterval: false,
    });

    const packages = data?.packages ?? [];

    const handleRunPipeline = async () => {
        setRunning(true);
        try {
            const res = await apiAgent.runPipeline();
            if (res.packagesCreated > 0) await refetch();
        } catch { /* silent */ }
        finally { setRunning(false); }
    };

    const handlePrepare = async (pkg: AgentPackage) => {
        setPreparing(pkg.id);
        try {
            const res = await apiAgent.preparePackage(pkg.id);
            setResults(prev => ({ ...prev, [pkg.id]: res }));
            setExpanded(pkg.id);
        } catch (err) {
            alert('Hazırlama hatası: ' + (err as Error).message);
        } finally { setPreparing(null); }
    };

    const copyToClipboard = async (text: string, key: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const confColor = (c: number) =>
        c >= 90 ? 'text-emerald-400' : c >= 80 ? 'text-blue-400' : 'text-amber-400';
    const confBg = (c: number) =>
        c >= 90 ? 'bg-emerald-500/15 border-emerald-500/30' : c >= 80 ? 'bg-blue-500/15 border-blue-500/30' : 'bg-amber-500/15 border-amber-500/30';

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-violet-400" />
                    Ajan Önerileri
                    {packages.length > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                            {packages.length} hazır
                        </span>
                    )}
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => apiAgent.triggerFullScan().catch(() => {})}
                        className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors flex items-center gap-1.5"
                    >
                        <Rocket className="w-3.5 h-3.5" /> Yeni Tarama
                    </button>
                    <button
                        onClick={handleRunPipeline}
                        disabled={running}
                        className="text-xs text-white px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Pipeline Çalıştır
                    </button>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-8 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                </div>
            ) : packages.length === 0 ? (
                <div className="bg-[#1e293b] border border-dashed border-slate-700 rounded-xl p-8 flex flex-col items-center gap-3 text-center">
                    <Bot className="w-10 h-10 text-slate-600" />
                    <div>
                        <p className="text-sm font-medium text-slate-400">Henüz hazır ilan paketi yok</p>
                        <p className="text-xs text-slate-500 mt-1">
                            WPI sayfasından tarama başlat, sonra "Pipeline Çalıştır"a bas.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {packages.map(pkg => {
                        const result   = results[pkg.id];
                        const isExpand = expanded === pkg.id;
                        const isPrep   = preparing === pkg.id;

                        return (
                            <div key={pkg.id} className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden flex flex-col">
                                {/* Card header */}
                                <div className="p-4 flex flex-col gap-3">
                                    {/* Badges */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {pkg.hotNow && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                                                <Flame className="w-2.5 h-2.5" /> HOT NOW
                                            </span>
                                        )}
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${confBg(pkg.confidence)}`}>
                                            <span className={confColor(pkg.confidence)}>%{pkg.confidence}</span>
                                        </span>
                                        {pkg.collection && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 truncate max-w-[120px]">
                                                {pkg.collection}
                                            </span>
                                        )}
                                        <span className="ml-auto text-[10px] text-slate-500">
                                            {pkg.keyword}
                                        </span>
                                    </div>

                                    {/* Design suggestion */}
                                    <p className="text-sm text-white font-medium leading-snug">
                                        {pkg.designSuggestion || pkg.seoPackage.title || pkg.title}
                                    </p>

                                    {/* Competitive edge */}
                                    {pkg.competitiveEdge && (
                                        <p className="text-xs text-slate-400 leading-relaxed">
                                            {pkg.competitiveEdge}
                                        </p>
                                    )}

                                    {/* SEO title preview */}
                                    {pkg.seoPackage.title && (
                                        <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono leading-relaxed">
                                            {pkg.seoPackage.title.slice(0, 80)}{pkg.seoPackage.title.length > 80 ? '…' : ''}
                                        </div>
                                    )}

                                    {/* Tags */}
                                    {pkg.targetKeywords.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {pkg.targetKeywords.slice(0, 4).map(kw => (
                                                <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                                                    {kw}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Prepare button */}
                                    {!result ? (
                                        <button
                                            onClick={() => handlePrepare(pkg)}
                                            disabled={isPrep}
                                            className="w-full py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
                                        >
                                            {isPrep ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /> Hazırlanıyor…</>
                                            ) : (
                                                <><PackageCheck className="w-4 h-4" /> Tüm Materyalleri Hazırla</>
                                            )}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setExpanded(isExpand ? null : pkg.id)}
                                            className="w-full py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-sm font-semibold flex items-center justify-center gap-2"
                                        >
                                            <CheckCheck className="w-4 h-4" />
                                            Hazır — {isExpand ? 'Gizle' : 'Göster'}
                                            {isExpand ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </button>
                                    )}
                                </div>

                                {/* Expanded result */}
                                {isExpand && result && (
                                    <div className="border-t border-slate-700 p-4 space-y-4 bg-slate-800/40">
                                        {/* Generated image */}
                                        <div className="flex gap-4">
                                            {result.imageUrl && (
                                                <a href={result.imageUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                                    <img
                                                        src={result.imageUrl}
                                                        alt="Generated"
                                                        className="w-24 h-24 object-cover rounded-lg border border-slate-600 hover:border-violet-500 transition-colors"
                                                    />
                                                </a>
                                            )}
                                            <div className="flex-1 space-y-2 min-w-0">
                                                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">SEO Başlık</p>
                                                <p className="text-xs text-white leading-relaxed">{result.seo.title}</p>
                                                <button
                                                    onClick={() => copyToClipboard(result.seo.title, `title-${pkg.id}`)}
                                                    className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"
                                                >
                                                    {copied === `title-${pkg.id}` ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                    {copied === `title-${pkg.id}` ? 'Kopyalandı!' : 'Kopyala'}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Tags */}
                                        {result.seo.tags.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Etiketler (13)</p>
                                                    <button
                                                        onClick={() => copyToClipboard(result.seo.tags.join(', '), `tags-${pkg.id}`)}
                                                        className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"
                                                    >
                                                        {copied === `tags-${pkg.id}` ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                        {copied === `tags-${pkg.id}` ? 'Kopyalandı!' : 'Tümünü Kopyala'}
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {result.seo.tags.map(t => (
                                                        <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 cursor-pointer hover:bg-violet-600/30" onClick={() => copyToClipboard(t, `tag-${t}`)}>
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Description */}
                                        {result.seo.description && (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Açıklama</p>
                                                    <button
                                                        onClick={() => copyToClipboard(result.seo.description, `desc-${pkg.id}`)}
                                                        className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"
                                                    >
                                                        {copied === `desc-${pkg.id}` ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                        {copied === `desc-${pkg.id}` ? 'Kopyalandı!' : 'Kopyala'}
                                                    </button>
                                                </div>
                                                <p className="text-xs text-slate-400 leading-relaxed max-h-32 overflow-y-auto">
                                                    {result.seo.description.slice(0, 400)}{result.seo.description.length > 400 ? '…' : ''}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Burn Rate Safety Bar ──────────────────────────────────────────────────────

function BurnRateBar({ dailySpend, dailyLimit, onLockChange }: { dailySpend: number; dailyLimit: number; onLockChange: (locked: boolean) => void }) {
    const [locked, setLocked] = useState(false);
    useEffect(() => {
        setLocked(localStorage.getItem('generation_locked') === 'true');
    }, []);

    const pct     = dailyLimit > 0 ? Math.min((dailySpend / dailyLimit) * 100, 100) : 0;
    const danger  = pct >= 85;
    const warn    = pct >= 60 && pct < 85;
    const barColor = danger ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-emerald-500';
    const textColor = danger ? 'text-red-400' : warn ? 'text-amber-400' : 'text-emerald-400';

    const toggleLock = () => {
        const next = !locked;
        setLocked(next);
        localStorage.setItem('generation_locked', String(next));
        onLockChange(next);
        toast(next ? '🔒 Üretim kilitlendi. Factory sayfasında uyarı gösterilecek.' : '🔓 Üretim kilidi kaldırıldı.', { duration: 3000 });
    };

    return (
        <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border ${danger ? 'border-red-500/30 bg-red-500/5' : warn ? 'border-amber-400/30 bg-amber-400/5' : 'border-slate-700 bg-[#1e293b]'}`}>
            <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Flame className={`w-3.5 h-3.5 ${textColor}`} /> Günlük Bütçe
                    </span>
                    <span className={`text-[11px] font-bold font-mono ${textColor}`}>
                        ${dailySpend.toFixed(3)} / ${dailyLimit.toFixed(2)}
                    </span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
            </div>
            <button
                onClick={toggleLock}
                title={locked ? 'Kilidi aç' : 'Üretimi kilitle'}
                className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    locked
                        ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30'
                        : 'bg-slate-700 border-slate-600 text-slate-300 hover:border-slate-500'
                }`}
            >
                {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                {locked ? 'Kilitli' : 'Kilitle'}
            </button>
        </div>
    );
}

// ─── 4 Büyük Finansal KPI ─────────────────────────────────────────────────────

function WarRoomKPIs({ finance, onAddSale }: { finance: FinancialSummary | undefined; onAddSale: () => void }) {
    const totalSales  = finance?.totalIncome   ?? 0;
    const aiCost      = finance?.totalExpenses ?? 0;
    const netProfit   = finance?.netProfit     ?? 0;
    const avgCost     = finance?.roi?.avgCostPerImage ?? 0;
    const listPrice   = finance?.roi?.listingPrice    ?? 19.99;
    const unitMargin  = listPrice - avgCost;

    const kpis = [
        {
            label: 'TOPLAM SATIŞ',
            value: `$${totalSales.toFixed(2)}`,
            icon: ShoppingCart,
            color: 'from-emerald-600/30 to-emerald-500/10 border-emerald-500/30',
            iconColor: 'text-emerald-400',
            sub: <button onClick={onAddSale} className="text-[10px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2 mt-1">+ Satış Ekle</button>,
        },
        {
            label: 'AI & API MALİYET',
            value: `$${aiCost.toFixed(3)}`,
            icon: Cpu,
            color: 'from-red-600/30 to-red-500/10 border-red-500/30',
            iconColor: 'text-red-400',
            sub: <span className="text-[10px] text-slate-500">Tüm providerlar toplamı</span>,
        },
        {
            label: 'NET KÂR',
            value: `$${Math.abs(netProfit).toFixed(2)}`,
            icon: netProfit >= 0 ? ArrowUpRight : ArrowDownRight,
            color: netProfit >= 0 ? 'from-blue-600/30 to-blue-500/10 border-blue-500/30' : 'from-orange-600/30 to-orange-500/10 border-orange-500/30',
            iconColor: netProfit >= 0 ? 'text-blue-400' : 'text-orange-400',
            sub: <span className="text-[10px] text-slate-500">{netProfit >= 0 ? 'Kâr' : 'Zarar'} — Tüm zamanlar</span>,
        },
        {
            label: 'BİRİM MARJI',
            value: avgCost > 0 ? `$${unitMargin.toFixed(2)}` : '—',
            icon: Percent,
            color: 'from-violet-600/30 to-violet-500/10 border-violet-500/30',
            iconColor: 'text-violet-400',
            sub: <span className="text-[10px] text-slate-500">{avgCost > 0 ? `$${listPrice} fiyat − $${avgCost.toFixed(3)} maliyet` : 'Onaylı görsel üretildiğinde hesaplanır'}</span>,
        },
    ];

    return (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {kpis.map(({ label, value, icon: Icon, color, iconColor, sub }) => (
                <div key={label} className={`bg-gradient-to-br ${color} border rounded-2xl p-5 flex flex-col gap-2`}>
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                        <Icon className={`w-4 h-4 ${iconColor}`} />
                    </div>
                    <span className="text-2xl font-bold font-mono text-white">{value}</span>
                    {sub}
                </div>
            ))}
        </div>
    );
}

// ─── ROI Analyzer Bar Chart ────────────────────────────────────────────────────

function NicheROIChart({ niches }: { niches: NicheROIItem[] }) {
    if (!niches.length) return null;

    const maxRevenue = Math.max(...niches.map(n => n.estimatedRevenue), 1);

    return (
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-violet-400" /> ROI Analyzer — Niş Bazında
                </h3>
                <span className="text-[10px] text-slate-500">Tahmini gelir × onaylı görsel sayısı</span>
            </div>
            <div className="space-y-3">
                {niches.map(n => {
                    const costPct    = maxRevenue > 0 ? (n.totalCost / maxRevenue) * 100 : 0;
                    const revPct     = maxRevenue > 0 ? (n.estimatedRevenue / maxRevenue) * 100 : 0;
                    const roiColor   = n.roi && n.roi >= 10 ? 'text-emerald-400' : n.roi && n.roi >= 3 ? 'text-blue-400' : 'text-amber-400';
                    const truncated  = n.niche.length > 22 ? n.niche.slice(0, 22) + '…' : n.niche;
                    return (
                        <div key={n.niche} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-300 font-medium" title={n.niche}>{truncated}</span>
                                <div className="flex items-center gap-3 text-slate-500">
                                    <span className="text-red-400/80">${n.totalCost.toFixed(3)} harcama</span>
                                    <span className="text-emerald-400/80">${n.estimatedRevenue.toFixed(2)} gelir</span>
                                    {n.roi !== null && (
                                        <span className={`font-bold ${roiColor}`}>{n.roi}×</span>
                                    )}
                                </div>
                            </div>
                            <div className="relative h-4 bg-slate-800 rounded overflow-hidden">
                                <div className="absolute left-0 top-0 h-full bg-emerald-500/40 rounded transition-all" style={{ width: `${revPct}%` }} />
                                <div className="absolute left-0 top-0 h-full bg-red-500/60 rounded transition-all" style={{ width: `${costPct}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-slate-500 pt-1 border-t border-slate-700">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/40 inline-block" /> Tahmini Gelir</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/60 inline-block" /> AI Harcama</span>
                <span className="flex items-center gap-1 ml-auto text-slate-400">ROI = tahmini gelir ÷ harcama</span>
            </div>
        </div>
    );
}

// ─── Industrial Mode Modal ────────────────────────────────────────────────────

function IndustrialModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [niche,    setNiche]    = useState('');
    const [count,    setCount]    = useState(10);
    const [engine,   setEngine]   = useState('fal-ai/flux/schnell');
    const [style,    setStyle]    = useState('minimalist');
    const [running,  setRunning]  = useState(false);
    const [batchId,  setBatchId]  = useState<string | null>(null);
    const [status,   setStatus]   = useState<BatchStatus | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = () => {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };

    const startPolling = (id: string) => {
        stopPolling();
        pollingRef.current = setInterval(async () => {
            try {
                const res = await apiBatch.getStatus(id);
                setStatus(res);
                if (res.status === 'COMPLETED' || res.status === 'FAILED') stopPolling();
            } catch (_) {}
        }, 3000);
    };

    const handleStart = async () => {
        if (!niche.trim()) { toast.error('Niş adı giriniz'); return; }
        setRunning(true);
        setBatchId(null);
        setStatus(null);
        try {
            const res = await apiBatch.generate({ niche: niche.trim(), count, engine, style });
            toast.success(`${res.imageCount} tasarım kuyruğa eklendi! Est. maliyet: $${res.projectedCost.toFixed(3)}`);
            setBatchId(res.batchJobId);
            setStatus({ batchJobId: res.batchJobId, status: 'PROCESSING', niche: res.niche, total: res.imageCount, completed: 0, failed: 0, pending: res.imageCount, progress: 0, totalCost: res.projectedCost, images: [] });
            startPolling(res.batchJobId);
        } catch (err) {
            toast.error('Hata: ' + (err as Error).message);
        } finally {
            setRunning(false);
        }
    };

    const handleClose = () => {
        stopPolling();
        onClose();
        // State'i sıfırla — kullanıcı tekrar açtığında temiz başlasın
        setTimeout(() => { setBatchId(null); setStatus(null); setNiche(''); }, 300);
    };

    if (!open) return null;

    const ENGINES = [
        { id: 'fal-ai/flux/schnell', label: 'Flux Schnell', sub: 'Hızlı · $0.003/görsel' },
        { id: 'fal-ai/flux/dev',     label: 'Flux Dev',     sub: 'Kaliteli · $0.030/görsel' },
        { id: 'fal-ai/ideogram/v3',  label: 'Ideogram 3',   sub: 'Tipografi · $0.080/görsel' },
        { id: 'fal-ai/recraft-v3',   label: 'Recraft V3',   sub: 'Vektör · $0.040/görsel' },
    ];
    const STYLES = ['minimalist','retro','bold','funny','motivational'];

    const projCost = (count * (engine === 'fal-ai/flux/schnell' ? 0.003 : engine === 'fal-ai/flux/dev' ? 0.030 : engine === 'fal-ai/ideogram/v3' ? 0.080 : 0.040) + count * 0.030).toFixed(3);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                            <Layers className="w-4 h-4 text-violet-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white">Industrial Mode</h3>
                            <p className="text-[10px] text-slate-500">Toplu Varyasyon Üretimi</p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {!batchId ? (
                        <>
                            {/* Niche input */}
                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Kazanan Niş *</label>
                                <input
                                    type="text"
                                    value={niche}
                                    onChange={e => setNiche(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleStart()}
                                    placeholder="ör. Dog Mom, Hiking Lover, Nurse Life..."
                                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
                                />
                            </div>

                            {/* Count + Engine */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Tasarım Sayısı</label>
                                    <div className="flex gap-2">
                                        {[10, 15, 20].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setCount(n)}
                                                className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${
                                                    count === n
                                                        ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                                                        : 'border-slate-600 text-slate-400 hover:border-slate-500'
                                                }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Stil</label>
                                    <select
                                        value={style}
                                        onChange={e => setStyle(e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors capitalize"
                                    >
                                        {STYLES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Engine */}
                            <div>
                                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">AI Modeli</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {ENGINES.map(e => (
                                        <button
                                            key={e.id}
                                            onClick={() => setEngine(e.id)}
                                            className={`p-2.5 rounded-xl text-left border transition-all ${
                                                engine === e.id
                                                    ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                                                    : 'border-slate-600 text-slate-400 hover:border-slate-500'
                                            }`}
                                        >
                                            <p className="text-xs font-semibold text-white">{e.label}</p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">{e.sub}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Cost estimate */}
                            <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 rounded-lg border border-slate-700">
                                <span className="text-xs text-slate-400">Tahmini toplam maliyet</span>
                                <span className="text-sm font-bold text-amber-400">${projCost}</span>
                            </div>

                            <button
                                onClick={handleStart}
                                disabled={running || !niche.trim()}
                                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity"
                            >
                                {running
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Claude varyasyonlar üretiyor...</>
                                    : <><Layers className="w-4 h-4" /> {count} Varyasyon Üret</>
                                }
                            </button>
                        </>
                    ) : (
                        /* Progress View */
                        <div className="space-y-4">
                            <div className="text-center">
                                <p className="text-sm font-semibold text-white mb-0.5">{status?.niche}</p>
                                <p className="text-xs text-slate-500">{status?.total} tasarım · Industrial Mode</p>
                            </div>

                            {/* Progress bar */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-slate-400">{status?.completed ?? 0} / {status?.total ?? 0} tamamlandı</span>
                                    <span className="text-violet-400 font-bold">{status?.progress ?? 0}%</span>
                                </div>
                                <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-500 transition-all duration-500"
                                        style={{ width: `${status?.progress ?? 0}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                    <span className="text-amber-400">{status?.pending ?? 0} bekliyor</span>
                                    {status?.failed ? <span className="text-red-400">{status.failed} hatalı</span> : null}
                                    <span>${(status?.totalCost ?? 0).toFixed(4)} harcandı</span>
                                </div>
                            </div>

                            {/* Completed thumbnails */}
                            {(status?.images?.filter(i => i.imageUrl).length ?? 0) > 0 && (
                                <div className="grid grid-cols-5 gap-1.5">
                                    {status!.images.filter(i => i.imageUrl).slice(0, 10).map(img => (
                                        <div key={img.id} className="aspect-square rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
                                            <img src={img.imageUrl!} alt={img.slogan} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {status?.status === 'COMPLETED' ? (
                                <div className="flex gap-2">
                                    <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/25 rounded-lg">
                                        <CheckCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                        <span className="text-xs text-emerald-400 font-semibold">Tamamlandı! {status.completed} tasarım hazır.</span>
                                    </div>
                                    <Link href={`/dashboard/gallery?jobId=${batchId}`} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors flex-shrink-0">
                                        Galeriye Git <ChevronRight className="w-3 h-3" />
                                    </Link>
                                </div>
                            ) : (
                                <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" /> FAL.ai&#39;ye gönderiliyor — her görsel arası 2s bekleme
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Satış Ekle Modal ─────────────────────────────────────────────────────────

function AddSaleModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (amount: number, desc: string) => void }) {
    const [amount, setAmount] = useState('');
    const [desc, setDesc]     = useState('');

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-[#1e293b] border border-slate-700 rounded-2xl p-6 w-80 space-y-4 shadow-2xl">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-emerald-400" /> Etsy Satış Kaydı
                </h3>
                <div className="space-y-3">
                    <input
                        type="number"
                        placeholder="Miktar ($)"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                    />
                    <input
                        type="text"
                        placeholder="Açıklama (opsiyonel)"
                        value={desc}
                        onChange={e => setDesc(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                    />
                </div>
                <div className="flex gap-2">
                    <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-400 text-sm hover:border-slate-500 transition-colors">İptal</button>
                    <button
                        onClick={() => { if (parseFloat(amount) > 0) { onSubmit(parseFloat(amount), desc || 'Etsy satış geliri'); onClose(); setAmount(''); setDesc(''); } }}
                        className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"
                    >
                        Kaydet
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Financial Command Center ─────────────────────────────────────────────────

function FinancialCommand({ finance }: { finance: FinancialSummary | undefined }) {
    const net      = finance?.netProfit     ?? 0;
    const burn24h  = finance?.burnRate24h   ?? 0;
    const expenses = finance?.totalExpenses ?? 0;
    const income   = finance?.totalIncome   ?? 0;
    const roi      = finance?.roi;

    const netColor = net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-slate-400';
    const NetIcon  = net > 0 ? ArrowUpRight : net < 0 ? ArrowDownRight : Minus;

    const topProvider = finance?.byProvider?.[0];

    return (
        <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <PiggyBank className="w-4 h-4 text-emerald-400" /> Mali Komuta Merkezi
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Net Profit */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Net Kâr</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">
                            Tüm zamanlara ait
                        </span>
                    </div>
                    <div className="flex items-end gap-2">
                        <NetIcon className={`w-5 h-5 flex-shrink-0 ${netColor}`} />
                        <span className={`text-2xl font-bold font-mono ${netColor}`}>
                            ${Math.abs(net).toFixed(2)}
                        </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 border-t border-slate-700 pt-3">
                        <span className="flex items-center gap-1 text-emerald-400">
                            <ArrowUpRight className="w-3 h-3" /> ${income.toFixed(2)} gelir
                        </span>
                        <span className="flex items-center gap-1 text-red-400">
                            <ArrowDownRight className="w-3 h-3" /> ${expenses.toFixed(2)} gider
                        </span>
                    </div>
                </div>

                {/* AI Burn Rate */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Yanma Hızı</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/25">
                            Son 24 saat
                        </span>
                    </div>
                    <div className="flex items-end gap-2">
                        <Flame className={`w-5 h-5 flex-shrink-0 ${burn24h > 1 ? 'text-red-400' : burn24h > 0.2 ? 'text-orange-400' : 'text-slate-500'}`} />
                        <span className="text-2xl font-bold font-mono text-white">
                            ${burn24h.toFixed(3)}
                        </span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 border-t border-slate-700 pt-3">
                        {topProvider ? (
                            <span>En büyük gider: <span className="text-slate-300 font-medium capitalize">{topProvider.provider}</span> ${topProvider.total.toFixed(3)}</span>
                        ) : (
                            <span>Henüz AI harcaması yok</span>
                        )}
                    </div>
                </div>

                {/* ROI Predictor */}
                <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ROI Tahmini</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">
                            ${roi?.listingPrice?.toFixed(2) ?? '19.99'} / ürün
                        </span>
                    </div>
                    <div className="flex items-end gap-2">
                        <Target className="w-5 h-5 flex-shrink-0 text-violet-400" />
                        {roi?.roiMultiple ? (
                            <span className="text-2xl font-bold font-mono text-violet-300">
                                {roi.roiMultiple}×
                            </span>
                        ) : (
                            <span className="text-2xl font-bold font-mono text-slate-500">—</span>
                        )}
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500 border-t border-slate-700 pt-3">
                        {roi?.avgCostPerImage && roi.avgCostPerImage > 0 ? (
                            <>
                                <span>Üretim maliyeti: <span className="text-slate-300">${roi.avgCostPerImage.toFixed(3)}/ürün</span></span>
                                <span className="text-slate-400">{roi.approvedCount} onaylı</span>
                            </>
                        ) : (
                            <span>Onaylı görsel üretildiğinde hesaplanır</span>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
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
    const [dailyLimit, setDailyLimit]       = useState(5);
    const [addSaleOpen, setAddSaleOpen]     = useState(false);
    const [industrialOpen, setIndustrialOpen] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('fal_daily_limit');
        if (stored) setDailyLimit(parseFloat(stored) || 5);
    }, []);

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

    const { data: recentGallery } = useQuery({
        queryKey: ['gallery-recent'],
        queryFn: apiGallery.getRecent,
        staleTime: 60000,
    });
    const recentMockups = (recentGallery ?? []).filter(img => img.engine === 'mockup').slice(0, 6);

    const { data: brainSummary } = useQuery({
        queryKey: ['brain-summary'],
        queryFn: async () => {
            const res = await fetch('/api/brain/summary', { credentials: 'include' });
            return res.json() as Promise<{ totalEntries: number; lastUpdated: string | null; lastCategory: string | null }>;
        },
        staleTime: 60000,
    });

    const { data: finance, refetch: refetchFinance } = useQuery({
        queryKey: ['finance-summary'],
        queryFn: apiFinance.getSummary,
        refetchInterval: 60000,
        staleTime: 30000,
    });

    const { data: nicheROI } = useQuery({
        queryKey: ['finance-niche-roi'],
        queryFn: apiFinance.getNicheROI,
        staleTime: 120000,
    });

    const addSaleMutation = useMutation({
        mutationFn: ({ amount, desc }: { amount: number; desc: string }) =>
            apiFinance.recordIncome(amount, desc),
        onSuccess: () => {
            toast.success('Satış kaydedildi!');
            refetchFinance();
        },
        onError: () => toast.error('Kayıt başarısız'),
    });

    const dailySpend = statusData?.dailySpend ?? 0;

    return (
        <div className="space-y-7 animate-fade-in">
            <AddSaleModal
                open={addSaleOpen}
                onClose={() => setAddSaleOpen(false)}
                onSubmit={(amount, desc) => addSaleMutation.mutate({ amount, desc })}
            />
            <IndustrialModal
                open={industrialOpen}
                onClose={() => setIndustrialOpen(false)}
            />

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Overview</h1>
                    <p className="text-sm text-slate-400 mt-0.5">Financial War Room · POD AI Factory</p>
                </div>
                <button
                    onClick={() => refetch()}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
            </div>

            {/* Burn Rate Progress Bar */}
            <BurnRateBar
                dailySpend={dailySpend}
                dailyLimit={dailyLimit}
                onLockChange={() => {}}
            />

            {/* 4 Big Financial KPIs */}
            <WarRoomKPIs finance={finance} onAddSale={() => setAddSaleOpen(true)} />

            {/* ROI by Niche Chart */}
            {nicheROI && nicheROI.niches.length > 0 && (
                <NicheROIChart niches={nicheROI.niches} />
            )}

            {/* KPI Cards — today's production stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
                <StatCard label="Runs Today" value={String(dash?.runsToday ?? 0)} icon={Cpu} color="blue" loading={isLoading} />
                <StatCard label="Images (24h)" value={String(dash?.imagesGeneratedToday ?? 0)} icon={ImageIcon} color="blue" loading={isLoading} />
                <StatCard label="Approved Today" value={String(dash?.approvedToday ?? 0)} icon={ThumbsUp} color="green" loading={isLoading} />
                <StatCard label="Spend Today" value={`$${dailySpend.toFixed(2)} / $${dailyLimit.toFixed(2)}`} icon={DollarSign} color="yellow" loading={isLoading} />
                <StatCard label="Success Rate" value={String(dash?.successRate ?? 0)} icon={TrendingUp} color="green" loading={isLoading} suffix="%" />
                <StatCard label="Avg Time" value={dash?.avgGenerationTime ? `${dash.avgGenerationTime}s` : '—'} icon={Clock} color="purple" loading={isLoading} />
                <StatCard label="Knowledge Entries" value={String(brainSummary?.totalEntries ?? 0)} icon={Brain} color="purple" loading={!brainSummary} />
            </div>

            {/* ── Financial Command Center ─────────────────────────────────────── */}
            <FinancialCommand finance={finance} />

            {/* ── Agent Recommendations ────────────────────────────────────────── */}
            <AgentRecommendations />

            {/* Weekly Chart */}
            {dash?.weeklyStats && dash.weeklyStats.length > 0 && (
                <WeeklyChart data={dash.weeklyStats} />
            )}

            {/* Recent Mockups */}
            {recentMockups.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Images className="w-4 h-4 text-purple-400" /> Recent Mockups
                        </h2>
                        <Link href="/dashboard/mockups" className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1">
                            View all <ExternalLink className="w-3 h-3" />
                        </Link>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                        {recentMockups.map(img => (
                            <Link
                                key={img.id}
                                href="/dashboard/mockups"
                                className="group aspect-square bg-[#1e293b] border border-slate-700 hover:border-purple-500/50 rounded-xl overflow-hidden transition-all"
                            >
                                <img
                                    src={resolveUrl(img.imageUrl)}
                                    alt="Mockup"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {/* Quick Actions */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" /> Quick Actions
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { href: '/dashboard/factory', label: 'New Generation', icon: Cpu, color: 'bg-blue-600/20 border-blue-500/30 hover:border-blue-500/60 text-blue-400' },
                        { href: '/dashboard/tools?tab=remove-bg', label: 'Remove BG', icon: Scissors, color: 'bg-emerald-600/20 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-400' },
                        { href: '/dashboard/seo', label: 'Generate SEO', icon: Tag, color: 'bg-purple-600/20 border-purple-500/30 hover:border-purple-500/60 text-purple-400' },
                        { href: '/dashboard/mockups', label: 'Upload Mockup', icon: Frame, color: 'bg-orange-600/20 border-orange-500/30 hover:border-orange-500/60 text-orange-400' },
                    ].map(({ href, label, icon: Icon, color }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${color}`}
                        >
                            <Icon className="w-5 h-5 flex-shrink-0" />
                            <span className="text-sm font-medium text-white">{label}</span>
                        </Link>
                    ))}
                    {/* Industrial Mode — Batch Generation */}
                    <button
                        onClick={() => setIndustrialOpen(true)}
                        className="flex items-center gap-3 p-4 rounded-xl border transition-all bg-violet-600/20 border-violet-500/30 hover:border-violet-500/60 text-violet-400 hover:bg-violet-600/30"
                    >
                        <Layers className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm font-medium text-white">Varyasyon Üret <span className="text-violet-400 font-bold">×10</span></span>
                    </button>
                </div>
            </div>

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
