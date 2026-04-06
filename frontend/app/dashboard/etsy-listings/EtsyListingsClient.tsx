'use client';

import { useState } from 'react';
import { Loader2, Store, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface ScrapedListing {
    id: string;
    title: string;
    price: string;
}

interface OptimizedListing {
    title: string;
    description: string;
    tags: string[];
}

interface ListingWithOptimization extends ScrapedListing {
    optimizing?: boolean;
    optimized?: OptimizedListing | null;
    showOptimized?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export function EtsyListingsClient() {
    const [scanning, setScanning] = useState(false);
    const [listings, setListings] = useState<ListingWithOptimization[]>([]);

    const handleScan = async () => {
        setScanning(true);
        setListings([]);
        try {
            const res = await fetch(`${API_BASE}/api/etsy-browser/scrape`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await res.json();
            if (data.success) {
                setListings(data.listings.map((l: ScrapedListing) => ({ ...l })));
                toast.success(`Found ${data.listings.length} listings`);
            } else {
                toast.error(data.error || 'Scrape failed');
            }
        } catch {
            toast.error('Failed to connect to browser automation');
        } finally {
            setScanning(false);
        }
    };

    const handleOptimizeSEO = async (index: number) => {
        const listing = listings[index];
        setListings(prev => prev.map((l, i) => i === index ? { ...l, optimizing: true } : l));
        try {
            const res = await fetch(`${API_BASE}/api/seo/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ keyword: listing.title }),
            });
            const data = await res.json();
            setListings(prev => prev.map((l, i) =>
                i === index
                    ? { ...l, optimizing: false, optimized: data, showOptimized: true }
                    : l
            ));
            toast.success('SEO optimized!');
        } catch {
            toast.error('SEO generation failed');
            setListings(prev => prev.map((l, i) => i === index ? { ...l, optimizing: false } : l));
        }
    };

    const toggleOptimized = (index: number) => {
        setListings(prev => prev.map((l, i) =>
            i === index ? { ...l, showOptimized: !l.showOptimized } : l
        ));
    };

    return (
        <div className="space-y-6 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-text-primary">My Etsy Listings</h1>
                    <p className="text-sm text-text-secondary mt-1">
                        Scan your shop and optimize listing SEO with AI
                    </p>
                </div>
                <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-[10px] text-sm font-medium transition-all disabled:opacity-40"
                >
                    {scanning
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning shop...</>
                        : <><Store className="w-4 h-4" /> Scan My Etsy Shop</>
                    }
                </button>
            </div>

            {/* Empty state */}
            {!scanning && listings.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
                    <Store className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-base font-medium text-text-secondary">No listings loaded yet</p>
                    <p className="text-sm mt-1">Click "Scan My Etsy Shop" to load your listings</p>
                </div>
            )}

            {/* Listings table */}
            {listings.length > 0 && (
                <div className="space-y-3">
                    <p className="text-xs text-text-tertiary">{listings.length} listing{listings.length !== 1 ? 's' : ''} found</p>
                    {listings.map((listing, index) => (
                        <div
                            key={listing.id}
                            className="bg-bg-elevated border border-border-default rounded-[12px] overflow-hidden"
                        >
                            {/* Row */}
                            <div className="flex items-center justify-between px-4 py-3 gap-4">
                                <div className="flex items-center gap-4 min-w-0 flex-1">
                                    <span className="text-[10px] font-mono text-text-tertiary shrink-0">#{listing.id}</span>
                                    <p className="text-sm text-text-primary truncate">{listing.title || '(untitled)'}</p>
                                    {listing.price && (
                                        <span className="text-xs text-text-secondary shrink-0">{listing.price}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {listing.optimized && (
                                        <button
                                            onClick={() => toggleOptimized(index)}
                                            className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
                                        >
                                            {listing.showOptimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                            {listing.showOptimized ? 'Hide' : 'Show'} SEO
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleOptimizeSEO(index)}
                                        disabled={listing.optimizing}
                                        className="flex items-center gap-1.5 bg-bg-overlay hover:bg-accent-subtle text-text-secondary hover:text-accent border border-border-default hover:border-accent/30 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all disabled:opacity-40"
                                    >
                                        {listing.optimizing
                                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Optimizing...</>
                                            : <><Sparkles className="w-3 h-3" /> Optimize SEO</>
                                        }
                                    </button>
                                </div>
                            </div>

                            {/* Before / After comparison */}
                            {listing.optimized && listing.showOptimized && (
                                <div className="border-t border-border-default grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-default">
                                    {/* Before */}
                                    <div className="p-4 space-y-2">
                                        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">Before</p>
                                        <p className="text-sm text-text-primary">{listing.title || '(no title)'}</p>
                                        <p className="text-xs text-text-tertiary italic">No SEO description</p>
                                    </div>

                                    {/* After */}
                                    <div className="p-4 space-y-2">
                                        <p className="text-[10px] font-semibold text-accent uppercase tracking-wider">After (AI Optimized)</p>
                                        <p className="text-sm text-text-primary font-medium">{listing.optimized.title}</p>
                                        <p className="text-xs text-text-secondary line-clamp-3">{listing.optimized.description}</p>
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {listing.optimized.tags.slice(0, 6).map((tag, i) => (
                                                <span key={i} className="px-2 py-0.5 bg-bg-overlay text-text-tertiary text-[10px] rounded font-mono border border-border-default">
                                                    {tag}
                                                </span>
                                            ))}
                                            {listing.optimized.tags.length > 6 && (
                                                <span className="text-[10px] text-text-tertiary self-center">+{listing.optimized.tags.length - 6} more</span>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-text-tertiary pt-1">
                                            "Apply Changes" via browser automation — coming soon
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
