'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Settings, Zap, CheckCircle, Clock, Brain, LayoutGrid, TrendingUp } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

async function fetchStatus() {
    const r = await fetch(`${API}/api/loop/status`, { credentials: 'include' });
    return r.json();
}
async function triggerLoop() {
    const r = await fetch(`${API}/api/loop/trigger`, { method: 'POST', credentials: 'include' });
    return r.json();
}
async function patchSettings(body: object) {
    const r = await fetch(`${API}/api/loop/settings`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return r.json();
}

function fmt(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export function LoopClient() {
    const qc = useQueryClient();
    const { data, isLoading } = useQuery({ queryKey: ['loop-status'], queryFn: fetchStatus, refetchInterval: 15000 });
    const [triggered, setTriggered] = useState(false);

    const triggerMut = useMutation({
        mutationFn: triggerLoop,
        onSuccess: () => { setTriggered(true); setTimeout(() => setTriggered(false), 4000); qc.invalidateQueries({ queryKey: ['loop-status'] }); },
    });

    const settingsMut = useMutation({
        mutationFn: patchSettings,
        onSuccess: () => qc.invalidateQueries({ queryKey: ['loop-status'] }),
    });

    const settings = data?.settings || {};
    const state    = data?.state    || {};
    const cards    = data?.recentCards || [];
    const total    = data?.totalRules  || 0;

    return (
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
            {/* Başlık */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Zap className="text-purple-400" size={24} /> Otonom Döngü
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Brain bilgisi → Strateji → Üretim → Etsy — tamamen otomatik
                    </p>
                </div>
                <button
                    onClick={() => triggerMut.mutate()}
                    disabled={triggerMut.isPending || triggered}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium disabled:opacity-50"
                >
                    <Play size={16} />
                    {triggered ? 'Başlatıldı!' : triggerMut.isPending ? 'Çalışıyor...' : 'Manuel Başlat'}
                </button>
            </div>

            {/* İstatistik Kartları */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={<Brain size={18} />} label="Stratejik Kural" value={total} />
                <StatCard icon={<LayoutGrid size={18} />} label="Toplam Döngü" value={state.totalCycles || 0} />
                <StatCard icon={<Clock size={18} />}  label="Son Çalışma" value={fmt(state.lastRunAt)} small />
                <StatCard icon={<TrendingUp size={18} />} label="Son Audit" value={fmt(state.lastAuditAt)} small />
            </div>

            {/* Ayarlar */}
            <div className="bg-slate-800/50 rounded-xl p-5 space-y-4">
                <h2 className="font-semibold flex items-center gap-2"><Settings size={16} /> Döngü Ayarları</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                        <div>
                            <div className="font-medium text-sm">Etsy'ye Otomatik Yayımla</div>
                            <div className="text-xs text-slate-400">Kapalıyken galeri'de onay bekler</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={settings.autoPublish || false}
                            onChange={e => settingsMut.mutate({ ...settings, autoPublish: e.target.checked })}
                            className="w-4 h-4 accent-purple-500"
                        />
                    </label>

                    <label className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                        <div>
                            <div className="font-medium text-sm">Döngü Aktif</div>
                            <div className="text-xs text-slate-400">Her gece 03:00'da çalışır</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={settings.enabled !== false}
                            onChange={e => settingsMut.mutate({ ...settings, enabled: e.target.checked })}
                            className="w-4 h-4 accent-purple-500"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                    {[
                        { key: 'minNewRules', label: 'Min yeni kural', min: 1, max: 30 },
                        { key: 'maxIdeas',    label: 'Döngü başına fikir', min: 1, max: 5 },
                        { key: 'imagesPerIdea', label: 'Fikir başına görsel', min: 1, max: 10 },
                    ].map(({ key, label, min, max }) => (
                        <label key={key} className="space-y-1">
                            <span className="text-slate-400 text-xs">{label}</span>
                            <input
                                type="number"
                                min={min} max={max}
                                value={settings[key] || (key === 'minNewRules' ? 5 : key === 'maxIdeas' ? 2 : 3)}
                                onChange={e => settingsMut.mutate({ ...settings, [key]: Number(e.target.value) })}
                                className="w-full bg-slate-700 rounded px-2 py-1 text-sm"
                            />
                        </label>
                    ))}
                </div>
            </div>

            {/* Döngü Akışı */}
            <div className="bg-slate-800/50 rounded-xl p-5">
                <h2 className="font-semibold mb-4">Döngü Akışı</h2>
                <div className="flex items-center gap-2 text-sm overflow-x-auto pb-2">
                    {[
                        'Brain Kuralları',
                        'Strategic Audit',
                        'ACTION_CARD',
                        'Ideas',
                        'Batch Üretim',
                        'BG Kaldır',
                        'Mockup',
                        'SEO',
                        settings.autoPublish ? 'Etsy (Otomatik)' : 'Galeri (Onay)',
                    ].map((step, i, arr) => (
                        <div key={step} className="flex items-center gap-2 shrink-0">
                            <span className="px-2 py-1 bg-purple-600/20 border border-purple-500/30 rounded text-purple-300 text-xs whitespace-nowrap">
                                {step}
                            </span>
                            {i < arr.length - 1 && <span className="text-slate-600">→</span>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Son Action Cards */}
            {cards.length > 0 && (
                <div className="bg-slate-800/50 rounded-xl p-5">
                    <h2 className="font-semibold mb-4">Son Üretilen Stratejiler</h2>
                    <div className="space-y-3">
                        {cards.map((card: any) => {
                            const ar = card.analysisResult || {};
                            return (
                                <div key={card.id} className="flex items-center justify-between p-3 bg-slate-700/40 rounded-lg">
                                    <div>
                                        <div className="font-medium text-sm">{ar.nicheName || card.title}</div>
                                        <div className="text-xs text-slate-400">{ar.reason}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-bold text-purple-400">{ar.nicheScore}/100</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${ar.status === 'IN_PRODUCTION' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                            {ar.status === 'IN_PRODUCTION' ? 'Üretimde' : 'Hazır'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {isLoading && <div className="text-slate-400 text-sm text-center py-8">Yükleniyor...</div>}
        </div>
    );
}

function StatCard({ icon, label, value, small }: { icon: React.ReactNode; label: string; value: any; small?: boolean }) {
    return (
        <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">{icon}{label}</div>
            <div className={`font-bold ${small ? 'text-sm text-slate-200' : 'text-2xl text-white'}`}>{value}</div>
        </div>
    );
}
