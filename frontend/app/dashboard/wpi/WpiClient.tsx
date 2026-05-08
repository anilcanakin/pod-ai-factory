'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Target, Zap, TrendingUp, CheckCircle2, XCircle,
    RotateCcw, ChevronDown, ChevronUp, Loader2,
    ShoppingBag, Sparkles, Trophy, AlertCircle,
    ArrowRight, Brain, Tag, Palette, Copy, ChevronRight,
    Flame, Star, ShoppingCart, Factory, Telescope, Clock,
    Search, FileText, Hash, X
} from 'lucide-react';
import {
    apiWpi, apiScout, WpiCard, WpiScanResult, WpiCollection,
    WpiScanProgress, WpiProductCategory, ScoutNiche, WpiKeywordStatus,
    WpiSeoPackage, RadarDiscovery
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<WpiProductCategory | string, { label: string; color: string; dot: string }> = {
    POD_APPAREL:      { label: 'Apparel',  color: 'bg-violet-500/20 text-violet-300 border-violet-500/30', dot: 'bg-violet-400' },
    HOME_DECOR:       { label: 'Home',     color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       dot: 'bg-blue-400'   },
    DIGITAL_DOWNLOAD: { label: 'Digital',  color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',    dot: 'bg-amber-400'  },
    ACCESSORIES:      { label: 'Accessory',color: 'bg-pink-500/20 text-pink-300 border-pink-500/30',       dot: 'bg-pink-400'   },
};

function CategoryBadge({ category }: { category?: string | null }) {
    if (!category || category === 'NON_POD') return null;
    const cfg = CATEGORY_CONFIG[category] ?? { label: category, color: 'bg-slate-700/60 text-slate-300', dot: 'bg-slate-400' };
    return (
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border', cfg.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
            {cfg.label}
        </span>
    );
}

// ─── Confidence ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ value }: { value: number }) {
    const color = value >= 90 ? 'text-emerald-400' : value >= 80 ? 'text-violet-400' : 'text-amber-400';
    return (
        <div className={cn('text-xs font-bold tabular-nums', color)}>{value}%</div>
    );
}

// ─── Collapsible text block ───────────────────────────────────────────────────

function CollapsibleBlock({ icon: Icon, label, content, accent = 'violet' }: {
    icon: React.ElementType;
    label: string;
    content: string;
    accent?: 'violet' | 'orange' | 'blue' | 'amber';
}) {
    const [open, setOpen] = useState(false);
    const accentMap = {
        violet: 'text-violet-400',
        orange: 'text-orange-400',
        blue:   'text-blue-400',
        amber:  'text-amber-400',
    };
    return (
        <div className="text-xs">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-1.5 text-text-tertiary hover:text-text-secondary transition-colors w-full"
            >
                <Icon className={cn('w-3 h-3 flex-shrink-0', accentMap[accent])} />
                <span className="font-semibold uppercase tracking-wider text-[9px]">{label}</span>
                {open ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            {open && (
                <p className="mt-1.5 text-text-secondary leading-relaxed pl-4.5">{content}</p>
            )}
        </div>
    );
}

// ─── Visual Action Card ───────────────────────────────────────────────────────

// ─── SEO Package Panel ───────────────────────────────────────────────────────

function SeoPackagePanel({ pkg, onClose }: { pkg: WpiSeoPackage; onClose: () => void }) {
    const [copied, setCopied] = useState<string | null>(null);

    const copy = async (text: string, key: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
    };

    const copyBtn = (text: string, key: string) => (
        <button
            onClick={() => copy(text, key)}
            className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-text-tertiary hover:text-text-primary transition-colors"
        >
            <Copy className="w-2.5 h-2.5" />
            {copied === key ? 'Kopyalandı!' : 'Kopyala'}
        </button>
    );

    return (
        <div className="mt-2 rounded-xl border border-blue-500/30 bg-blue-500/5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-blue-500/20">
                <div className="flex items-center gap-1.5">
                    <Search className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider">SEO Paketi</span>
                </div>
                <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary transition-colors">
                    <X className="w-3 h-3" />
                </button>
            </div>

            <div className="p-3 space-y-3">
                {/* Title */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                            <FileText className="w-2.5 h-2.5" /> Başlık
                            <span className="ml-1 font-normal text-text-tertiary opacity-70">{pkg.title.length}/140</span>
                        </span>
                        {copyBtn(pkg.title, 'title')}
                    </div>
                    <p className="text-[11px] text-text-primary leading-relaxed bg-bg-base rounded-lg p-2 border border-border-subtle">
                        {pkg.title}
                    </p>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                            <Hash className="w-2.5 h-2.5" /> Etiketler ({pkg.tags.length}/13)
                        </span>
                        {copyBtn(pkg.tags.join(', '), 'tags')}
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {pkg.tags.map((tag, i) => (
                            <button
                                key={i}
                                onClick={() => copy(tag, `tag-${i}`)}
                                title="Kopyala"
                                className={cn(
                                    'text-[9px] px-1.5 py-0.5 rounded-full border transition-colors',
                                    copied === `tag-${i}`
                                        ? 'bg-blue-500/30 border-blue-400/50 text-blue-200'
                                        : 'bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/20'
                                )}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                            <FileText className="w-2.5 h-2.5" /> Açıklama
                        </span>
                        {copyBtn(pkg.description, 'desc')}
                    </div>
                    <p className="text-[10px] text-text-secondary leading-relaxed bg-bg-base rounded-lg p-2 border border-border-subtle max-h-28 overflow-y-auto whitespace-pre-wrap">
                        {pkg.description}
                    </p>
                </div>

                {/* Keyword Density Map — top 5 */}
                {pkg.keywordDensityMap.length > 0 && (
                    <div className="space-y-1">
                        <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider">Keyword Haritası</span>
                        <div className="flex flex-wrap gap-1">
                            {pkg.keywordDensityMap.slice(0, 8).map(({ kw, count }) => (
                                <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                                    {kw} <span className="opacity-60">×{count}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Visual Action Card ───────────────────────────────────────────────────────

function VisualActionCard({ card, onApprove, onReject, onApproveFactory }: {
    card: WpiCard;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onApproveFactory: (id: string) => void;
}) {
    const [loading, setLoading]         = useState<'approve' | 'factory' | 'reject' | null>(null);
    const [copied, setCopied]           = useState(false);
    const [seoLoading, setSeoLoading]   = useState(false);
    const [seoPackage, setSeoPackage]   = useState<WpiSeoPackage | null>(null);
    const [seoError, setSeoError]       = useState<string | null>(null);
    const ac  = card.actionCard;
    const td  = card.trendData;
    const bc  = card.brainComparison;
    const isInstant   = ac.actionType === 'IMMEDIATE_ACTION';
    const isHotNow    = !!(td.isHotNow || ac.hotNow);
    const designPrompt = ac.designPrompt || bc.designPrompt || '';

    const handleOptimizeSeo = async () => {
        if (seoPackage) { setSeoPackage(null); return; } // toggle off
        setSeoLoading(true);
        setSeoError(null);
        try {
            const res = await apiWpi.optimizeSeo(card.id);
            setSeoPackage(res.seoPackage);
        } catch (err: any) {
            setSeoError(err.message);
        } finally {
            setSeoLoading(false);
        }
    };

    const handle = async (action: 'approve' | 'factory' | 'reject') => {
        setLoading(action);
        try {
            if (action === 'reject')        await onReject(card.id);
            else if (action === 'factory')  await onApproveFactory(card.id);
            else                            await onApprove(card.id);
        } finally { setLoading(null); }
    };

    const copyPrompt = async () => {
        if (!designPrompt) return;
        await navigator.clipboard.writeText(designPrompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    // Approved / Rejected — minimal pill
    if (card.status === 'APPROVED') return (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
            <div className="min-w-0">
                <p className="text-xs font-medium text-green-400 truncate">{card.product.title}</p>
                <p className="text-[10px] text-text-tertiary">
                    Onaylandı{card.actionCard.collection ? ` → ${card.actionCard.collection}` : ''} · Factory&apos;ye gönderildi
                </p>
            </div>
        </div>
    );

    if (card.status === 'REJECTED') return (
        <div className="rounded-xl border border-slate-700/30 bg-slate-800/20 p-3 flex items-center gap-2.5 opacity-40">
            <XCircle className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <p className="text-xs text-slate-500 truncate">{card.product.title}</p>
        </div>
    );

    return (
        <div className={cn(
            'rounded-xl border overflow-hidden transition-all duration-200 group',
            isInstant || isHotNow
                ? 'border-orange-500/50 hover:border-orange-400/70 shadow-[0_0_20px_rgba(249,115,22,0.08)]'
                : ac.priority === 'HIGH'
                    ? 'border-violet-500/40 hover:border-violet-400/60 shadow-[0_0_20px_rgba(124,58,237,0.06)]'
                    : 'border-border-default hover:border-border-subtle'
        )}>

            {/* ── Ürün görseli (büyük, tam genişlik) ── */}
            <div className="relative w-full aspect-square overflow-hidden bg-slate-800">
                {card.product.imageUrl ? (
                    <img
                        src={card.product.imageUrl}
                        alt={card.product.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="w-12 h-12 text-slate-600" />
                    </div>
                )}

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                {/* Sol üst — HOT NOW / IMMEDIATE badge */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                    {(isInstant || isHotNow) && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500 text-white text-[10px] font-black uppercase tracking-wider shadow-lg animate-pulse">
                            <Flame className="w-2.5 h-2.5" />
                            HOT NOW
                        </div>
                    )}
                    {/* Instant signals */}
                    {isInstant && ac.instantSignals?.map(s => {
                        if (s === 'BEST_SELLER')     return (
                            <div key={s} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-500/90 text-yellow-950 text-[9px] font-bold shadow">
                                <Star className="w-2 h-2" /> Best Seller
                            </div>
                        );
                        if (s === 'POPULAR_NOW')     return (
                            <div key={s} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/90 text-white text-[9px] font-bold shadow">
                                <TrendingUp className="w-2 h-2" /> Popular
                            </div>
                        );
                        if (s.startsWith('IN_CART_')) return (
                            <div key={s} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/90 text-white text-[9px] font-bold shadow">
                                <ShoppingCart className="w-2 h-2" /> {s.replace('IN_CART_', '')} sepette
                            </div>
                        );
                        return null;
                    })}
                    {!isInstant && ac.collection && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/90 text-amber-950 text-[9px] font-bold shadow">
                            <Trophy className="w-2 h-2" />
                            {ac.collection.split(' ').slice(0, 3).join(' ')}
                        </div>
                    )}
                </div>

                {/* Sağ üst — Confidence + Kategori */}
                <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <div className={cn(
                        'px-2 py-1 rounded-full text-xs font-black shadow backdrop-blur-sm',
                        bc.confidence >= 90 ? 'bg-emerald-500/90 text-white'
                        : bc.confidence >= 80 ? 'bg-violet-500/90 text-white'
                        : 'bg-amber-500/90 text-white'
                    )}>
                        {bc.confidence}%
                    </div>
                </div>

                {/* Sol alt — Fiyat + Satış overlay */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-bold">
                        ${card.product.price}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px]">
                        {td.salesCount} satış
                        {td.salesDelta > 0 && (
                            <span className="text-emerald-400 font-bold ml-1">+{td.salesDelta}</span>
                        )}
                    </span>
                    {td.trendPeriod === 'HOT_NOW' && (
                        <span className="px-2 py-0.5 rounded-full bg-orange-500/80 backdrop-blur-sm text-white text-[9px] font-bold uppercase">
                            Anlık Sinyal
                        </span>
                    )}
                    {td.salesDelta > 0 && td.trendPeriod === '48h' && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/80 backdrop-blur-sm text-white text-[9px] font-bold">
                            ↑ 48h trend
                        </span>
                    )}
                </div>
            </div>

            {/* ── Kart gövdesi ── */}
            <div className="p-3 space-y-2.5 bg-bg-elevated">
                {/* Kategori + Başlık */}
                <div>
                    <div className="flex items-center gap-1.5 mb-1">
                        <CategoryBadge category={card.product.category} />
                        <span className="text-[9px] text-text-tertiary truncate">{card.keyword}</span>
                    </div>
                    <h3 className="text-xs font-semibold text-text-primary line-clamp-2 leading-relaxed">
                        {card.product.title}
                    </h3>
                    <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{card.product.shopName}</p>
                </div>

                {/* Design Prompt */}
                {designPrompt && (
                    <div className="rounded-lg bg-violet-500/8 border border-violet-500/20 p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-violet-400" />
                                <span className="text-[9px] font-bold text-violet-300 uppercase tracking-wider">Design Prompt</span>
                            </div>
                            <button
                                onClick={copyPrompt}
                                className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-300 transition-colors"
                            >
                                <Copy className="w-2.5 h-2.5" />
                                {copied ? 'Kopyalandı!' : 'Kopyala'}
                            </button>
                        </div>
                        <p className="text-[10px] text-violet-200/80 leading-relaxed font-mono line-clamp-3">
                            {designPrompt}
                        </p>
                    </div>
                )}

                {/* Competitive Edge */}
                {bc.competitiveEdge && (
                    <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                            <Trophy className="w-3 h-3 text-amber-400" />
                            <span className="text-[9px] font-bold text-amber-300 uppercase tracking-wider">Competitive Edge</span>
                        </div>
                        <p className="text-[10px] text-amber-200/80 leading-relaxed">
                            {bc.competitiveEdge}
                        </p>
                    </div>
                )}

                {/* Ek detaylar (collapsed) */}
                <div className="space-y-1.5 pt-0.5 border-t border-border-subtle">
                    {bc.reasoning && (
                        <CollapsibleBlock icon={Brain} label="AI Analiz" content={bc.reasoning} accent="violet" />
                    )}
                    {ac.colorPalette && (
                        <CollapsibleBlock icon={Palette} label="Renk Paleti" content={ac.colorPalette} accent="blue" />
                    )}
                    {ac.targetKeywords?.length > 0 && (
                        <div className="text-xs">
                            <div className="flex items-center gap-1.5 mb-1">
                                <Tag className="w-3 h-3 text-blue-400" />
                                <span className="font-semibold uppercase tracking-wider text-[9px] text-text-tertiary">Keywords</span>
                            </div>
                            <div className="flex flex-wrap gap-1 pl-4.5">
                                {ac.targetKeywords.map(kw => (
                                    <span key={kw} className="text-[9px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded-full">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {card.product.listingUrl && (
                        <a
                            href={card.product.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-text-tertiary hover:text-accent transition-colors"
                        >
                            Rakip listinge git <ArrowRight className="w-3 h-3" />
                        </a>
                    )}
                </div>

                {/* Action butonları */}
                {isInstant ? (
                    <div className="flex gap-1.5 pt-0.5">
                        <button
                            onClick={() => handle('factory')}
                            disabled={!!loading}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white text-[11px] font-bold transition-all disabled:opacity-50"
                        >
                            {loading === 'factory' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Factory className="w-3 h-3" />}
                            Hemen Üret
                        </button>
                        <button
                            onClick={() => handle('approve')}
                            disabled={!!loading}
                            className="px-2.5 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs border border-green-600/30 transition-all disabled:opacity-50"
                            title="Onayla"
                        >
                            {loading === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : '✓'}
                        </button>
                        <button
                            onClick={() => handle('reject')}
                            disabled={!!loading}
                            className="px-2.5 py-2 rounded-lg bg-slate-700/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs border border-slate-600/30 hover:border-red-500/20 transition-all disabled:opacity-50"
                        >
                            {loading === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : '✕'}
                        </button>
                    </div>
                ) : (
                    <div className="flex gap-1.5 pt-0.5">
                        <button
                            onClick={() => handle('factory')}
                            disabled={!!loading}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-[11px] font-semibold transition-all disabled:opacity-50"
                        >
                            {loading === 'factory' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Factory className="w-3 h-3" />}
                            Factory&apos;ye Gönder
                        </button>
                        <button
                            onClick={() => handle('approve')}
                            disabled={!!loading}
                            className="px-2.5 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs border border-green-600/30 transition-all disabled:opacity-50"
                        >
                            {loading === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : '✓'}
                        </button>
                        <button
                            onClick={() => handle('reject')}
                            disabled={!!loading}
                            className="px-2.5 py-2 rounded-lg bg-slate-700/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs border border-slate-600/30 hover:border-red-500/20 transition-all disabled:opacity-50"
                        >
                            {loading === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : '✕'}
                        </button>
                    </div>
                )}

                {/* ── SEO Optimize butonu ── */}
                <button
                    onClick={handleOptimizeSeo}
                    disabled={seoLoading}
                    className={cn(
                        'w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-all',
                        seoPackage
                            ? 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/20'
                            : 'bg-bg-overlay border-border-subtle text-text-tertiary hover:text-text-secondary hover:border-blue-500/30 hover:bg-blue-500/8'
                    )}
                >
                    {seoLoading
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> SEO Üretiliyor...</>
                        : seoPackage
                            ? <><Search className="w-3 h-3" /> SEO Paketini Kapat</>
                            : <><Search className="w-3 h-3" /> SEO Paketi Oluştur</>
                    }
                </button>

                {/* SEO error */}
                {seoError && (
                    <p className="text-[10px] text-red-400 text-center">{seoError}</p>
                )}

                {/* SEO Package Panel */}
                {seoPackage && (
                    <SeoPackagePanel pkg={seoPackage} onClose={() => setSeoPackage(null)} />
                )}
            </div>
        </div>
    );
}

// ─── Radar Auto-Pilot Panel ───────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
    etsy:           { label: 'Etsy',           color: 'bg-orange-500/15 text-orange-300 border-orange-500/25' },
    google_trends:  { label: 'Google Trends',  color: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
    pinterest:      { label: 'Pinterest',      color: 'bg-pink-500/15 text-pink-300 border-pink-500/25' },
    event_calendar: { label: 'Takvim',         color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
};

const URGENCY_COLOR = {
    high:   'text-red-400',
    medium: 'text-yellow-400',
    low:    'text-green-400',
};

function RadarAutoPilot({
    discoveries, isLoading, isTriggering, lastRunAt, nextRunAt,
    onTrigger, onAnalyzeInWpi, onDirectFactory,
}: {
    discoveries: RadarDiscovery[];
    isLoading: boolean;
    isTriggering: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    onTrigger: () => void;
    onAnalyzeInWpi: (d: RadarDiscovery) => void;
    onDirectFactory: (d: RadarDiscovery) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const criticalList  = discoveries.filter(d => d.isCritical);
    const hotList       = discoveries.filter(d => !d.isCritical && d.discoveryScore >= 75);

    const fmtTime = (iso: string | null) => {
        if (!iso) return null;
        const d = new Date(iso);
        const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
        if (diffMin < 60) return `${diffMin}dk önce`;
        const diffH = Math.round(diffMin / 60);
        return `${diffH}s önce`;
    };

    return (
        <div className={cn(
            'rounded-xl border overflow-hidden transition-all',
            criticalList.length > 0
                ? 'border-red-500/50 shadow-[0_0_30px_rgba(239,68,68,0.10)]'
                : 'border-border-default'
        )}>
            {/* Header */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setCollapsed(v => !v)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setCollapsed(v => !v); }}
                className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated hover:bg-white/2 transition-colors cursor-pointer select-none"
            >
                <div className="flex items-center gap-2.5">
                    <div className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold',
                        criticalList.length > 0
                            ? 'bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse'
                            : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    )}>
                        <div className={cn('w-1.5 h-1.5 rounded-full', criticalList.length > 0 ? 'bg-red-400' : 'bg-emerald-400')} />
                        {criticalList.length > 0 ? 'CRITICAL HOT NOW' : 'Auto-Pilot'}
                    </div>
                    <span className="text-sm font-semibold text-text-primary">Radar: Auto-Pilot</span>
                    <span className="text-[10px] text-text-tertiary font-normal">Etsy · Google Trends · Pinterest</span>
                    {discoveries.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-[10px] font-bold">
                            {discoveries.length} keşif
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {lastRunAt && (
                        <span className="text-[10px] text-text-tertiary">Son tarama: {fmtTime(lastRunAt)}</span>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); onTrigger(); }}
                        disabled={isTriggering}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-[11px] font-semibold border border-accent/20 transition-colors disabled:opacity-50"
                    >
                        {isTriggering
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Taranıyor...</>
                            : <><RotateCcw className="w-3 h-3" /> Şimdi Tara</>
                        }
                    </button>
                    {collapsed
                        ? <ChevronRight className="w-4 h-4 text-text-tertiary" />
                        : <ChevronDown className="w-4 h-4 text-text-tertiary" />
                    }
                </div>
            </div>

            {!collapsed && (
                <div className="border-t border-border-subtle bg-bg-base">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8 gap-2 text-text-tertiary text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Keşifler yükleniyor...
                        </div>
                    ) : discoveries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-text-tertiary">
                            <Telescope className="w-8 h-8 opacity-30" />
                            <p className="text-sm">Henüz keşif yok — &quot;Şimdi Tara&quot; butonuna bas.</p>
                            {nextRunAt && (
                                <p className="text-[11px] opacity-60">Sonraki otomatik tarama: {new Date(nextRunAt).toLocaleTimeString('tr-TR')}</p>
                            )}
                        </div>
                    ) : (
                        <div className="p-4 space-y-3">
                            {/* CRITICAL section */}
                            {criticalList.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1.5">
                                        <Flame className="w-3.5 h-3.5 text-red-400" />
                                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                                            CRITICAL HOT NOW ({criticalList.length})
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {criticalList.map(d => (
                                            <RadarDiscoveryCard
                                                key={d.id}
                                                discovery={d}
                                                isCritical
                                                onAnalyzeInWpi={onAnalyzeInWpi}
                                                onDirectFactory={onDirectFactory}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* HOT discoveries */}
                            {hotList.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1.5">
                                        <TrendingUp className="w-3.5 h-3.5 text-violet-400" />
                                        <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
                                            AI Brain Onaylı Adaylar ({hotList.length})
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                        {hotList.map(d => (
                                            <RadarDiscoveryCard
                                                key={d.id}
                                                discovery={d}
                                                isCritical={false}
                                                onAnalyzeInWpi={onAnalyzeInWpi}
                                                onDirectFactory={onDirectFactory}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {nextRunAt && (
                                <p className="text-[10px] text-text-tertiary text-center pt-1">
                                    Sonraki otomatik tarama: {new Date(nextRunAt).toLocaleString('tr-TR')}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function RadarDiscoveryCard({
    discovery: d, isCritical, onAnalyzeInWpi, onDirectFactory,
}: {
    discovery: RadarDiscovery;
    isCritical: boolean;
    onAnalyzeInWpi: (d: RadarDiscovery) => void;
    onDirectFactory: (d: RadarDiscovery) => void;
}) {
    const srcCfg = SOURCE_CONFIG[d.source] ?? SOURCE_CONFIG.etsy;

    return (
        <div className={cn(
            'rounded-xl border p-3 space-y-2 transition-all',
            isCritical
                ? 'border-red-500/40 bg-red-500/5 shadow-[0_0_12px_rgba(239,68,68,0.08)]'
                : 'border-border-subtle bg-bg-elevated hover:border-border-default'
        )}>
            {/* Score + Source */}
            <div className="flex items-center justify-between gap-2">
                <span className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border',
                    srcCfg.color
                )}>
                    {srcCfg.label}
                </span>
                <div className={cn(
                    'text-sm font-black tabular-nums',
                    d.discoveryScore >= 90 ? 'text-red-400' : d.discoveryScore >= 80 ? 'text-violet-400' : 'text-amber-400'
                )}>
                    {d.discoveryScore}
                    <span className="text-[9px] font-normal text-text-tertiary">/100</span>
                </div>
            </div>

            {/* Niche name */}
            <h3 className="text-xs font-semibold text-text-primary leading-snug">{d.niche}</h3>

            {/* Product + Urgency */}
            <div className="flex items-center gap-2 flex-wrap">
                {d.productRecommendation && (
                    <span className="text-[10px] text-text-tertiary bg-bg-overlay px-2 py-0.5 rounded-full border border-border-subtle">
                        {d.productRecommendation}
                    </span>
                )}
                <span className={cn('text-[10px] font-semibold', URGENCY_COLOR[d.urgency])}>
                    ↑ {d.urgency}
                </span>
            </div>

            {/* Reasoning (trimmed) */}
            {d.reasoning && (
                <p className="text-[10px] text-text-tertiary leading-relaxed line-clamp-2">{d.reasoning}</p>
            )}

            {/* Keywords */}
            {d.suggestedKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {d.suggestedKeywords.slice(0, 3).map(kw => (
                        <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                            {kw}
                        </span>
                    ))}
                </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-1.5 pt-0.5">
                <button
                    onClick={() => onAnalyzeInWpi(d)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-[11px] font-semibold border border-accent/20 transition-colors"
                >
                    <Brain className="w-3 h-3" />
                    WPI&apos;da Analiz Et
                </button>
                <button
                    onClick={() => onDirectFactory(d)}
                    className={cn(
                        'flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
                        isCritical
                            ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/30'
                            : 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border-green-500/20'
                    )}
                >
                    <Factory className="w-3 h-3" />
                    Hemen Üret
                </button>
            </div>
        </div>
    );
}

// ─── Scan paneli ──────────────────────────────────────────────────────────────

const SUGGESTED_KEYWORDS = [
    '4th of July 250th Anniversary',
    'FIFA World Cup 2026',
    'Mothers Day gift',
    'minimalist wall art',
    'patriotic poster print',
    'halloween gothic aesthetic',
];

function ScanPanel({
    keywords, keywordInput, setKeywordInput, setKeywords,
    addKeyword, removeKeyword, handleKeywordInput,
    saveWinners, setSaveWinners, maxPerKw, setMaxPerKw,
    scanning, runScan, scanProgress, collections,
}: any) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="rounded-xl border border-border-default bg-bg-elevated">
            {/* Header */}
            <button
                onClick={() => setCollapsed(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors rounded-t-xl"
            >
                <span className="text-sm font-semibold text-text-primary flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-accent" />
                    Yeni Tarama
                    {keywords.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-[10px] font-bold">
                            {keywords.length} keyword
                        </span>
                    )}
                </span>
                {collapsed
                    ? <ChevronRight className="w-4 h-4 text-text-tertiary" />
                    : <ChevronDown className="w-4 h-4 text-text-tertiary" />
                }
            </button>

            {!collapsed && (
                <div className="px-4 pb-4 space-y-3 border-t border-border-subtle">
                    <div className="pt-3">
                        <label className="text-xs font-medium text-text-secondary mb-2 block">
                            Anahtar Kelimeler
                            <span className="text-text-tertiary font-normal ml-1">(Enter veya virgülle ekle)</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5 p-2 bg-bg-base border border-border-default rounded-lg min-h-[44px] focus-within:border-accent/50 transition-colors">
                            {keywords.map((kw: string) => (
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
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeywordInput(e.target.value)}
                                onKeyDown={handleKeywordInput}
                                onBlur={() => { if (keywordInput.trim()) { addKeyword(keywordInput); setKeywordInput(''); } }}
                                placeholder={keywords.length === 0 ? '4th of July 250th Anniversary...' : ''}
                                className="flex-1 min-w-[160px] bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none px-1"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {SUGGESTED_KEYWORDS.filter(kw => !keywords.includes(kw)).map(kw => (
                                <button
                                    key={kw}
                                    onClick={() => addKeyword(kw)}
                                    className="text-[10px] px-2 py-0.5 rounded-full border border-border-subtle text-text-tertiary hover:text-text-secondary hover:border-accent/40 transition-all"
                                >
                                    + {kw}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Collections */}
                    {collections.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {collections.map((col: WpiCollection) => (
                                <button
                                    key={col.name}
                                    onClick={() => col.keywords.slice(0, 2).forEach((kw: string) => addKeyword(kw.charAt(0).toUpperCase() + kw.slice(1)))}
                                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-all"
                                >
                                    <Trophy className="w-2.5 h-2.5" />
                                    {col.name.split(' ').slice(0, 2).join(' ')}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Ayarlar */}
                    <div className="flex items-center gap-4 flex-wrap">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={saveWinners}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaveWinners(e.target.checked)}
                                className="rounded border-border-default accent-violet-500"
                            />
                            <span className="text-xs text-text-secondary">Brain&apos;e kaydet</span>
                        </label>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-text-secondary">Ürün/kw:</span>
                            <select
                                value={maxPerKw}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMaxPerKw(Number(e.target.value))}
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

                    {scanning && (
                        <div className="space-y-2">
                            {/* Phase indicator */}
                            <div className="flex items-center gap-2 text-xs">
                                {!scanProgress && (
                                    <span className="text-text-tertiary flex items-center gap-1.5">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Tarama başlatılıyor...
                                    </span>
                                )}
                                {scanProgress?.phase === 'scraping' && (
                                    <span className="text-blue-400 flex items-center gap-1.5">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Ürünler çekiliyor...
                                    </span>
                                )}
                                {scanProgress?.phase === 'filtering' && (
                                    <span className="text-yellow-400 flex items-center gap-1.5">
                                        <Zap className="w-3 h-3" /> Ön filtreleme...
                                    </span>
                                )}
                                {(scanProgress?.phase === 'ai_analysis') && (
                                    <span className="text-violet-400 flex items-center gap-1.5">
                                        <Brain className="w-3 h-3 animate-pulse" />
                                        AI Analiz
                                        {(scanProgress.aiTotal ?? 0) > 0 && (
                                            <span className="tabular-nums font-semibold">
                                                {scanProgress.aiDone}/{scanProgress.aiTotal}
                                            </span>
                                        )}
                                    </span>
                                )}
                                {scanProgress?.phase === 'done' && (
                                    <span className="text-green-400 flex items-center gap-1.5">
                                        <CheckCircle2 className="w-3 h-3" /> Keyword tamamlandı
                                    </span>
                                )}
                            </div>

                            {/* Keyword + keyword-level progress */}
                            {scanProgress && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs text-text-tertiary">
                                        <span className="truncate">"{scanProgress.currentKeyword}"</span>
                                        <span className="ml-2 tabular-nums flex-shrink-0">{scanProgress.done}/{scanProgress.total}</span>
                                    </div>
                                    {/* Per-keyword status badges */}
                                    {scanProgress.keywordStatuses && (
                                        <div className="flex flex-wrap gap-1">
                                            {Object.entries(scanProgress.keywordStatuses).map(([kw, status]) => (
                                                <span key={kw} className={cn(
                                                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border truncate max-w-[120px]',
                                                    status === 'running'  && 'bg-blue-500/15 text-blue-300 border-blue-500/30',
                                                    status === 'done'     && 'bg-green-500/15 text-green-300 border-green-500/30',
                                                    status === 'timeout'  && 'bg-amber-500/15 text-amber-300 border-amber-500/30',
                                                    status === 'error'    && 'bg-red-500/15 text-red-300 border-red-500/30',
                                                    status === 'queued'   && 'bg-slate-700/40 text-slate-400 border-slate-600/30',
                                                )}>
                                                    {status === 'running' && <Loader2 className="w-2 h-2 animate-spin flex-shrink-0" />}
                                                    {status === 'done'    && <CheckCircle2 className="w-2 h-2 flex-shrink-0" />}
                                                    {status === 'timeout' && <Clock className="w-2 h-2 flex-shrink-0" />}
                                                    {status === 'error'   && <AlertCircle className="w-2 h-2 flex-shrink-0" />}
                                                    <span className="truncate">{kw.split(' ').slice(0, 3).join(' ')}</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Progress bar — AI analizi aşamasında AI progress'i göster */}
                            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                {scanProgress?.phase === 'ai_analysis' && (scanProgress.aiTotal ?? 0) > 0 ? (
                                    <div
                                        className="h-full bg-gradient-to-r from-violet-500 to-purple-400 rounded-full transition-all duration-300"
                                        style={{ width: `${(scanProgress.aiDone! / scanProgress.aiTotal!) * 100}%` }}
                                    />
                                ) : (
                                    <div
                                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all duration-500"
                                        style={{ width: scanProgress ? `${scanProgress.total > 0 ? (scanProgress.done / scanProgress.total) * 100 : 5}%` : '5%' }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Ana Sayfa ────────────────────────────────────────────────────────────────

export function WpiClient() {
    const [keywordInput, setKeywordInput]   = useState('');
    const [keywords, setKeywords]           = useState<string[]>([]);
    const [saveWinners, setSaveWinners]     = useState(true);
    const [maxPerKw, setMaxPerKw]           = useState(50);
    const [scanning, setScanning]           = useState(false);
    const [scanProgress, setScanProgress]   = useState<WpiScanProgress | null>(null);
    const [scanResult, setScanResult]       = useState<WpiScanResult | null>(null);
    const [scanError, setScanError]         = useState<string | null>(null);

    const [cards, setCards]                 = useState<WpiCard[]>([]);
    const [cardsLoading, setCardsLoading]   = useState(true);
    const [statusFilter, setStatusFilter]   = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');

    const [collections, setCollections]     = useState<WpiCollection[]>([]);

    // ── Autonomous Radar state ──
    const [radarDiscoveries, setRadarDiscoveries] = useState<RadarDiscovery[]>([]);
    const [radarLoading, setRadarLoading]         = useState(true);
    const [radarTriggering, setRadarTriggering]   = useState(false);
    const [radarLastRun, setRadarLastRun]         = useState<string | null>(null);
    const [radarNextRun, setRadarNextRun]         = useState<string | null>(null);

    // ── Niche Scout state ──
    const [scoutOpen, setScoutOpen]         = useState(false);
    const [scoutLoading, setScoutLoading]   = useState(false);
    const [scoutSuggestions, setScoutSuggestions] = useState<ScoutNiche[]>([]);

    const loadCards = useCallback(async () => {
        setCardsLoading(true);
        try {
            const res = await apiWpi.listActionCards(statusFilter, 60);
            setCards(res.cards);
        } catch (e: any) {
            console.error('WPI cards load error:', e.message);
        } finally {
            setCardsLoading(false);
        }
    }, [statusFilter]);

    const loadRadarDiscoveries = useCallback(async () => {
        setRadarLoading(true);
        try {
            const res = await apiWpi.radarDiscoveries(24);
            setRadarDiscoveries(res.discoveries);
            setRadarLastRun(res.lastRunAt);
            setRadarNextRun(res.nextRunAt);
        } catch { /* silent */ }
        finally { setRadarLoading(false); }
    }, []);

    const triggerRadar = async () => {
        setRadarTriggering(true);
        try {
            await apiWpi.radarTrigger();
            setTimeout(() => loadRadarDiscoveries(), 3000); // 3s sonra yenile
        } catch { /* silent */ }
        finally { setRadarTriggering(false); }
    };

    const handleRadarAnalyzeInWpi = (d: RadarDiscovery) => {
        addKeyword(d.niche);
        if (d.suggestedKeywords.length > 0) addKeyword(d.suggestedKeywords[0]);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleRadarDirectFactory = async (d: RadarDiscovery) => {
        try {
            await apiWpi.radarSendFactory(d.id);
            toast.success(`Draft Task oluşturuldu: "${d.niche.slice(0, 45)}"`);
        } catch {
            toast.error('Draft Task oluşturulamadı — yine de Factory\'ye yönlendiriliyor');
        }
        const prompt = `${d.niche}${d.productRecommendation ? ` ${d.productRecommendation}` : ''}, ${d.suggestedKeywords.slice(0, 2).join(', ')}`;
        window.location.href = `/dashboard/factory?prompt=${encodeURIComponent(prompt)}`;
    };

    useEffect(() => { loadCards(); }, [loadCards]);
    useEffect(() => { loadRadarDiscoveries(); }, [loadRadarDiscoveries]);
    useEffect(() => {
        apiWpi.collections().then(r => setCollections(r.collections)).catch(() => {});
        apiScout.list().then(r => setScoutSuggestions(r.suggestions)).catch(() => {});
    }, []);

    const runScout = async () => {
        setScoutLoading(true);
        try {
            const res = await apiScout.suggest();
            setScoutSuggestions(res.suggestions);
        } catch (e: any) {
            console.error('Scout error:', e.message);
        } finally {
            setScoutLoading(false);
        }
    };

    const scoutToWpi = (niche: ScoutNiche) => {
        addKeyword(niche.keyword);
        setScoutOpen(false);
    };

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

    const runScan = async () => {
        if (!keywords.length) return;
        setScanning(true);
        setScanError(null);
        setScanResult(null);
        setScanProgress(null);

        try {
            const start = await apiWpi.startScan(keywords, { saveWinners, maxPerKeyword: maxPerKw });

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

    const handleApprove        = async (id: string) => {
        await apiWpi.approve(id, false);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'APPROVED' } : c));
    };
    const handleApproveFactory = async (id: string) => {
        await apiWpi.approve(id, true);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'APPROVED' } : c));
    };
    const handleReject         = async (id: string) => {
        await apiWpi.reject(id);
        setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'REJECTED' } : c));
    };

    const immediateCount   = cards.filter(c => c.status === 'PENDING' && c.actionCard?.actionType === 'IMMEDIATE_ACTION').length;
    const pendingCount     = cards.filter(c => c.status === 'PENDING').length;
    const highPriorityCount= cards.filter(c => c.status === 'PENDING' && c.actionCard.priority === 'HIGH').length;

    return (
        <div className="p-6 space-y-5 max-w-[1600px]">

            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2.5">
                        <Target className="w-6 h-6 text-accent" />
                        Winning Product Intelligence
                    </h1>
                    <p className="text-sm text-text-tertiary mt-1">
                        Rakip ürünleri analiz et · HOT NOW sinyalleri yakala · Factory&apos;ye gönder
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {radarDiscoveries.filter(d => d.isCritical).length > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 border border-red-500/50 rounded-lg animate-pulse">
                            <Flame className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs font-black text-red-300 uppercase tracking-wide">
                                {radarDiscoveries.filter(d => d.isCritical).length} CRITICAL
                            </span>
                        </div>
                    )}
                    {immediateCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/15 border border-orange-500/40 rounded-lg animate-pulse">
                            <Flame className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-xs font-bold text-orange-400">{immediateCount} HOT NOW</span>
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

            {/* ── Autonomous Radar Panel ── */}
            <RadarAutoPilot
                discoveries={radarDiscoveries}
                isLoading={radarLoading}
                isTriggering={radarTriggering}
                lastRunAt={radarLastRun}
                nextRunAt={radarNextRun}
                onTrigger={triggerRadar}
                onAnalyzeInWpi={handleRadarAnalyzeInWpi}
                onDirectFactory={handleRadarDirectFactory}
            />

            {/* ── Scan Paneli (collapsible) ── */}
            <ScanPanel
                keywords={keywords} keywordInput={keywordInput}
                setKeywordInput={setKeywordInput} setKeywords={setKeywords}
                addKeyword={addKeyword} removeKeyword={removeKeyword}
                handleKeywordInput={handleKeywordInput}
                saveWinners={saveWinners} setSaveWinners={setSaveWinners}
                maxPerKw={maxPerKw} setMaxPerKw={setMaxPerKw}
                scanning={scanning} runScan={runScan}
                scanProgress={scanProgress} collections={collections}
            />

            {/* ── Niche Scout Paneli ── */}
            <div className="rounded-xl border border-border-default bg-bg-elevated">
                <button
                    onClick={() => setScoutOpen(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors rounded-xl"
                >
                    <span className="text-sm font-semibold text-text-primary flex items-center gap-2">
                        <Telescope className="w-4 h-4 text-cyan-400" />
                        Niche Scout
                        <span className="text-[10px] text-text-tertiary font-normal">Google Trends → AI Önerileri</span>
                        {scoutSuggestions.length > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">
                                {scoutSuggestions.length}
                            </span>
                        )}
                    </span>
                    {scoutOpen
                        ? <ChevronDown className="w-4 h-4 text-text-tertiary" />
                        : <ChevronRight className="w-4 h-4 text-text-tertiary" />
                    }
                </button>

                {scoutOpen && (
                    <div className="px-4 pb-4 border-t border-border-subtle space-y-3 pt-3">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-text-tertiary">
                                Google Trends verilerinden Etsy mikro-niş önerileri üretir. Her öneride "WPI ile Araştır" butonu keyword'ü scan'a ekler.
                            </p>
                            <button
                                onClick={runScout}
                                disabled={scoutLoading}
                                className="flex-shrink-0 ml-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 text-xs font-semibold border border-cyan-600/30 transition-all disabled:opacity-50"
                            >
                                {scoutLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Telescope className="w-3 h-3" />}
                                Trendleri Tara
                            </button>
                        </div>

                        {scoutSuggestions.length === 0 && !scoutLoading && (
                            <p className="text-xs text-text-tertiary text-center py-4">
                                Henüz öneri yok — "Trendleri Tara" butonuna bas.
                            </p>
                        )}

                        {scoutLoading && (
                            <div className="flex items-center justify-center py-6 gap-2 text-xs text-cyan-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Google Trends okunuyor · AI analiz yapıyor...
                            </div>
                        )}

                        {scoutSuggestions.length > 0 && (
                            <div className="space-y-2">
                                {scoutSuggestions.map((s, i) => (
                                    <div key={s.id ?? i} className="rounded-lg border border-border-subtle bg-bg-base p-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="text-xs font-semibold text-text-primary">{s.niche}</span>
                                                <span className={cn(
                                                    'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                                                    s.confidence >= 85 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-violet-500/20 text-violet-300'
                                                )}>{s.confidence}%</span>
                                            </div>
                                            <p className="text-[10px] text-text-tertiary font-mono mb-1">{s.keyword}</p>
                                            <p className="text-[10px] text-text-secondary leading-relaxed">{s.reasoning}</p>
                                        </div>
                                        <button
                                            onClick={() => scoutToWpi(s)}
                                            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-[10px] font-semibold border border-violet-600/30 transition-all whitespace-nowrap"
                                        >
                                            <Target className="w-3 h-3" />
                                            WPI&apos;de Araştır
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Scan hata ── */}
            {scanError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-400">{scanError}</p>
                </div>
            )}

            {/* ── Scan sonucu özeti ── */}
            {scanResult && (
                <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-text-primary">Son Tarama Sonucu</h3>
                        <span className="text-xs text-text-tertiary">{new Date(scanResult.summary.scannedAt).toLocaleTimeString('tr-TR')}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                        {[
                            { label: 'Ürün',       value: scanResult.summary.totalProducts,            icon: ShoppingBag, color: '' },
                            { label: 'Trending',   value: scanResult.summary.totalTrending,            icon: TrendingUp,  color: '' },
                            { label: 'HOT NOW',    value: scanResult.summary.totalImmediate ?? 0,      icon: Flame,       color: 'text-orange-400' },
                            { label: 'Action Card',value: scanResult.summary.totalWinners,             icon: Trophy,      color: 'text-violet-400' },
                            { label: 'Hata',       value: scanResult.summary.errors,                   icon: AlertCircle, color: '' },
                        ].map(stat => (
                            <div key={stat.label} className="bg-bg-base rounded-lg p-2 text-center">
                                <stat.icon className={cn('w-3.5 h-3.5 mx-auto mb-1', stat.color || 'text-text-tertiary')} />
                                <p className={cn('text-lg font-bold', stat.color || 'text-text-primary')}>{stat.value}</p>
                                <p className="text-[9px] text-text-tertiary uppercase tracking-wider">{stat.label}</p>
                            </div>
                        ))}
                    </div>
                    {scanResult.summary.totalWinners > 0 && (
                        <p className="text-xs text-violet-300 flex items-center gap-1.5 mt-3">
                            <Sparkles className="w-3.5 h-3.5" />
                            {scanResult.summary.totalWinners} yeni Action Card oluştu — aşağıda onaylayabilirsin.
                        </p>
                    )}
                </div>
            )}

            {/* ── Filter bar ── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                    {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={cn(
                                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                statusFilter === s
                                    ? 'bg-accent text-white'
                                    : 'text-text-tertiary hover:text-text-secondary hover:bg-white/5'
                            )}
                        >
                            {s === 'ALL' ? 'Tümü' : s === 'PENDING' ? 'Bekleyen' : s === 'APPROVED' ? 'Onaylı' : 'Reddedilen'}
                        </button>
                    ))}
                </div>
                <button onClick={loadCards} className="p-1.5 text-text-tertiary hover:text-text-secondary transition-colors rounded-lg hover:bg-white/5">
                    <RotateCcw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* ── Visual Card Grid (Pinterest) ── */}
            {cardsLoading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-7 h-7 animate-spin text-accent" />
                </div>
            ) : cards.length === 0 ? (
                <div className="rounded-xl border border-border-subtle bg-bg-elevated p-12 text-center">
                    <Target className="w-12 h-12 text-text-tertiary mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium text-text-secondary mb-1">
                        {statusFilter === 'PENDING' ? 'Bekleyen action card yok' : 'Kart bulunamadı'}
                    </p>
                    <p className="text-xs text-text-tertiary">
                        {statusFilter === 'PENDING' ? 'Yukarıdan keyword ekleyip tarama başlat.' : 'Farklı bir filtre dene.'}
                    </p>
                </div>
            ) : (
                <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-0">
                    {cards.map(card => (
                        <div key={card.id} className="break-inside-avoid mb-3">
                            <VisualActionCard
                                card={card}
                                onApprove={handleApprove}
                                onReject={handleReject}
                                onApproveFactory={handleApproveFactory}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
