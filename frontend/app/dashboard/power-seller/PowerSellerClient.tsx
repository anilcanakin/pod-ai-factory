'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface TrackedStore {
    id: string;
    shopUrl: string;
    shopName: string;
    notes?: string;
    addedAt: string;
}

interface ScanResult {
    scanned: number;
    totalAlerts: number;
    storeResults: { shopName: string; alerts: number }[];
}

async function fetchStores(): Promise<TrackedStore[]> {
    const r = await fetch(`${API}/api/power-seller/stores`, { credentials: 'include' });
    return r.json();
}

async function addStore(body: { shopUrl: string; shopName?: string; notes?: string }): Promise<unknown> {
    const r = await fetch(`${API}/api/power-seller/stores`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return r.json();
}

async function deleteStore(id: string): Promise<unknown> {
    const r = await fetch(`${API}/api/power-seller/stores/${id}`, { method: 'DELETE', credentials: 'include' });
    return r.json();
}

async function triggerScan(): Promise<ScanResult> {
    const r = await fetch(`${API}/api/power-seller/scan`, { method: 'POST', credentials: 'include' });
    return r.json();
}

export function PowerSellerClient() {
    const qc = useQueryClient();
    const [shopUrl, setShopUrl]   = useState('');
    const [shopName, setShopName] = useState('');
    const [notes, setNotes]       = useState('');
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);

    const { data: stores = [], isLoading } = useQuery({ queryKey: ['power-seller-stores'], queryFn: fetchStores });

    const addMut = useMutation({
        mutationFn: addStore,
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['power-seller-stores'] }); setShopUrl(''); setShopName(''); setNotes(''); },
    });

    const delMut = useMutation({
        mutationFn: deleteStore,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['power-seller-stores'] }),
    });

    const scanMut = useMutation({
        mutationFn: triggerScan,
        onSuccess: (data) => setScanResult(data),
    });

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Power Seller Monitor</h1>
                <p className="text-slate-400 text-sm mt-1">
                    Takip ettiğin top Etsy mağazalarında 72 saat içinde hızlı traction alan yeni ilanları tespit eder.
                    Bulgular Brain'e otomatik kaydedilir.
                </p>
            </div>

            {/* Add Store */}
            <div className="bg-slate-800/60 rounded-xl p-5 space-y-3">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Mağaza Ekle</h2>
                <div className="flex gap-2 flex-wrap">
                    <input
                        className="flex-1 min-w-[200px] bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500"
                        placeholder="https://www.etsy.com/shop/MağazaAdı"
                        value={shopUrl}
                        onChange={e => setShopUrl(e.target.value)}
                    />
                    <input
                        className="w-44 bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500"
                        placeholder="Görünen Ad (isteğe bağlı)"
                        value={shopName}
                        onChange={e => setShopName(e.target.value)}
                    />
                    <input
                        className="w-44 bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500"
                        placeholder="Not (isteğe bağlı)"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                    />
                    <button
                        onClick={() => shopUrl && addMut.mutate({ shopUrl, shopName: shopName || undefined, notes: notes || undefined })}
                        disabled={!shopUrl || addMut.isPending}
                        className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                        {addMut.isPending ? 'Ekleniyor...' : 'Ekle'}
                    </button>
                </div>
                {(() => {
                    const d = addMut.data as Record<string, unknown> | undefined;
                    return d && 'error' in d ? <p className="text-red-400 text-xs">{String(d.error)}</p> : null;
                })()}
            </div>

            {/* Stores List */}
            <div className="bg-slate-800/60 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
                        Takip Edilen Mağazalar {stores.length > 0 && <span className="text-purple-400">({stores.length})</span>}
                    </h2>
                    <button
                        onClick={() => scanMut.mutate()}
                        disabled={scanMut.isPending || stores.length === 0}
                        className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:opacity-90 text-white text-sm font-medium disabled:opacity-40"
                    >
                        {scanMut.isPending ? 'Tarıyor...' : '⚡ Manuel Tara'}
                    </button>
                </div>

                {isLoading && <p className="text-slate-400 text-sm">Yükleniyor...</p>}
                {!isLoading && stores.length === 0 && (
                    <p className="text-slate-500 text-sm">Henüz takip edilen mağaza yok. Yukarıdan ekle.</p>
                )}

                {stores.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-4 bg-slate-900/60 rounded-lg px-4 py-3">
                        <div className="min-w-0">
                            <p className="text-white text-sm font-medium truncate">{s.shopName}</p>
                            <a href={s.shopUrl} target="_blank" rel="noreferrer"
                                className="text-slate-500 text-xs truncate hover:text-purple-400 block">{s.shopUrl}</a>
                            {s.notes && <p className="text-slate-600 text-xs mt-0.5">{s.notes}</p>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <span className="text-slate-600 text-xs">{new Date(s.addedAt).toLocaleDateString('tr-TR')}</span>
                            <button
                                onClick={() => delMut.mutate(s.id)}
                                className="text-red-500 hover:text-red-400 text-xs"
                            >
                                Sil
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Scan Result */}
            {scanResult && (
                <div className="bg-slate-800/60 rounded-xl p-5 space-y-2">
                    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Son Tarama Sonucu</h2>
                    <p className="text-slate-400 text-sm">
                        {scanResult.scanned} mağaza tarandı — <span className="text-purple-400 font-medium">{scanResult.totalAlerts} traction alert</span> tespit edildi.
                    </p>
                    {scanResult.storeResults.map(r => (
                        <div key={r.shopName} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-900/60 rounded-lg">
                            <span className="text-slate-300">{r.shopName}</span>
                            <span className={r.alerts > 0 ? 'text-green-400 font-medium' : 'text-slate-500'}>
                                {r.alerts > 0 ? `+${r.alerts} alert` : 'Alert yok'}
                            </span>
                        </div>
                    ))}
                    <p className="text-slate-500 text-xs">Alertler Brain sayfasında görüntülenebilir (kategori: niche_research).</p>
                </div>
            )}
        </div>
    );
}
