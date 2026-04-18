'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Target, Zap, TrendingUp, CheckCircle2, XCircle,
    RotateCcw, ChevronDown, ChevronUp, Loader2,
    ShoppingBag, Sparkles, Trophy, AlertCircle,
    ArrowRight, Brain, Tag, Palette
} from 'lucide-react';
import { apiWpi, WpiCard, WpiScanResult, WpiCollection, WpiScanProgress } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Yardımcı bileşenler ──────────────────────────────────────────────────────

function Badge({ children, variant = 'default' }: {
    children: React.ReactNode;
    variant?: 'default' | 'high' | 'normal' | 'baseline' | 'trending' | 'approved' | 'rejected';
}) {
    const styles: Record<string, string> = {
        default:  'bg-slate-700/60 text-slate-300',
        high:     'bg-red-500/20 text-red-400 border border-red-500/30',
        normal:   'bg-blue-500/20 text-blue-400 border border-blue-500/30',
        baseline: 'bg-slate-600/40 text-slate-400 border border-slate-600/40',
        trending: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
        approved: 'bg-green-500/20 text-green-400 border border-green-500/30',
        rejected: 'bg-red-500/10 text-red-500/70',
    };
    return (
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider', styles[variant])}>
            {children}
        </span>
    );
}

function ConfidenceMeter({ value }: { value: number }) {
    const color = value >= 90 ? 'bg-emerald-500' : value >= 80 ? 'bg-violet-500' : 'bg-amber-500';
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
            </div>
            <span className="text-xs font-bold text-text-primary tabular-nums w-8 text-right">{value}%</span>
        </div>
    );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({ card, onApprove, onReject, onApproveFactory }: {
    card: WpiCard;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onApproveFactory: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState<'approve' | 'factory' | 'reject' | null>(null);
    const ac = card.actionCard;
    const td = card.trendData;
    const bc = card.brainComparison;

    const handle = async (action: 'approve' | 'factory' | 'reject') => {
        setLoading(action);
        try {
            if (action === 'reject') await onReject(card.id);
            else if (action === 'factory') await onApproveFactory(card.id);
            else await onApprove(card.id);
        } finally {
            setLoading(null);
        }
    };

    if (card.status === 'APPROVED') return (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div className="min-w-0">
                <p className="text-sm font-medium text-green-400 truncate">{card.product.title}</p>
                <p className="text-xs text-text-tertiary">Onaylandı{card.actionCard.collection ? ` → ${card.actionCard.collection}` : ''}</p>
            </div>
        </div>
    );

    if (card.status === 'REJECTED') return (
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-4 flex items-center gap-3 opacity-50">
            <XCircle className="w-5 h-5 text-slate-500 flex-shrink-0" />
            <p className="text-sm text-slate-500 truncate">{card.product.title}</p>
        </div>
    );

    const isInstant = ac.actionType === 'IMMEDIATE_ACTION';

    return (
        <div className={cn(
            'rounded-xl border transition-all duration-200',
            isInstant
                ? 'border-orange-500/50 bg-orange-500/5 hover:border-orange-500/70'
                : ac.priority === 'HIGH'
                    ? 'border-violet-500/40 bg-violet-500/5 hover:border-violet-500/60'
                    : 'border-border-default bg-bg-elevated hover:border-border-subtle'
        )}>
            {/* IMMEDIATE ACTION banner */}
            {isInstant && (
                <div className="px-4 py-1.5 bg-orange-500/15 border-b border-orange-500/20 flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                    <span className="text-[11px] font-bold text-orange-400 uppercase tracking-wider">Instant Intelligence — Hemen Üret</span>
                </div>
            )}

            {/* Kart başlığı */}
            <div className="p-4">
                <div className="flex items-start gap-3">
                    {/* Ürün görseli */}
                    {card.product.imageUrl ? (
                        <img
                            src={card.product.imageUrl}
                            alt={card.product.title}
                            className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-border-subtle"
                        />
                    ) : (
                        <div className="w-14 h-14 rounded-lg bg-slate-700/40 flex items-center justify-center flex-shrink-0">
                            <ShoppingBag className="w-6 h-6 text-slate-500" />
                        </div>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {isInstant ? (
                                <Badge variant="high">⚡ IMMEDIATE</Badge>
                            ) : (
                                <Badge variant={ac.priority === 'HIGH' ? 'high' : 'normal'}>{ac.priority}</Badge>
                            )}
                            {/* Instant signals */}
                            {isInstant && ac.instantSignals?.map(s => {
                                if (s === 'BEST_SELLER')      return <Badge key={s} variant="trending">🏅 Best Seller</Badge>;
                                if (s === 'POPULAR_NOW')      return <Badge key={s} variant="trending">🔥 Popular Now</Badge>;
                                if (s.startsWith('IN_CART_')) return <Badge key={s} variant="normal">🛒 {s.replace('IN_CART_', '')} Sepette</Badge>;
                                return null;
                            })}
                            {!isInstant && td.trendPeriod === 'BASELINE' && <Badge variant="baseline">Baseline</Badge>}
                            {!isInstant && td.isTrending && <Badge variant="trending">↑ Trend</Badge>}
                            {ac.collection && (
                                <Badge variant="default">🏆 {ac.collection.split(' ').slice(0, 2).join(' ')}</Badge>
                            )}
                        </div>

                        <p className="text-sm font-semibold text-text-primary line-clamp-2 mb-2">
                            {card.product.title}
                        </p>

                        <div className="flex items-center gap-3 text-xs text-text-tertiary mb-3">
                            <span className="flex items-center gap-1">
                                <ShoppingBag className="w-3 h-3" />
                                {td.salesCount} satış
                                {td.salesDelta > 0 && (
                                    <span className="text-emerald-400 font-semibold ml-0.5">+{td.salesDelta}</span>
                                )}
                            </span>
                            <span>${card.product.price}</span>
                            <span className="truncate">{card.product.shopName}</span>
                        </div>

                        {/* Brain confidence */}
                        <ConfidenceMeter value={bc.confidence} />
                    </div>
                </div>

                {/* Action card içeriği */}
                <div className="mt-3 space-y-2 text-xs">
                    <p className="text-text-secondary">{ac.competitorAnalysis}</p>
                    <p className={cn('font-medium', isInstant ? 'text-orange-300' : 'text-violet-300')}>{ac.designSuggestion}</p>
                    {ac.differentiationAngle && (
                        <p className="text-blue-300 font-medium">💡 {ac.differentiationAngle}</p>
                    )}
                    <p className="text-accent font-semibold">{ac.action}</p>
                </div>

                {/* INSTANT: tek buton — hemen fabrikaya gönder */}
                {isInstant ? (
                    <div className="flex items-center gap-2 mt-4">
                        <button
                            onClick={() => handle('factory')}
                            disabled={!!loading}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white text-xs font-bold transition-all disabled:opacity-50"
                        >
                            {loading === 'factory' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                            Hemen Üret → Factory
                        </button>
                        <button
                            onClick={() => handle('approve')}
                            disabled={!!loading}
                            className="px-3 py-2.5 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-semibold border border-green-600/30 transition-all disabled:opacity-50"
                            title="Onayla (fabrikaya otomatik gönderilir)"
                        >
                            {loading === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✓'}
                        </button>
                        <button
                            onClick={() => handle('reject')}
                            disabled={!!loading}
                            className="px-3 py-2.5 rounded-lg bg-slate-700/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-semibold border border-slate-600/30 hover:border-red-500/20 transition-all disabled:opacity-50"
                        >
                            {loading === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✕'}
                        </button>
                        <button
                            onClick={() => setExpanded(v => !v)}
                            className="px-2 py-2.5 rounded-lg bg-slate-700/30 text-slate-400 text-xs transition-all"
                        >
                            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                ) : (
                /* TREND: üç buton */
                <div className="flex items-center gap-2 mt-4">
                    <button
                        onClick={() => handle('factory')}
                        disabled={!!loading}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
                    >
                        {loading === 'factory' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        Factory'ye Gönder
                    </button>
                    <button
                        onClick={() => handle('approve')}
                        disabled={!!loading}
                        className="px-3 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-semibold border border-green-600/30 transition-all disabled:opacity-50"
                    >
                        {loading === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✓ Onayla'}
                    </button>
                    <button
                        onClick={() => handle('reject')}
                        disabled={!!loading}
                        className="px-3 py-2 rounded-lg bg-slate-700/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-semibold border border-slate-600/30 hover:border-red-500/20 transition-all disabled:opacity-50"
                    >
                        {loading === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✕'}
                    </button>
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="px-2 py-2 rounded-lg bg-slate-700/30 text-slate-400 text-xs transition-all"
                    >
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                </div>
                )}

                {/* Genişletilmiş detaylar */}
                {expanded && (
                    <div className="mt-3 pt-3 border-t border-border-subtle space-y-3">
                        {bc.reasoning && (
                            <div className="flex gap-2">
                                <Brain className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-text-secondary">{bc.reasoning}</p>
                            </div>
                        )}
                        {bc.competitiveEdge && (
                            <div className="flex gap-2">
                                <Trophy className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-text-secondary">{bc.competitiveEdge}</p>
                            </div>
                        )}
                        {ac.colorPalette && (
                            <div className="flex gap-2 items-center">
                                <Palette className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
                                <p className="text-xs text-text-secondary font-mono">{ac.colorPalette}</p>
                            </div>
                        )}
                        {ac.targetKeywords?.length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                                <Tag className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                                {ac.targetKeywords.map(kw => (
                                    <span key={kw} className="text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded-full">{kw}</span>
                                ))}
                            </div>
                        )}
                        <a
                            href={card.product.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors"
                        >
                            Rakip listinge git <ArrowRight className="w-3 h-3" />
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Ana Sayfa ────────────────────────────────────────────────────────────────

const SUGGESTED_KEYWORDS = [
    '4th of July 250th Anniversary',
    'FIFA World Cup 2026',
    'Mothers Day gift',
    'minimalist wall art',
    'patriotic poster print',
    'halloween gothic aesthetic',
];

export function WpiClient() {
    const [keywordInput, setKeywordInput]   = useState('');
    const [keywords, setKeywords]           = useState<string[]>([]);
    const [saveWinners, setSaveWinners]     = useState(true);
    const [maxPerKw, setMaxPerKw]           = useState(50);
    const [scanning, setScanning]           = useState(false);
    const [scanId, setScanId]               = useState<string | null>(null);
    const [scanProgress, setScanProgress]   = useState<WpiScanProgress | null>(null);
    const [scanResult, setScanResult]       = useState<WpiScanResult | null>(null);
    const [scanError, setScanError]         = useState<string | null>(null);

    const [cards, setCards]                 = useState<WpiCard[]>([]);
    const [cardsLoading, setCardsLoading]   = useState(true);
    const [statusFilter, setStatusFilter]   = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');

    const [collections, setCollections]     = useState<WpiCollection[]>([]);

    // Mevcut action card'larını yükle
    const loadCards = useCallback(async () => {
        setCardsLoading(true);
        try {
            const res = await apiWpi.listActionCards(statusFilter, 50);
            setCards(res.cards);
        } catch (e: any) {
            console.error('WPI cards load error:', e.message);
        } finally {
            setCardsLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { loadCards(); }, [loadCards]);

    useEffect(() => {
        apiWpi.collections().then(r => setCollections(r.collections)).catch(() => {});
    }, []);

    // Keyword chip ekle/çıkar
    const addKeyword = (kw: string) => {
        const clean = kw.trim();
        if (clean && !keywords.includes(clean)) setKeywords(prev => [...prev, clean]);
    };

    const removeKeyword = (kw: string) => setKeywords(prev => prev.filter(k => k !== kw));

    const handleKeywordInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addKeyword(keywordInput);
            setKeywordInput('');
        }
    };

    // Scan başlat — async poll pattern
    const runScan = async () => {
        if (!keywords.length) return;
        setScanning(true);
        setScanError(null);
        setScanResult(null);
        setScanProgress(null);
        setScanId(null);

        try {
            // 1. Başlat — backend hemen scanId döner
            const start = await apiWpi.startScan(keywords, { saveWinners, maxPerKeyword: maxPerKw });
            setScanId(start.scanId);

            // 2. Poll — her 3 saniyede bir durum sorgula
            await new Promise<void>((resolve, reject) => {
                const interval = setInterval(async () => {
                    try {
                        const poll = await apiWpi.pollScan(start.scanId);

                        if (poll.status === 'running' && poll.progress) {
                            setScanProgress(poll.progress);
                        } else if (poll.status === 'done' && poll.result) {
                            clearInterval(interval);
                            setScanProgress(null);
                            setScanResult(poll.result);
                            if (poll.result.actionCards.length > 0) loadCards();
                            resolve();
                        } else if (poll.status === 'error') {
                            clearInterval(interval);
                            reject(new Error(poll.error || 'Scan başarısız'));
                        }
                    } catch (pollErr: any) {
                        clearInterval(interval);
                        reject(pollErr);
                    }
                }, 3000);
            });
        } catch (e: any) {
            setScanError(e.message);
        } finally {
            setScanning(false);
            setScanProgress(null);
        }
    };

    // Card işlemleri
    const handleApprove = async (id: string) => {
        // IMMEDIATE_ACTION kartlar otomatik fabrikaya gider (backend halleder)
        await apiWpi.approve(id, false);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'APPROVED' } : c));
    };

    const handleApproveFactory = async (id: string) => {
        await apiWpi.approve(id, true);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'APPROVED' } : c));
    };

    const handleReject = async (id: string) => {
        await apiWpi.reject(id);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'REJECTED' } : c));
    };

    const immediateCount = cards.filter(c => c.status === 'PENDING' && c.actionCard?.actionType === 'IMMEDIATE_ACTION').length;

    const pendingCount = cards.filter(c => c.status === 'PENDING').length;
    const highPriorityCount = cards.filter(c => c.status === 'PENDING' && c.actionCard.priority === 'HIGH').length;

    return (
        <div className="p-6 space-y-6 max-w-[1400px]">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2.5">
                        <Target className="w-6 h-6 text-accent" />
                        Winning Product Intelligence
                    </h1>
                    <p className="text-sm text-text-tertiary mt-1">
                        Etsy'deki rakip ürünleri analiz et, yükselen trendleri yakala, Action Card üret.
                    </p>
                </div>

                {/* Özet sayaçlar */}
                <div className="flex items-center gap-3">
                    {immediateCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/15 border border-orange-500/30 rounded-lg animate-pulse">
                            <Zap className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-xs font-semibold text-orange-400">{immediateCount} INSTANT</span>
                        </div>
                    )}
                    {highPriorityCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs font-semibold text-red-400">{highPriorityCount} HIGH</span>
                        </div>
                    )}
                    {pendingCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                            <span className="text-xs font-semibold text-violet-400">{pendingCount} bekliyor</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
                {/* SOL — Scan paneli + sonuçlar */}
                <div className="space-y-5">
                    {/* Scan formu */}
                    <div className="rounded-xl border border-border-default bg-bg-elevated p-5 space-y-4">
                        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-accent" />
                            Yeni Tarama
                        </h2>

                        {/* Keyword giriş */}
                        <div>
                            <label className="text-xs font-medium text-text-secondary mb-2 block">
                                Anahtar Kelimeler
                                <span className="text-text-tertiary font-normal ml-1">(Enter veya virgülle ekle)</span>
                            </label>

                            <div className="flex flex-wrap gap-1.5 p-2 bg-bg-base border border-border-default rounded-lg min-h-[44px] focus-within:border-accent/50 transition-colors">
                                {keywords.map(kw => (
                                    <span
                                        key={kw}
                                        className="flex items-center gap-1 px-2 py-0.5 bg-accent/20 text-accent border border-accent/30 rounded-full text-xs font-medium"
                                    >
                                        {kw}
                                        <button onClick={() => removeKeyword(kw)} className="hover:text-red-400 transition-colors ml-0.5">×</button>
                                    </span>
                                ))}
                                <input
                                    value={keywordInput}
                                    onChange={e => setKeywordInput(e.target.value)}
                                    onKeyDown={handleKeywordInput}
                                    onBlur={() => { if (keywordInput.trim()) { addKeyword(keywordInput); setKeywordInput(''); }}}
                                    placeholder={keywords.length === 0 ? '4th of July 250th Anniversary...' : ''}
                                    className="flex-1 min-w-[180px] bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none px-1"
                                />
                            </div>

                            {/* Önerilen keyword'ler */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {SUGGESTED_KEYWORDS.filter(kw => !keywords.includes(kw)).map(kw => (
                                    <button
                                        key={kw}
                                        onClick={() => addKeyword(kw)}
                                        className="text-[11px] px-2 py-0.5 rounded-full border border-border-subtle text-text-tertiary hover:text-text-secondary hover:border-accent/40 transition-all"
                                    >
                                        + {kw}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ayarlar */}
                        <div className="flex items-center gap-4 flex-wrap">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={saveWinners}
                                    onChange={e => setSaveWinners(e.target.checked)}
                                    className="rounded border-border-default accent-violet-500"
                                />
                                <span className="text-xs text-text-secondary">Kazananları Brain'e kaydet</span>
                            </label>

                            <div className="flex items-center gap-2">
                                <span className="text-xs text-text-secondary">Ürün/keyword:</span>
                                <select
                                    value={maxPerKw}
                                    onChange={e => setMaxPerKw(Number(e.target.value))}
                                    className="text-xs bg-bg-base border border-border-default rounded px-2 py-1 text-text-primary"
                                >
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={runScan}
                            disabled={scanning || keywords.length === 0}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {scanning ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Taranıyor...</>
                            ) : (
                                <><Target className="w-4 h-4" /> Taramayı Başlat</>
                            )}
                        </button>

                        {/* Progress göstergesi */}
                        {scanning && scanProgress && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-text-tertiary">
                                    <span className="truncate">"{scanProgress.currentKeyword}" taranıyor...</span>
                                    <span className="flex-shrink-0 ml-2 tabular-nums">{scanProgress.done}/{scanProgress.total}</span>
                                </div>
                                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all duration-500"
                                        style={{ width: `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 0}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        {scanning && !scanProgress && (
                            <p className="text-xs text-text-tertiary text-center">Tarama başlatılıyor...</p>
                        )}
                    </div>

                    {/* Scan hatası */}
                    {scanError && (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
                            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-400">{scanError}</p>
                        </div>
                    )}

                    {/* Scan sonucu özeti */}
                    {scanResult && (
                        <div className="rounded-xl border border-border-default bg-bg-elevated p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-text-primary">Tarama Sonucu</h3>
                                <span className="text-xs text-text-tertiary">{new Date(scanResult.summary.scannedAt).toLocaleTimeString('tr-TR')}</span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                {[
                                    { label: 'Ürün', value: scanResult.summary.totalProducts, icon: ShoppingBag, color: '' },
                                    { label: 'Trending', value: scanResult.summary.totalTrending, icon: TrendingUp, color: '' },
                                    { label: 'Instant', value: scanResult.summary.totalImmediate ?? 0, icon: Zap, color: 'text-orange-400' },
                                    { label: 'Action Card', value: scanResult.summary.totalWinners, icon: Trophy, color: 'text-violet-400' },
                                    { label: 'Hata', value: scanResult.summary.errors, icon: AlertCircle, color: '' },
                                ].map(stat => (
                                    <div key={stat.label} className="bg-bg-base rounded-lg p-3 text-center">
                                        <stat.icon className={cn('w-4 h-4 mx-auto mb-1', stat.color || 'text-text-tertiary')} />
                                        <p className={cn('text-xl font-bold', stat.color || 'text-text-primary')}>{stat.value}</p>
                                        <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{stat.label}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Keyword bazlı detay */}
                            <div className="space-y-2">
                                {Object.entries(scanResult.byKeyword).map(([kw, result]) => (
                                    <div key={kw} className="flex items-center justify-between py-2 border-t border-border-subtle">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs font-medium text-text-primary truncate">"{kw}"</span>
                                            {result.isBaseline && <Badge variant="baseline">Baseline</Badge>}
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0">
                                            <span className="text-xs text-text-tertiary">{result.productsScraped} ürün</span>
                                            {result.trendingCount > 0 && (
                                                <span className="text-xs text-emerald-400">↑ {result.trendingCount} trend</span>
                                            )}
                                            {result.winnersFound > 0 && (
                                                <span className="text-xs font-semibold text-violet-400">🏆 {result.winnersFound} kart</span>
                                            )}
                                            {result.error && (
                                                <span className="text-xs text-red-400">⚠ Hata</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {scanResult.summary.totalWinners > 0 && (
                                <p className="text-xs text-violet-300 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    {scanResult.summary.totalWinners} yeni Action Card oluştu → sağda onaylayabilirsin.
                                </p>
                            )}
                            {scanResult.actionCards.some(c => c.trendData.isBaseline) && (
                                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Bazı keyword'ler ilk kez tarandı (Baseline). Action Card üretilmedi — bir sonraki taramada satış delta'sı hesaplanacak.
                                </p>
                            )}
                        </div>
                    )}

                    {/* 2026 Koleksiyonları */}
                    {collections.length > 0 && (
                        <div className="rounded-xl border border-border-default bg-bg-elevated p-5">
                            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                                <Trophy className="w-4 h-4 text-amber-400" />
                                2026 Koleksiyonları
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {collections.map(col => (
                                    <button
                                        key={col.name}
                                        onClick={() => {
                                            col.keywords.slice(0, 2).forEach(kw => addKeyword(kw.charAt(0).toUpperCase() + kw.slice(1)));
                                        }}
                                        className="text-left p-3 rounded-lg border border-border-subtle bg-bg-base hover:border-accent/40 hover:bg-accent/5 transition-all group"
                                    >
                                        <p className="text-xs font-semibold text-text-primary group-hover:text-accent transition-colors">{col.name}</p>
                                        <p className="text-[10px] text-text-tertiary mt-0.5">{col.event}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* SAĞ — Action Cards */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-violet-400" />
                            Action Cards
                        </h2>
                        <div className="flex items-center gap-1">
                            {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(s => (
                                <button
                                    key={s}
                                    onClick={() => setStatusFilter(s)}
                                    className={cn(
                                        'px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-all',
                                        statusFilter === s
                                            ? 'bg-accent text-white'
                                            : 'text-text-tertiary hover:text-text-secondary'
                                    )}
                                >
                                    {s === 'ALL' ? 'Tümü' : s === 'PENDING' ? 'Bekleyen' : s === 'APPROVED' ? 'Onaylı' : 'Red'}
                                </button>
                            ))}
                            <button
                                onClick={loadCards}
                                className="p-1 text-text-tertiary hover:text-text-secondary transition-colors ml-1"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {cardsLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                        </div>
                    ) : cards.length === 0 ? (
                        <div className="rounded-xl border border-border-subtle bg-bg-elevated p-8 text-center">
                            <Target className="w-10 h-10 text-text-tertiary mx-auto mb-3 opacity-40" />
                            <p className="text-sm font-medium text-text-secondary mb-1">
                                {statusFilter === 'PENDING' ? 'Bekleyen action card yok' : 'Card bulunamadı'}
                            </p>
                            <p className="text-xs text-text-tertiary">
                                {statusFilter === 'PENDING'
                                    ? 'Soldan keyword ekleyip tarama başlat.'
                                    : 'Farklı bir filtre dene.'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {cards.map(card => (
                                <ActionCard
                                    key={card.id}
                                    card={card}
                                    onApprove={handleApprove}
                                    onReject={handleReject}
                                    onApproveFactory={handleApproveFactory}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
