'use client';

import { useState } from 'react';
import {
    Radar,
    Search,
    TrendingUp,
    Plus,
    Store,
    ExternalLink,
    Zap,
    Loader2,
    Target,
    BarChart2,
    Sparkles,
    Eye,
    Brain,
    Copy,
    CheckCheck,
    ImageIcon,
    RefreshCw,
} from 'lucide-react';
import { apiRadar, apiApify, CompetitorDesign, PinterestTrend } from '@/lib/api';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

type Tab = 'rivals' | 'visual';

export function RadarClient() {
    const router = useRouter();
    const [tab, setTab] = useState<Tab>('rivals');

    // ── Rivals tab ──────────────────────────────────────────────────────────────
    const [shopUrl, setShopUrl]   = useState('');
    const [scanning, setScanning] = useState(false);
    const [designs, setDesigns]   = useState<CompetitorDesign[]>([]);
    const [history, setHistory]   = useState<string[]>([]);

    const handleScan = async () => {
        if (!shopUrl) return;
        setScanning(true);
        const toastId = toast.loading('Rakip mağaza taranıyor...');
        try {
            const result = await apiRadar.scan(shopUrl);
            if (result.success) {
                setDesigns(result.designs);
                if (!history.includes(shopUrl)) setHistory([shopUrl, ...history]);
                toast.success(`${result.designs.length} trend tasarım bulundu!`, { id: toastId });
            } else {
                throw new Error('Tarama başarısız');
            }
        } catch (err) {
            toast.error('Radar hatası: ' + (err as Error).message, { id: toastId });
        } finally {
            setScanning(false);
        }
    };

    // ── Visual Intelligence tab ──────────────────────────────────────────────────
    const [pinKeyword, setPinKeyword]   = useState('');
    const [pinScanning, setPinScanning] = useState(false);
    const [pinTrends, setPinTrends]     = useState<PinterestTrend[]>([]);
    const [savedCount, setSavedCount]   = useState<number | null>(null);
    const [copied, setCopied]           = useState<string | null>(null);

    const handlePinterestScan = async () => {
        if (!pinKeyword.trim()) return;
        setPinScanning(true);
        setSavedCount(null);
        const toastId = toast.loading('Pinterest trendleri analiz ediliyor (Claude Vision çalışıyor)...');
        try {
            const result = await apiApify.pinterestTrends(pinKeyword.trim(), 12, true);
            if (result.success) {
                setPinTrends(result.trends);
                setSavedCount(result.savedToKnowledge ?? 0);
                toast.success(`${result.trends.length} trend görseli analiz edildi — ${result.savedToKnowledge ?? 0} Brain'e kaydedildi.`, { id: toastId });
            } else {
                throw new Error('Pinterest taraması başarısız');
            }
        } catch (err) {
            toast.error('Visual scan hatası: ' + (err as Error).message, { id: toastId });
        } finally {
            setPinScanning(false);
        }
    };

    const copyPrompt = async (text: string, key: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const sendToFactory = (prompt: string) => {
        router.push(`/dashboard/factory?prompt=${encodeURIComponent(prompt)}`);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3 text-accent">
                        <Radar className="w-6 h-6 animate-pulse" />
                        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Competitor Radar</h1>
                    </div>
                    <p className="text-sm text-text-tertiary">Gerçek zamanlı pazar istihbaratı ve görsel trend analizi</p>
                </div>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center gap-1 p-1 bg-bg-elevated border border-border-subtle rounded-xl w-fit">
                <button
                    onClick={() => setTab('rivals')}
                    className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                        tab === 'rivals'
                            ? 'bg-accent text-white shadow'
                            : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                >
                    <span className="flex items-center gap-2"><Store className="w-3.5 h-3.5" /> Rakip Mağazalar</span>
                </button>
                <button
                    onClick={() => setTab('visual')}
                    className={`px-4 py-2 rounded-[10px] text-sm font-semibold transition-all ${
                        tab === 'visual'
                            ? 'bg-accent text-white shadow'
                            : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                >
                    <span className="flex items-center gap-2"><Eye className="w-3.5 h-3.5" /> Visual Intelligence</span>
                </button>
            </div>

            {/* ── Rivals Tab ──────────────────────────────────────────────────── */}
            {tab === 'rivals' && (
                <>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="px-4 h-11 rounded-xl bg-bg-elevated border border-border-subtle flex items-center gap-2 group focus-within:border-accent/50 transition-all">
                            <Store className="w-4 h-4 text-text-tertiary group-focus-within:text-accent transition-colors" />
                            <input
                                type="text"
                                placeholder="Etsy Mağaza URL'si"
                                value={shopUrl}
                                onChange={(e) => setShopUrl(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                                className="bg-transparent border-none text-sm outline-none w-48 lg:w-64"
                            />
                        </div>
                        <button
                            onClick={handleScan}
                            disabled={scanning}
                            className="h-11 px-6 rounded-xl bg-accent text-white font-bold text-sm flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            {scanning ? 'Taranıyor...' : 'Mağaza Ekle'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Sidebar: Tracked Shops */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary px-2">Takip Edilen Rakipler</h3>
                            <div className="space-y-1">
                                {history.length > 0 ? history.map((h, i) => (
                                    <button
                                        key={i}
                                        onClick={() => { setShopUrl(h); handleScan(); }}
                                        className="w-full p-3 rounded-xl hover:bg-bg-elevated text-left group flex items-center justify-between border border-transparent hover:border-border-subtle transition-all"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-bg-overlay flex items-center justify-center text-text-tertiary group-hover:text-accent group-hover:bg-accent/10 transition-all">
                                                <Target className="w-4 h-4" />
                                            </div>
                                            <span className="text-xs font-medium text-text-secondary truncate max-w-[120px]">{h.replace('https://www.etsy.com/shop/', '')}</span>
                                        </div>
                                        <BarChart2 className="w-3 h-3 opacity-0 group-hover:opacity-40" />
                                    </button>
                                )) : (
                                    <div className="p-4 text-center border border-dashed border-border-subtle rounded-2xl text-[10px] text-text-tertiary">
                                        Henüz takip edilen mağaza yok.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Main: Trends List */}
                        <div className="lg:col-span-3 space-y-6">
                            {designs.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    {designs.map((design, i) => (
                                        <div key={i} className="group p-4 rounded-2xl bg-bg-elevated border border-border-subtle hover:border-accent/40 transition-all flex items-start gap-4">
                                            <div className="w-16 h-16 rounded-xl bg-bg-base border border-border-subtle flex items-center justify-center overflow-hidden shrink-0">
                                                <div className="w-full h-full bg-gradient-to-br from-bg-overlay tracking-tight flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <Sparkles className="w-6 h-6 text-accent/20" />
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-2">
                                                <h4 className="text-sm font-bold text-text-primary truncate">{design.title}</h4>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xs font-black text-accent">{design.price}</span>
                                                </div>
                                                <div className="flex items-center gap-2 pt-2">
                                                    <a
                                                        href={design.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="h-7 px-3 rounded-lg bg-bg-overlay border border-border-subtle text-[10px] font-bold text-text-secondary flex items-center gap-1.5 hover:text-accent hover:border-accent/30 transition-all"
                                                    >
                                                        Kaynak <ExternalLink className="w-2.5 h-2.5" />
                                                    </a>
                                                    <button className="h-7 px-3 rounded-lg bg-accent/10 border border-accent/20 text-[10px] font-bold text-accent flex items-center gap-1.5 hover:bg-accent hover:text-white transition-all">
                                                        <Zap className="w-2.5 h-2.5" />
                                                        Twist Üret
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-96 rounded-[32px] border border-dashed border-border-subtle flex flex-col items-center justify-center text-center space-y-4 p-8">
                                    <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center">
                                        <Search className="w-8 h-8 text-text-tertiary opacity-20" />
                                    </div>
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-bold text-text-secondary">Market Radar Beklemede</h4>
                                        <p className="text-xs text-text-tertiary max-w-xs leading-relaxed">Rakip Etsy mağazası URL'si girerek otomatik trend analizi başlat.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Radar Insights Footer */}
                    <div className="p-6 rounded-2xl bg-accent/5 border border-accent/20 flex flex-col md:flex-row items-center justify-between gap-4 overflow-hidden relative">
                        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_50%,rgba(var(--accent-rgb),0.05),transparent)] pointer-events-none" />
                        <div className="flex items-center gap-4 relative">
                            <TrendingUp className="w-5 h-5 text-accent shrink-0" />
                            <p className="text-xs font-medium text-text-primary italic">"AI Insight: Retro Christian nişindeki rakipler distressed mockup ile %40 daha yüksek CTR elde ediyor."</p>
                        </div>
                        <button className="relative px-6 h-10 rounded-full bg-accent text-white text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all">
                            Tüm Radar Verisini Senkronize Et
                        </button>
                    </div>
                </>
            )}

            {/* ── Visual Intelligence Tab ─────────────────────────────────────── */}
            {tab === 'visual' && (
                <div className="space-y-8">
                    {/* Pinterest Bridge */}
                    <div className="p-5 rounded-2xl bg-accent/5 border border-accent/20 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center">
                                <Eye className="w-5 h-5 text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-text-primary">Pinterest Visual Intelligence</h3>
                                <p className="text-xs text-text-tertiary">Pinterest trendlerini Claude Vision ile analiz et → tasarım promptu üret → Brain'e kaydet</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex-1 min-w-[200px] px-4 h-11 rounded-xl bg-bg-base border border-border-subtle flex items-center gap-2 group focus-within:border-accent/50 transition-all">
                                <Search className="w-4 h-4 text-text-tertiary group-focus-within:text-accent transition-colors" />
                                <input
                                    type="text"
                                    placeholder="örn. boho wall art, vintage eagle shirt..."
                                    value={pinKeyword}
                                    onChange={e => setPinKeyword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handlePinterestScan()}
                                    className="bg-transparent border-none text-sm outline-none flex-1"
                                />
                            </div>
                            <button
                                onClick={handlePinterestScan}
                                disabled={pinScanning || !pinKeyword.trim()}
                                className="h-11 px-6 rounded-xl bg-accent text-white font-bold text-sm flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                            >
                                {pinScanning
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Analiz Ediliyor...</>
                                    : <><Sparkles className="w-4 h-4" /> Visual Scan</>
                                }
                            </button>
                        </div>
                        {savedCount !== null && (
                            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                                <Brain className="w-3.5 h-3.5" />
                                {savedCount} trend görseli AI Brain'e VISUAL_TRENDS olarak kaydedildi. Factory ve SEO üretimlerinde otomatik kullanılacak.
                            </div>
                        )}
                    </div>

                    {/* Trend Cards Grid */}
                    {pinScanning ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden animate-pulse">
                                    <div className="aspect-square bg-bg-overlay" />
                                    <div className="p-4 space-y-2">
                                        <div className="h-3 bg-bg-overlay rounded w-3/4" />
                                        <div className="h-3 bg-bg-overlay rounded w-1/2" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : pinTrends.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-in fade-in duration-500">
                            {pinTrends.map((pin, i) => (
                                <div key={i} className="group bg-bg-elevated border border-border-subtle hover:border-accent/40 rounded-2xl overflow-hidden flex flex-col transition-all">
                                    {/* Image */}
                                    <div className="aspect-square relative overflow-hidden bg-bg-overlay">
                                        {pin.imageUrl ? (
                                            <img
                                                src={pin.imageUrl}
                                                alt={pin.title}
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                onError={e => { e.currentTarget.style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <ImageIcon className="w-8 h-8 text-text-tertiary opacity-20" />
                                            </div>
                                        )}
                                        {/* Repin badge */}
                                        {pin.repins > 0 && (
                                            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                                <RefreshCw className="w-2.5 h-2.5" /> {pin.repins.toLocaleString()}
                                            </div>
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="p-4 flex flex-col gap-3 flex-1">
                                        <h4 className="text-sm font-bold text-text-primary line-clamp-2 leading-snug">{pin.title || '(başlıksız)'}</h4>

                                        {/* Vision Insight */}
                                        {pin.visionInsight && (
                                            <div className="bg-bg-overlay rounded-xl p-3 space-y-1">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-violet-400 flex items-center gap-1">
                                                    <Eye className="w-2.5 h-2.5" /> Claude Vision Analizi
                                                </span>
                                                <p className="text-[11px] text-text-secondary leading-relaxed">{pin.visionInsight}</p>
                                            </div>
                                        )}

                                        {/* Design Prompt */}
                                        {pin.designPrompt && (
                                            <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 space-y-2">
                                                <span className="text-[9px] font-black uppercase tracking-widest text-accent flex items-center gap-1">
                                                    <Sparkles className="w-2.5 h-2.5" /> Önerilen Tasarım Promptu
                                                </span>
                                                <p className="text-[11px] text-text-primary leading-relaxed font-mono">{pin.designPrompt}</p>
                                                <div className="flex items-center gap-2 pt-1">
                                                    <button
                                                        onClick={() => copyPrompt(pin.designPrompt!, `prompt-${i}`)}
                                                        className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80 transition-colors"
                                                    >
                                                        {copied === `prompt-${i}` ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                                        {copied === `prompt-${i}` ? 'Kopyalandı!' : 'Kopyala'}
                                                    </button>
                                                    <button
                                                        onClick={() => sendToFactory(pin.designPrompt!)}
                                                        className="flex items-center gap-1 text-[10px] font-bold text-white bg-accent hover:bg-accent/80 px-2.5 py-1 rounded-lg transition-colors"
                                                    >
                                                        <Zap className="w-2.5 h-2.5" /> Factory'e Gönder
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Source link */}
                                        {pin.pinUrl && (
                                            <a
                                                href={pin.pinUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-accent transition-colors mt-auto"
                                            >
                                                <ExternalLink className="w-2.5 h-2.5" /> Pinterest'te gör
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-72 rounded-[32px] border border-dashed border-border-subtle flex flex-col items-center justify-center text-center space-y-4 p-8">
                            <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center">
                                <Eye className="w-8 h-8 text-text-tertiary opacity-20" />
                            </div>
                            <div className="space-y-1">
                                <h4 className="text-sm font-bold text-text-secondary">Visual Intelligence Beklemede</h4>
                                <p className="text-xs text-text-tertiary max-w-xs leading-relaxed">
                                    Bir anahtar kelime gir, Pinterest'teki trend görselleri Claude Vision ile analiz edilsin ve
                                    hazır Flux/Ideogram promptları üretilsin.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
