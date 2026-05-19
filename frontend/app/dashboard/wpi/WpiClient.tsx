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
    WpiSeoPackage, RadarDiscovery, NicheProduct
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Category config ──────────────────────────────────────────────────────────

const proxyImg = (url?: string | null) =>
    url?.startsWith('https://i.etsystatic.com/')
        ? `/api/proxy/img?url=${encodeURIComponent(url)}`
        : (url ?? '');

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
            'rounded-xl border overflow-hidden transition-all duration-200 group h-full flex flex-col',
            isInstant || isHotNow
                ? 'border-orange-500/50 hover:border-orange-400/70 shadow-[0_0_20px_rgba(249,115,22,0.08)]'
                : ac.priority === 'HIGH'
                    ? 'border-violet-500/40 hover:border-violet-400/60 shadow-[0_0_20px_rgba(124,58,237,0.06)]'
                    : 'border-border-default hover:border-border-subtle'
        )}>

            {/* ── Ürün görseli (büyük, tam genişlik) ── */}
            <div className="relative w-full aspect-square overflow-hidden bg-slate-800">
                {card.product.imageUrl?.startsWith('http') ? (
                    <img
                        src={proxyImg(card.product.imageUrl)}
                        alt={card.product.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={e => {
                            const t = e.currentTarget;
                            t.style.display = 'none';
                            const fb = t.nextElementSibling as HTMLElement | null;
                            if (fb) fb.style.display = 'flex';
                        }}
                    />
                ) : null}
                <div className="w-full h-full items-center justify-center" style={{ display: card.product.imageUrl?.startsWith('http') ? 'none' : 'flex' }}>
                    <ShoppingBag className="w-12 h-12 text-slate-600" />
                </div>

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

                {/* Sol alt — Fiyat + Satış + Yorum overlay */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-bold">
                        ${card.product.price}
                    </span>
                    {td.salesCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px]">
                            {td.salesCount} satış
                            {td.salesDelta > 0 && (
                                <span className="text-emerald-400 font-bold ml-1">+{td.salesDelta}</span>
                            )}
                        </span>
                    )}
                    {(card.product.reviewCount ?? 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px]">
                            ★ {card.product.reviewCount} yorum
                        </span>
                    )}
                    {(card.product.reviewCount ?? 0) === 0 && (card.product.shopReviewCount ?? 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-black/70 backdrop-blur-sm text-slate-300 text-[11px]">
                            ★ {card.product.shopReviewCount} mağaza
                        </span>
                    )}
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
                    {((card.product as any).estimatedMonthlyRevenue ?? 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-900/70 backdrop-blur-sm text-emerald-300 text-[9px] font-medium">
                            ~${(card.product as any).estimatedMonthlyRevenue}/ay
                        </span>
                    )}
                </div>
            </div>

            {/* ── Kart gövdesi ── */}
            <div className="p-3 space-y-2.5 bg-bg-elevated flex-1 flex flex-col">
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

                {/* Satış istatistikleri */}
                <div className="grid grid-cols-3 gap-1 text-center">
                    <div className="rounded-lg bg-violet-500/8 border border-violet-500/15 py-1.5">
                        <div className="text-[13px] font-bold text-violet-400 leading-none">
                            {td.salesCount > 0 ? (td.salesCount >= 1000 ? `${(td.salesCount / 1000).toFixed(1)}k` : td.salesCount) : '—'}
                        </div>
                        <div className="text-[8px] text-text-tertiary mt-0.5">toplam satış</div>
                    </div>
                    <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/15 py-1.5">
                        <div className="text-[13px] font-bold text-emerald-400 leading-none">
                            {(card.product as any).estimatedMonthlyRevenue > 0 ? `$${(card.product as any).estimatedMonthlyRevenue}` : '—'}
                        </div>
                        <div className="text-[8px] text-text-tertiary mt-0.5">aylık gelir</div>
                    </div>
                    <div className="rounded-lg bg-blue-500/8 border border-blue-500/15 py-1.5">
                        <div className={cn('text-[13px] font-bold leading-none', td.salesDelta > 0 ? 'text-green-400' : 'text-text-tertiary')}>
                            {td.salesDelta > 0 ? `+${td.salesDelta}` : '—'}
                        </div>
                        <div className="text-[8px] text-text-tertiary mt-0.5">48h yeni</div>
                    </div>
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

