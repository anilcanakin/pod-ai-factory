'use client';

import { useState, useEffect } from 'react';

const ALL_PRODUCT_TYPES = [
    { type: 'tshirt', label: '👕 T-Shirt', emoji: '👕' },
    { type: 'sweatshirt', label: '🧥 Sweatshirt', emoji: '🧥' },
    { type: 'mug', label: '☕ Mug', emoji: '☕' },
    { type: 'sticker', label: '🏷️ Sticker', emoji: '🏷️' },
    { type: 'phone_case', label: '📱 Phone Case', emoji: '📱' },
];

export default function PacksPage() {
    const [packs, setPacks] = useState<any[]>([]);
    const [newPackName, setNewPackName] = useState('');
    const [selectedProducts, setSelectedProducts] = useState<string[]>(['tshirt', 'mug']);
    const [loading, setLoading] = useState(false);
    const [runImageId, setRunImageId] = useState('');
    const [result, setResult] = useState<any>(null);

    useEffect(() => { loadPacks(); }, []);

    const loadPacks = async () => {
        const res = await fetch('/api/packs', { credentials: 'include' });
        if (res.ok) setPacks(await res.json());
    };

    const toggleProduct = (type: string) => {
        setSelectedProducts(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const createPack = async () => {
        if (!newPackName.trim()) return;
        setLoading(true);
        const res = await fetch('/api/packs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: newPackName, productTypes: selectedProducts })
        });
        if (res.ok) {
            setNewPackName('');
            loadPacks();
        }
        setLoading(false);
    };

    const runPack = async (packId: string) => {
        if (!runImageId.trim()) return;
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch(`/api/packs/${packId}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ imageId: runImageId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setResult(data);
        } catch (err: any) {
            setResult({ error: err.message });
        }
        setLoading(false);
    };

    const inputStyle = {
        padding: '10px 14px', borderRadius: 8, background: '#0d0d1a',
        border: '1px solid #333', color: '#fff', fontSize: 14, width: '100%'
    };

    return (
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>📦 Product Packs</h1>
            <p style={{ color: '#888', marginBottom: 32 }}>
                Auto-place designs on multiple products: T-Shirt → Sweatshirt → Mug → Sticker → Phone Case
            </p>

            {/* Create Pack */}
            <div style={{
                background: '#1a1a2e', borderRadius: 12, padding: 24, marginBottom: 32
            }}>
                <h2 style={{ fontSize: 18, marginBottom: 16, color: '#ddd' }}>Create New Pack</h2>

                <input
                    type="text" value={newPackName}
                    onChange={e => setNewPackName(e.target.value)}
                    placeholder="Pack name (e.g. Summer Collection)"
                    style={{ ...inputStyle, marginBottom: 16 }}
                />

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                    {ALL_PRODUCT_TYPES.map(p => (
                        <button
                            key={p.type}
                            onClick={() => toggleProduct(p.type)}
                            style={{
                                padding: '10px 16px', borderRadius: 8, cursor: 'pointer',
                                border: selectedProducts.includes(p.type)
                                    ? '2px solid #22c55e' : '2px solid #333',
                                background: selectedProducts.includes(p.type) ? '#0a2a0a' : '#111',
                                color: '#fff', fontSize: 14,
                                transition: 'all 0.15s'
                            }}
                        >
                            {p.emoji} {p.label.split(' ').slice(1).join(' ')}
                        </button>
                    ))}
                </div>

                <button
                    onClick={createPack} disabled={loading || !newPackName.trim()}
                    style={{
                        padding: '12px 24px', borderRadius: 8, border: 'none',
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        color: '#fff', fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    ➕ Create Pack
                </button>
            </div>

            {/* Existing Packs */}
            <h2 style={{ fontSize: 18, marginBottom: 16, color: '#ddd' }}>Your Packs</h2>
            {packs.length === 0 && <p style={{ color: '#666' }}>No packs yet. Create one above!</p>}

            {packs.map(pack => (
                <div key={pack.id} style={{
                    background: '#111', borderRadius: 12, padding: 20, marginBottom: 16,
                    border: '1px solid #222'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{pack.name}</h3>
                            <p style={{ fontSize: 13, color: '#888' }}>
                                {pack.items.map((i: any) =>
                                    ALL_PRODUCT_TYPES.find(p => p.type === i.productType)?.emoji || '📦'
                                ).join(' ')} · {pack.items.length} products
                            </p>
                        </div>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                        <input
                            type="text" value={runImageId}
                            onChange={e => setRunImageId(e.target.value)}
                            placeholder="Image ID to run through pack"
                            style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                            onClick={() => runPack(pack.id)}
                            disabled={loading}
                            style={{
                                padding: '10px 20px', borderRadius: 8, border: 'none',
                                background: '#22c55e', color: '#000', fontWeight: 600,
                                cursor: 'pointer', whiteSpace: 'nowrap'
                            }}
                        >
                            🚀 Run
                        </button>
                    </div>
                </div>
            ))}

            {/* Result */}
            {result && !result.error && (
                <div style={{
                    marginTop: 24, background: '#0a1a0a', borderRadius: 12,
                    padding: 24, border: '1px solid #22c55e'
                }}>
                    <h3 style={{ color: '#22c55e', marginBottom: 12 }}>
                        ✅ Pack Pipeline Complete — {result.packName}
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                        {result.mockups?.map((m: any) => (
                            <div key={m.mockupId} style={{
                                background: '#111', borderRadius: 8, padding: 12, textAlign: 'center'
                            }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>
                                    {ALL_PRODUCT_TYPES.find(p => p.type === m.productType)?.emoji || '📦'}
                                </div>
                                <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                                    {m.productType}
                                </div>
                                <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                                    ✅ Mockup generated
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {result?.error && (
                <div style={{
                    marginTop: 16, padding: 16, borderRadius: 8,
                    background: '#1a0000', border: '1px solid #ef4444', color: '#ef4444'
                }}>
                    ❌ {result.error}
                </div>
            )}
        </div>
    );
}
