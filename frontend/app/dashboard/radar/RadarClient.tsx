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
    Sparkles
} from 'lucide-react';
import { apiRadar, CompetitorDesign } from '@/lib/api';
import { toast } from 'sonner';

export function RadarClient() {
    const [shopUrl, setShopUrl] = useState('');
    const [scanning, setScanning] = useState(false);
    const [designs, setDesigns] = useState<CompetitorDesign[]>([]);
    const [history, setHistory] = useState<string[]>([]);

    const handleScan = async () => {
        if (!shopUrl) return;
        setScanning(true);
        const toastId = toast.loading('Syncing with Etsy Rival Radar...');
        try {
            const result = await apiRadar.scan(shopUrl);
            if (result.success) {
                setDesigns(result.designs);
                if (!history.includes(shopUrl)) setHistory([shopUrl, ...history]);
                toast.success(`Found ${result.designs.length} trending designs!`, { id: toastId });
            } else {
                throw new Error(result.error || 'Scan failed');
            }
        } catch (err) {
            toast.error('Radar failed: ' + (err as Error).message, { id: toastId });
        } finally {
            setScanning(false);
        }
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
                    <p className="text-sm text-text-tertiary">Real-time market intelligence on Etsy rival shops</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="px-4 h-11 rounded-xl bg-bg-elevated border border-border-subtle flex items-center gap-2 group focus-within:border-accent/50 transition-all">
                        <Store className="w-4 h-4 text-text-tertiary group-focus-within:text-accent transition-colors" />
                        <input 
                            type="text" 
                            placeholder="Etsy Shop URL" 
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
                        {scanning ? 'Scanning...' : 'Add Shop'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Sidebar: Tracked Shops */}
                <div className="space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-tertiary px-2">Tracked Rivals</h3>
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
                                No shops tracked yet.
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
                                            <span className="text-[10px] bg-bg-base px-2 py-0.5 rounded text-text-tertiary">New Insight</span>
                                        </div>
                                        
                                        <div className="flex items-center gap-2 pt-2">
                                            <a 
                                                href={design.url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="h-7 px-3 rounded-lg bg-bg-overlay border border-border-subtle text-[10px] font-bold text-text-secondary flex items-center gap-1.5 hover:text-accent hover:border-accent/30 transition-all"
                                            >
                                                Source <ExternalLink className="w-2.5 h-2.5" />
                                            </a>
                                            <button className="h-7 px-3 rounded-lg bg-accent/10 border border-accent/20 text-[10px] font-bold text-accent flex items-center gap-1.5 hover:bg-accent hover:text-white transition-all">
                                                <Zap className="w-2.5 h-2.5" />
                                                Create Twist
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
                                <h4 className="text-sm font-bold text-text-secondary">Market Radar is Idle</h4>
                                <p className="text-xs text-text-tertiary max-w-xs leading-relaxed">Enter a rival Etsy shop URL to automatically extract their best-performing designs and feed your AI Factory.</p>
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
                    <p className="text-xs font-medium text-text-primary italic">"AI Insight: Rivals in the Retro Christian niche are seeing 40% higher CTR with distressed mockups."</p>
                </div>
                <button className="relative px-6 h-10 rounded-full bg-accent text-white text-[11px] font-black uppercase tracking-widest hover:scale-105 transition-all">
                    Sync All Radar Data
                </button>
            </div>
        </div>
    );
}