// ─── Radar Generate Config ────────────────────────────────────────────────────

const RADAR_MODELS = [
    { id: 'fal-ai/flux/dev',    label: 'Flux Dev',     emoji: '⚡', desc: 'En kaliteli' },
    { id: 'fal-ai/flux/schnell',label: 'Flux Schnell', emoji: '🚀', desc: 'Hızlı & uyumlu' },
    { id: 'fal-ai/ideogram/v2', label: 'Ideogram V2',  emoji: '✍️', desc: 'Metin + görsel' },
    { id: 'fal-ai/recraft-v3',  label: 'Recraft V3',   emoji: '🎨', desc: 'Vektör tarzı' },
];

const RADAR_STYLES = [
    { id: 'vintage',    label: 'Vintage',    emoji: '🏚️' },
    { id: 'minimalist', label: 'Minimal',    emoji: '◻️' },
    { id: 'grunge',     label: 'Grunge',     emoji: '⚡' },
    { id: 'retro',      label: 'Retro',      emoji: '🌈' },
    { id: 'botanical',  label: 'Botanical',  emoji: '🌿' },
    { id: 'collegiate', label: 'Collegiate', emoji: '🏆' },
    { id: 'streetwear', label: 'Street',     emoji: '🔥' },
    { id: 'watercolor', label: 'Watercolor', emoji: '🎨' },
];

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

