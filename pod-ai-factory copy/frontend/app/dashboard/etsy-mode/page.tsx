'use client';

import { useState } from 'react';

const STYLES = [
    { value: 'vintage', label: '🏛️ Vintage / Distressed' },
    { value: 'retro', label: '🌈 Retro 80s' },
    { value: 'minimalist', label: '⬜ Minimalist' },
    { value: 'bold', label: '🔴 Bold Graphic' },
    { value: 'grunge', label: '🖤 Grunge' },
    { value: 'watercolor', label: '🎨 Watercolor' },
    { value: 'typography', label: '✏️ Typography' },
];

const NICHES = [
    'outdoor_camping', 'usa_patriotic', 'gym_fitness', 'pet_lovers',
    'gaming_nerd', 'sports_varsity', 'mom_life', 'dad_jokes',
    'teacher_life', 'nurse_life', 'coffee_lover', 'music_vibes',
    'travel_wanderlust', 'birthday', 'christmas', 'valentines',
];

export default function EtsyModePage() {
    const [keyword, setKeyword] = useState('');
    const [niche, setNiche] = useState('outdoor_camping');
    const [style, setStyle] = useState('vintage');
    const [designCount, setDesignCount] = useState(20);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState('');

    const handleRun = async () => {
        if (!keyword.trim()) { setError('Keyword gerekli!'); return; }
        setLoading(true);
        setError('');
        setResult(null);

        try {
            const res = await fetch('/api/factory/etsy-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ keyword, niche, style, designCount }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Etsy Mode failed');
            setResult(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '32px', maxWidth: 800, margin: '0 auto' }}>
            <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: 4 }}>
                🏪 Etsy Seller Mode
            </h1>
            <p style={{ color: '#888', marginBottom: 32 }}>
                Keyword → Full Etsy Listing: 20 design variations, mockups, SEO, CSV
            </p>

            {/* Input Form */}
            <div style={{
                background: '#1a1a2e', borderRadius: 12, padding: 24,
                display: 'flex', flexDirection: 'column', gap: 16
            }}>
                <div>
                    <label style={{ fontSize: 14, color: '#aaa', marginBottom: 6, display: 'block' }}>
                        🔑 Keyword
                    </label>
                    <input
                        type="text"
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        placeholder="e.g. vintage camping, retro gym, patriotic eagle..."
                        style={{
                            width: '100%', padding: '12px 16px', borderRadius: 8,
                            background: '#0d0d1a', border: '1px solid #333', color: '#fff',
                            fontSize: 16
                        }}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                        <label style={{ fontSize: 14, color: '#aaa', marginBottom: 6, display: 'block' }}>
                            🎯 Niche
                        </label>
                        <select
                            value={niche}
                            onChange={e => setNiche(e.target.value)}
                            style={{
                                width: '100%', padding: '12px 16px', borderRadius: 8,
                                background: '#0d0d1a', border: '1px solid #333', color: '#fff'
                            }}
                        >
                            {NICHES.map(n => (
                                <option key={n} value={n}>{n.replace(/_/g, ' ')}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label style={{ fontSize: 14, color: '#aaa', marginBottom: 6, display: 'block' }}>
                            🎨 Style
                        </label>
                        <select
                            value={style}
                            onChange={e => setStyle(e.target.value)}
                            style={{
                                width: '100%', padding: '12px 16px', borderRadius: 8,
                                background: '#0d0d1a', border: '1px solid #333', color: '#fff'
                            }}
                        >
                            {STYLES.map(s => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label style={{ fontSize: 14, color: '#aaa', marginBottom: 6, display: 'block' }}>
                        📦 Design Count: {designCount}
                    </label>
                    <input
                        type="range"
                        min={5} max={50} step={5}
                        value={designCount}
                        onChange={e => setDesignCount(Number(e.target.value))}
                        style={{ width: '100%' }}
                    />
                </div>

                <button
                    onClick={handleRun}
                    disabled={loading}
                    style={{
                        padding: '14px 24px', borderRadius: 8, border: 'none',
                        background: loading ? '#333' : 'linear-gradient(135deg, #f97316, #ef4444)',
                        color: '#fff', fontSize: 16, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
                        transition: 'all 0.2s'
                    }}
                >
                    {loading ? '⏳ Generating Full Etsy Listing...' : '🚀 Generate Full Listing'}
                </button>
            </div>

            {/* Error */}
            {error && (
                <div style={{
                    marginTop: 16, padding: 16, borderRadius: 8,
                    background: '#1a0000', border: '1px solid #ef4444', color: '#ef4444'
                }}>
                    ❌ {error}
                </div>
            )}

            {/* Result */}
            {result && (
                <div style={{
                    marginTop: 24, background: '#0a1a0a', borderRadius: 12,
                    padding: 24, border: '1px solid #22c55e'
                }}>
                    <h2 style={{ color: '#22c55e', fontSize: 20, marginBottom: 16 }}>
                        ✅ Etsy Listing Generated!
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                        <div style={{ background: '#111', padding: 12, borderRadius: 8 }}>
                            <div style={{ color: '#888', fontSize: 12 }}>Keyword</div>
                            <div style={{ color: '#fff', fontWeight: 600 }}>{result.keyword}</div>
                        </div>
                        <div style={{ background: '#111', padding: 12, borderRadius: 8 }}>
                            <div style={{ color: '#888', fontSize: 12 }}>Designs</div>
                            <div style={{ color: '#fff', fontWeight: 600 }}>
                                {result.designsGenerated} / {result.designsRequested}
                            </div>
                        </div>
                        <div style={{ background: '#111', padding: 12, borderRadius: 8 }}>
                            <div style={{ color: '#888', fontSize: 12 }}>Niche</div>
                            <div style={{ color: '#fff', fontWeight: 600 }}>{result.niche}</div>
                        </div>
                        <div style={{ background: '#111', padding: 12, borderRadius: 8 }}>
                            <div style={{ color: '#888', fontSize: 12 }}>Style</div>
                            <div style={{ color: '#fff', fontWeight: 600 }}>{result.style}</div>
                        </div>
                    </div>

                    <a
                        href={`/api/export/job/${result.jobId}/bundle`}
                        style={{
                            display: 'inline-block', padding: '12px 24px', borderRadius: 8,
                            background: '#22c55e', color: '#000', fontWeight: 600,
                            textDecoration: 'none'
                        }}
                    >
                        📥 Download ZIP Bundle
                    </a>
                </div>
            )}
        </div>
    );
}