const RADAR_PAGE_SIZE = 9;

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
    onDirectFactory: (d: RadarDiscovery, model: string, style: string) => void;
}) {
    const [collapsed, setCollapsed]     = useState(false);
    const [showAll, setShowAll]         = useState(false);
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
                            {/* CRITICAL section — her zaman tümünü göster */}
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
                                            <RadarDiscoveryCard key={d.id} discovery={d} isCritical
                                                onAnalyzeInWpi={onAnalyzeInWpi} onDirectFactory={onDirectFactory} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* HOT discoveries — ilk 9, sonrası "Daha Fazla" */}
                            {hotList.length > 0 && (() => {
                                const visible = showAll ? hotList : hotList.slice(0, RADAR_PAGE_SIZE);
                                const remaining = hotList.length - RADAR_PAGE_SIZE;
                                return (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-1.5">
                                            <TrendingUp className="w-3.5 h-3.5 text-violet-400" />
                                            <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
                                                AI Brain Onaylı Adaylar ({hotList.length})
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                            {visible.map(d => (
                                                <RadarDiscoveryCard key={d.id} discovery={d} isCritical={false}
                                                    onAnalyzeInWpi={onAnalyzeInWpi} onDirectFactory={onDirectFactory} />
                                            ))}
                                        </div>
                                        {!showAll && remaining > 0 && (
                                            <button
                                                onClick={() => setShowAll(true)}
                                                className="w-full py-2 rounded-xl border border-border-subtle bg-bg-elevated hover:bg-white/5 text-text-tertiary text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <ChevronDown className="w-3.5 h-3.5" />
                                                Daha Fazla Göster ({remaining} keşif daha)
                                            </button>
                                        )}
                                        {showAll && hotList.length > RADAR_PAGE_SIZE && (
                                            <button
                                                onClick={() => setShowAll(false)}
                                                className="w-full py-2 rounded-xl border border-border-subtle bg-bg-elevated hover:bg-white/5 text-text-tertiary text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                <ChevronUp className="w-3.5 h-3.5" />
                                                Daha Az Göster
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}

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
    onDirectFactory: (d: RadarDiscovery, model: string, style: string) => void;
}) {
    const [modalOpen, setModalOpen]         = useState(false);
    const [modalTab, setModalTab]           = useState<'detail' | 'products'>('detail');
    const [configOpen, setConfigOpen]       = useState(false);
    const [selModel, setSelModel]           = useState('fal-ai/flux/dev');
    const [selStyle, setSelStyle]           = useState('vintage');
    const [products, setProducts]           = useState<NicheProduct[] | null>(null);
    const [productsLoading, setProductsLoading] = useState(false);
    const [productsError, setProductsError] = useState<string | null>(null);
    const [prodSortBy, setProdSortBy]       = useState<'weekly' | 'monthly' | 'total' | 'favorites' | 'newest'>('weekly');
    const [prodMinReviews, setProdMinReviews] = useState(0);
    const [prodMinSales, setProdMinSales]   = useState(1);
    const [prodMaxAge, setProdMaxAge]       = useState<number | null>(null);
    const [prodMinPrice, setProdMinPrice]   = useState<number | null>(null);
    const [prodMaxPrice, setProdMaxPrice]   = useState<number | null>(null);
    const [prodCategory, setProdCategory]   = useState<string>('ALL');

    const loadProducts = async () => {
        if (products || productsLoading) return;
        setProductsLoading(true);
        setProductsError(null);
        try {
            const res = await apiWpi.nicheProducts(d.niche, 30);
            setProducts(res.products);
        } catch (e: any) {
            const msg = e.message || '';
            setProductsError(
                msg.includes('bellek limiti') || msg.includes('memory') || msg.includes('503')
                    ? 'Apify şu an meşgul — 1-2 dakika bekleyip tekrar dene.'
                    : (msg || 'Ürünler yüklenemedi')
            );
        } finally {
            setProductsLoading(false);
        }
    };

    const openProducts = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setModalTab('products');
        setModalOpen(true);
        loadProducts();
    };

    const openConfig = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setModalOpen(false);
        setConfigOpen(true);
    };
    const srcCfg = SOURCE_CONFIG[d.source] ?? SOURCE_CONFIG.etsy;
    const scoreColor = d.discoveryScore >= 90 ? 'text-red-400' : d.discoveryScore >= 80 ? 'text-violet-400' : 'text-amber-400';

    return (
        <>
            {/* ── Kart ── */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setModalOpen(true)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setModalOpen(true); }}
                className={cn(
                    'rounded-xl border p-3 space-y-2 transition-all cursor-pointer select-none',
                    isCritical
                        ? 'border-red-500/40 bg-red-500/5 shadow-[0_0_12px_rgba(239,68,68,0.08)] hover:border-red-500/60'
                        : 'border-border-subtle bg-bg-elevated hover:border-accent/40'
                )}>
                {/* Score + Source */}
                <div className="flex items-center justify-between gap-2">
                    <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border', srcCfg.color)}>
                        {srcCfg.label}
                    </span>
                    <div className={cn('text-sm font-black tabular-nums', scoreColor)}>
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
                    <span className={cn('text-[10px] font-semibold', URGENCY_COLOR[d.urgency as keyof typeof URGENCY_COLOR] ?? 'text-text-tertiary')}>
                        ↑ {d.urgency}
                    </span>
                </div>

                {/* Reasoning (trimmed) */}
                {d.reasoning && (
                    <p className="text-[10px] text-text-tertiary leading-relaxed line-clamp-2">{d.reasoning}</p>
                )}

                {/* Keywords (ilk 3) */}
                {d.suggestedKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {d.suggestedKeywords.slice(0, 3).map(kw => (
                            <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20">
                                {kw}
                            </span>
                        ))}
                        {d.suggestedKeywords.length > 3 && (
                            <span className="text-[9px] text-text-tertiary px-1">+{d.suggestedKeywords.length - 3}</span>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-1.5 pt-0.5 flex-wrap" onClick={e => e.stopPropagation()}>
                    <button
                        onClick={() => onAnalyzeInWpi(d)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-[11px] font-semibold border border-accent/20 transition-colors"
                    >
                        <Brain className="w-3 h-3" />
                        WPI Analiz
                    </button>
                    <button
                        onClick={openProducts}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-semibold border border-blue-500/20 transition-colors"
                    >
                        <ShoppingCart className="w-3 h-3" />
                        Etsy&apos;de Araştır
                    </button>
                    <button
                        onClick={openConfig}
                        className={cn(
                            'w-full flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
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

            {/* ── Generate Config Modal ── */}
            {configOpen && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setConfigOpen(false)}
                >
                    <div
                        className="relative w-full max-w-md rounded-2xl border border-border-default shadow-2xl bg-bg-elevated overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                            <div>
                                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                                    <Factory className="w-4 h-4 text-green-400" />
                                    Üretim Ayarları
                                </h3>
                                <p className="text-[10px] text-text-tertiary mt-0.5 truncate max-w-[280px]">{d.niche}</p>
                            </div>
                            <button onClick={() => setConfigOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-text-tertiary transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-5 space-y-5">
                            {/* Model seçimi */}
                            <div>
                                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Üretim Motoru</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {RADAR_MODELS.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => setSelModel(m.id)}
                                            className={cn(
                                                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all',
                                                selModel === m.id
                                                    ? 'border-accent bg-accent/15 shadow-[0_0_12px_rgba(124,58,237,0.15)]'
                                                    : 'border-border-subtle bg-bg-base hover:border-border-default'
                                            )}
                                        >
                                            <span className="text-lg leading-none">{m.emoji}</span>
                                            <div className="min-w-0">
                                                <p className={cn('text-xs font-semibold', selModel === m.id ? 'text-accent' : 'text-text-primary')}>{m.label}</p>
                                                <p className="text-[9px] text-text-tertiary">{m.desc}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Stil seçimi */}
                            <div>
                                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Tasarım Stili</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {RADAR_STYLES.map(s => (
                                        <button
                                            key={s.id}
                                            onClick={() => setSelStyle(s.id)}
                                            className={cn(
                                                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all',
                                                selStyle === s.id
                                                    ? 'border-violet-500/60 bg-violet-500/20 text-violet-300'
                                                    : 'border-border-subtle bg-bg-base text-text-tertiary hover:text-text-secondary hover:border-border-default'
                                            )}
                                        >
                                            <span>{s.emoji}</span> {s.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Confirm */}
                            <button
                                onClick={() => {
                                    setConfigOpen(false);
                                    onDirectFactory(d, selModel, selStyle);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-bold transition-all shadow-lg"
                            >
                                <Factory className="w-4 h-4" />
                                Üret →
                                <span className="text-[10px] opacity-70 font-normal ml-1">
                                    {RADAR_MODELS.find(m => m.id === selModel)?.label} · {RADAR_STYLES.find(s => s.id === selStyle)?.label}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Info Modal ── */}
            {modalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={() => setModalOpen(false)}
                >
                    <div
                        className={cn(
                            'relative w-full rounded-2xl border shadow-2xl bg-bg-elevated flex flex-col',
                            modalTab === 'products' ? 'max-w-3xl max-h-[92vh]' : 'max-w-lg max-h-[90vh]',
                            isCritical ? 'border-red-500/50' : 'border-border-default'
                        )}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* ── Modal Header ── */}
                        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
                            <div className="flex items-start gap-3 flex-1 min-w-0 pr-8">
                                <div className={cn('text-2xl font-black tabular-nums leading-none', scoreColor)}>
                                    {d.discoveryScore}
                                    <span className="text-xs font-normal text-text-tertiary">/100</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-sm font-bold text-text-primary leading-snug truncate">{d.niche}</h2>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', srcCfg.color)}>{srcCfg.label}</span>
                                        {isCritical && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">CRITICAL</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setModalOpen(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-text-tertiary transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* ── Tabs ── */}
                        <div className="flex gap-1 px-5 pb-0 flex-shrink-0 border-b border-border-subtle">
                            <button
                                onClick={() => setModalTab('detail')}
                                className={cn('px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors -mb-px border-b-2',
                                    modalTab === 'detail' ? 'text-accent border-accent' : 'text-text-tertiary border-transparent hover:text-text-secondary')}
                            >
                                Detaylar
                            </button>
                            <button
                                onClick={() => { setModalTab('products'); loadProducts(); }}
                                className={cn('px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors -mb-px border-b-2 flex items-center gap-1.5',
                                    modalTab === 'products' ? 'text-blue-400 border-blue-400' : 'text-text-tertiary border-transparent hover:text-text-secondary')}
                            >
                                <ShoppingCart className="w-3 h-3" />
                                Etsy Ürünleri
                                {products && <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">{products.length}</span>}
                            </button>
                        </div>

                        {/* ── Tab: Detaylar ── */}
                        {modalTab === 'detail' && (
                            <div className="overflow-y-auto p-5 space-y-4">
                                {d.productRecommendation && (
                                    <div className="rounded-lg bg-bg-overlay border border-border-subtle p-3">
                                        <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold mb-1">Ürün Önerisi</p>
                                        <p className="text-sm text-text-primary font-medium">{d.productRecommendation}</p>
                                    </div>
                                )}
                                {d.reasoning && (
                                    <div className="rounded-lg bg-bg-overlay border border-border-subtle p-3">
                                        <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold mb-1.5">AI Analizi</p>
                                        <p className="text-sm text-text-secondary leading-relaxed">{d.reasoning}</p>
                                    </div>
                                )}
                                {d.suggestedKeywords.length > 0 && (
                                    <div>
                                        <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold mb-2">Önerilen Keyword&apos;ler ({d.suggestedKeywords.length})</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {d.suggestedKeywords.map(kw => (
                                                <span key={kw} className="text-xs px-2 py-1 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20">{kw}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <p className="text-[10px] text-text-tertiary">Keşfedildi: {new Date(d.discoveredAt).toLocaleString('tr-TR')}</p>
                                <div className="flex gap-2 pt-1">
                                    <button onClick={() => { onAnalyzeInWpi(d); setModalOpen(false); }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-accent/15 hover:bg-accent/25 text-accent text-sm font-semibold border border-accent/30 transition-colors">
                                        <Brain className="w-4 h-4" />WPI&apos;da Analiz Et
                                    </button>
                                    <button onClick={openConfig}
                                        className={cn('flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border transition-colors',
                                            isCritical ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/30' : 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border-green-500/20')}>
                                        <Factory className="w-4 h-4" />Hemen Üret
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Tab: Etsy Ürünleri ── */}
                        {modalTab === 'products' && (
                            <div className="flex flex-col overflow-hidden flex-1 min-h-0">
                                {/* Filters */}
                                <div className="px-5 py-3 border-b border-border-subtle flex flex-wrap gap-3 items-center flex-shrink-0">
                                    {/* Sort */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-text-tertiary font-semibold uppercase">Sırala:</span>
                                        {([
                                            { id: 'weekly',    label: 'Haf. Satış' },
                                            { id: 'monthly',   label: 'Ay. Satış' },
                                            { id: 'total',     label: 'Toplam' },
                                            { id: 'favorites', label: 'Favori' },
                                            { id: 'newest',    label: 'En Yeni' },
                                        ] as const).map(s => (
                                            <button key={s.id} onClick={() => setProdSortBy(s.id)}
                                                className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors',
                                                    prodSortBy === s.id ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-bg-base text-text-tertiary border-border-subtle hover:border-border-default')}>
                                                {s.label}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Min weekly sales */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-text-tertiary font-semibold uppercase">Min Satış:</span>
                                        {([0, 1, 5, 20] as const).map(v => (
                                            <button key={v} onClick={() => setProdMinSales(v)}
                                                className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors',
                                                    prodMinSales === v ? 'bg-green-500/20 text-green-300 border-green-500/40' : 'bg-bg-base text-text-tertiary border-border-subtle hover:border-border-default')}>
                                                {v === 0 ? 'Tümü' : `${v}+/haf`}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Min reviews */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-text-tertiary font-semibold uppercase">Min Yorum:</span>
                                        {[0, 5, 20, 50, 100].map(v => (
                                            <button key={v} onClick={() => setProdMinReviews(v)}
                                                className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors',
                                                    prodMinReviews === v ? 'bg-violet-500/20 text-violet-300 border-violet-500/40' : 'bg-bg-base text-text-tertiary border-border-subtle hover:border-border-default')}>
                                                {v === 0 ? 'Tümü' : `${v}+`}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Max listing age */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-text-tertiary font-semibold uppercase">Yaş:</span>
                                        {([null, 30, 90, 180, 365] as const).map(v => (
                                            <button key={String(v)} onClick={() => setProdMaxAge(v)}
                                                className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors',
                                                    prodMaxAge === v ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-bg-base text-text-tertiary border-border-subtle hover:border-border-default')}>
                                                {v === null ? 'Tümü' : v === 30 ? '1 ay' : v === 90 ? '3 ay' : v === 180 ? '6 ay' : '1 yıl'}
                                            </button>
                                        ))}
                                    </div>
                                    {/* Kategori grupla */}
                                    <div className="flex items-center gap-1.5 flex-wrap w-full border-t border-border-subtle pt-2">
                                        <span className="text-[10px] text-text-tertiary font-semibold uppercase">Kategori:</span>
                                        {([
                                            { id: 'ALL',              label: 'Tümü' },
                                            { id: 'POD_APPAREL',      label: 'Giyim' },
                                            { id: 'HOME_DECOR',       label: 'Ev Dekor' },
                                            { id: 'ACCESSORIES',      label: 'Aksesuar' },
                                            { id: 'DIGITAL_DOWNLOAD', label: 'Dijital' },
                                        ] as const).map(c => (
                                            <button key={c.id} onClick={() => setProdCategory(c.id)}
                                                className={cn('px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors',
                                                    prodCategory === c.id ? 'bg-accent/20 text-accent border-accent/40' : 'bg-bg-base text-text-tertiary border-border-subtle hover:border-border-default')}>
                                                {c.label}
                                                {c.id !== 'ALL' && products && (() => {
                                                    const count = products.filter(p => {
                                                        const cat = p.category || (
                                                            /shirt|tee|hoodie|sweatshirt|clothing|tank|jacket|dress|shorts|legging|onesie/i.test(p.title) ? 'POD_APPAREL' :
                                                            /wall art|poster|print|home decor|pillow|blanket|mug|cup|canvas|frame|tapestry/i.test(p.title) ? 'HOME_DECOR' :
                                                            /bag|tote|hat|cap|phone case|keychain/i.test(p.title) ? 'ACCESSORIES' : 'POD_APPAREL'
                                                        );
                                                        return cat === c.id;
                                                    }).length;
                                                    return count > 0 ? <span className="ml-1 opacity-60">({count})</span> : null;
                                                })()}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Product list */}
                                <div className="overflow-y-auto flex-1 p-4">
                                    {productsLoading && (
                                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                                            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                                            <p className="text-sm text-text-tertiary">Etsy&apos;den ürünler çekiliyor<br/><span className="text-[11px]">30-60 saniye sürebilir...</span></p>
                                        </div>
                                    )}
                                    {productsError && (
                                        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            {productsError}
                                        </div>
                                    )}
                                    {products && (() => {
                                        const detectCat = (p: NicheProduct) => {
                                            if (p.category) return p.category;
                                            const t = p.title;
                                            if (/shirt|tee|hoodie|sweatshirt|clothing|tank|jacket|dress|shorts|legging|onesie/i.test(t)) return 'POD_APPAREL';
                                            if (/wall art|poster|print|home decor|pillow|blanket|mug|cup|canvas|frame|tapestry/i.test(t)) return 'HOME_DECOR';
                                            if (/bag|tote|hat|cap|phone case|keychain/i.test(t)) return 'ACCESSORIES';
                                            return 'POD_APPAREL';
                                        };
                                        const filtered = products
                                            .filter(p => prodCategory === 'ALL' || detectCat(p) === prodCategory)
                                            .filter(p => prodMinSales === 0 || (p.weeklySales !== null && p.weeklySales >= prodMinSales))
                                            .filter(p => p.reviewCount >= prodMinReviews)
                                            .filter(p => prodMaxAge === null || (p.listingAgeDays !== null && p.listingAgeDays <= prodMaxAge))
                                            .filter(p => prodMinPrice === null || p.price >= prodMinPrice)
                                            .filter(p => prodMaxPrice === null || p.price <= prodMaxPrice)
                                            .sort((a, b) => {
                                                if (prodSortBy === 'weekly')    return (b.weeklySales  ?? -1) - (a.weeklySales  ?? -1);
                                                if (prodSortBy === 'monthly')   return (b.monthlySales ?? -1) - (a.monthlySales ?? -1);
                                                if (prodSortBy === 'total')     return b.totalEstimatedSales - a.totalEstimatedSales;
                                                if (prodSortBy === 'favorites') return b.favoriteCount - a.favoriteCount;
                                                if (prodSortBy === 'newest')    return (a.listingAgeDays ?? 9999) - (b.listingAgeDays ?? 9999);
                                                return 0;
                                            });
                                        if (!filtered.length) return (
                                            <div className="text-center py-12 text-text-tertiary text-sm">Bu filtrelere uygun ürün bulunamadı.</div>
                                        );
                                        const renderCard = (p: NicheProduct) => (
                                            <div key={p.listingId} className="rounded-xl border border-border-subtle bg-bg-base overflow-hidden hover:border-blue-500/40 transition-all group flex flex-col h-full">
                                                <div className="aspect-square bg-bg-overlay relative overflow-hidden flex-shrink-0">
                                                    {p.imageUrl?.startsWith('http') ? (
                                                        <img
                                                            src={proxyImg(p.imageUrl)}
                                                            alt={p.title}
                                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                            onError={e => {
                                                                const t = e.currentTarget;
                                                                t.style.display = 'none';
                                                                const fb = t.nextElementSibling as HTMLElement | null;
                                                                if (fb) fb.style.display = 'flex';
                                                            }}
                                                        />
                                                    ) : null}
                                                    <div className="w-full h-full items-center justify-center text-text-tertiary" style={{ display: p.imageUrl?.startsWith('http') ? 'none' : 'flex' }}>
                                                        <ShoppingBag className="w-8 h-8 opacity-30" />
                                                    </div>
                                                    {p.isBestSeller && (
                                                        <span className="absolute top-1.5 left-1.5 text-[9px] font-black bg-amber-500 text-black px-1.5 py-0.5 rounded-full uppercase tracking-wide">Bestseller</span>
                                                    )}
                                                    <span className="absolute bottom-1.5 left-1.5 text-[11px] font-bold bg-black/75 backdrop-blur-sm text-white px-2 py-0.5 rounded-full">
                                                        ${p.price.toFixed(2)}
                                                    </span>
                                                    {p.listingAgeDays !== null && (
                                                        <span className="absolute top-1.5 right-1.5 text-[9px] bg-black/60 text-white/80 px-1.5 py-0.5 rounded-full">
                                                            {p.listingAgeDays < 30
                                                                ? `${p.listingAgeDays}g`
                                                                : p.listingAgeDays < 365
                                                                    ? `${Math.round(p.listingAgeDays / 30)}ay`
                                                                    : `${(p.listingAgeDays / 365).toFixed(1)}y`}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="p-2.5 flex flex-col gap-2 flex-1">
                                                    <p className="text-[11px] font-medium text-text-primary line-clamp-2 leading-snug">{p.title}</p>
                                                    <div className="grid grid-cols-3 gap-1">
                                                        <div className="rounded-lg bg-green-500/8 border border-green-500/15 py-1 text-center">
                                                            <div className="text-[12px] font-bold text-green-400 leading-none">
                                                                {p.weeklySales !== null && p.weeklySales > 0 ? p.weeklySales : '—'}
                                                            </div>
                                                            <div className="text-[8px] text-text-tertiary mt-0.5">haf/satış</div>
                                                        </div>
                                                        <div className="rounded-lg bg-blue-500/8 border border-blue-500/15 py-1 text-center">
                                                            <div className="text-[12px] font-bold text-blue-400 leading-none">
                                                                {p.monthlySales !== null && p.monthlySales > 0 ? p.monthlySales : '—'}
                                                            </div>
                                                            <div className="text-[8px] text-text-tertiary mt-0.5">ay/satış</div>
                                                        </div>
                                                        <div className="rounded-lg bg-violet-500/8 border border-violet-500/15 py-1 text-center">
                                                            <div className="text-[12px] font-bold text-violet-400 leading-none">
                                                                {p.totalEstimatedSales > 0 ? (p.totalEstimatedSales >= 1000 ? `${(p.totalEstimatedSales / 1000).toFixed(1)}k` : p.totalEstimatedSales) : '—'}
                                                            </div>
                                                            <div className="text-[8px] text-text-tertiary mt-0.5">toplam</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-text-tertiary flex-wrap">
                                                        {p.rating && <span className="text-amber-400 font-medium">★ {p.rating.toFixed(1)}</span>}
                                                        {p.reviewCount > 0 && <span>{p.reviewCount} yorum</span>}
                                                        {p.favoriteCount > 0 && <span>♥ {p.favoriteCount}</span>}
                                                        {(p as any).estimatedMonthlyRevenue > 0 && (
                                                            <span className="ml-auto text-emerald-400 font-semibold">
                                                                ~${(p as any).estimatedMonthlyRevenue}/ay
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1 mt-auto pt-0.5">
                                                        <a href={p.listingUrl} target="_blank" rel="noopener noreferrer"
                                                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-bg-overlay hover:bg-white/10 text-text-tertiary text-[10px] border border-border-subtle transition-colors">
                                                            <ArrowRight className="w-2.5 h-2.5" />Etsy
                                                        </a>
                                                        <button
                                                            onClick={() => {
                                                                setModalOpen(false);
                                                                const prompt = `${p.title.slice(0, 80)}, ${d.niche}`;
                                                                setTimeout(() => {
                                                                    const params = new URLSearchParams({ prompt, model: selModel, style: selStyle, niche: d.niche });
                                                                    window.location.href = `/dashboard/factory?${params.toString()}`;
                                                                }, 100);
                                                            }}
                                                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-green-600/10 hover:bg-green-600/20 text-green-400 text-[10px] border border-green-500/20 transition-colors">
                                                            <Factory className="w-2.5 h-2.5" />Üret
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                        if (prodCategory !== 'ALL') {
                                            return (
                                                <div className="grid grid-cols-3 gap-3" style={{ gridAutoRows: 'auto' }}>
                                                    {filtered.map(renderCard)}
                                                </div>
                                            );
                                        }
                                        const CAT_ORDER = ['POD_APPAREL', 'HOME_DECOR', 'ACCESSORIES', 'DIGITAL_DOWNLOAD'];
                                        const grouped: Record<string, NicheProduct[]> = {};
                                        for (const p of filtered) {
                                            const cat = detectCat(p);
                                            if (!grouped[cat]) grouped[cat] = [];
                                            grouped[cat].push(p);
                                        }
                                        return (
                                            <div className="space-y-6">
                                                {CAT_ORDER.filter(cat => grouped[cat]?.length).map(cat => {
                                                    const cfg = CATEGORY_CONFIG[cat] ?? { label: cat, color: 'bg-slate-700/60 text-slate-300 border-slate-700/60', dot: 'bg-slate-400' };
                                                    return (
                                                        <div key={cat}>
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border', cfg.color)}>
                                                                    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
                                                                    {cfg.label}
                                                                </span>
                                                                <span className="text-[10px] text-text-tertiary">{grouped[cat].length} ürün</span>
                                                                <div className="flex-1 h-px bg-border-subtle" />
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-3" style={{ gridAutoRows: 'auto' }}>
                                                                {grouped[cat].map(renderCard)}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
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
            const res = await apiWpi.radarDiscoveries(168);
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

    const handleRadarDirectFactory = async (d: RadarDiscovery, model: string, style: string) => {
        try {
            await apiWpi.radarSendFactory(d.id);
            toast.success(`Draft Task oluşturuldu: "${d.niche.slice(0, 45)}"`);
        } catch {
            toast.error('Draft Task oluşturulamadı — yine de Factory\'ye yönlendiriliyor');
        }
        const prompt = `${d.niche}${d.productRecommendation ? ` ${d.productRecommendation}` : ''}, ${d.suggestedKeywords.slice(0, 2).join(', ')}`;
        const params = new URLSearchParams({
            prompt,
            model,
            style,
            niche: d.niche,
        });
        window.location.href = `/dashboard/factory?${params.toString()}`;
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
                let consecutiveErrors = 0;
                const MAX_ERRORS = 5;
                const interval = setInterval(async () => {
                    try {
                        const poll = await apiWpi.pollScan(start.scanId);
                        consecutiveErrors = 0;
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
                        consecutiveErrors++;
                        if (consecutiveErrors >= MAX_ERRORS) {
                            clearInterval(interval);
                            reject(pollErr);
                        }
                        // transient network error — bir sonraki poll'a devam et
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
                <div className="grid grid-cols-3 gap-3" style={{ gridAutoRows: '1fr' }}>
                    {[...cards].sort((a, b) => (b.brainComparison?.confidence ?? 0) - (a.brainComparison?.confidence ?? 0)).map(card => (
                        <VisualActionCard
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
    );
}
