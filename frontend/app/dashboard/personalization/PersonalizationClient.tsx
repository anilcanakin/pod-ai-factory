'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wand2, X, Loader2, RefreshCw, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { toThumbUrl } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { FileDropzone } from '@/components/shared/FileDropzone';
import {
    apiPhotoTemplates,
    apiPersonalization,
    type PhotoTemplate,
    type PersonalizationOrder,
} from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
const resolveUrl = (p: string | null | undefined) =>
    !p ? '' : p.startsWith('http') ? p : `${API_BASE}/${p}`;

export function PersonalizationClient() {
    const [template, setTemplate] = useState<PhotoTemplate | null>(null);
    const [loadingTemplate, setLoadingTemplate] = useState(true);

    const [personFile, setPersonFile] = useState<File | null>(null);
    const [petFile, setPetFile] = useState<File | null>(null);
    const [names, setNames] = useState('');
    const [generating, setGenerating] = useState(false);
    const [approving, setApproving] = useState(false);

    const [previewId, setPreviewId] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const [orders, setOrders] = useState<PersonalizationOrder[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [brokenThumbIds, setBrokenThumbIds] = useState<Set<string>>(new Set());

    const loadTemplate = useCallback(async () => {
        setLoadingTemplate(true);
        try {
            const res = await apiPhotoTemplates.list();
            const found = res.templates.find(t => t.templateType === 'multi_photo_generative' && t.active) || null;
            setTemplate(found);
            return found;
        } catch {
            toast.error('Şablon yüklenemedi');
            return null;
        } finally {
            setLoadingTemplate(false);
        }
    }, []);

    const loadOrders = useCallback(async (templateId?: string) => {
        setLoadingOrders(true);
        try {
            const res = await apiPersonalization.listOrders();
            setOrders(templateId ? res.orders.filter(o => o.templateId === templateId) : res.orders);
        } catch {
            toast.error('Siparişler yüklenemedi');
        } finally {
            setLoadingOrders(false);
        }
    }, []);

    const refresh = useCallback(async () => {
        const found = await loadTemplate();
        loadOrders(found?.id);
    }, [loadTemplate, loadOrders]);

    useEffect(() => { refresh(); }, [refresh]);

    const resetForm = () => {
        setPersonFile(null);
        setPetFile(null);
        setNames('');
        setPreviewId(null);
        setPreviewUrl(null);
    };

    const handleGeneratePreview = async () => {
        if (!template) return;
        if (!personFile || !petFile) { toast.error('Kişi ve evcil hayvan fotoğrafı yükle'); return; }

        setGenerating(true);
        try {
            const fd = new FormData();
            fd.append('templateId', template.id);
            fd.append('personPhoto', personFile);
            fd.append('petPhoto', petFile);
            if (names.trim()) fd.append('names', names.trim());
            const res = await apiPersonalization.petPortraitPreview(fd);
            setPreviewId(res.previewId);
            setPreviewUrl(res.previewUrl);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Önizleme oluşturulamadı');
        } finally {
            setGenerating(false);
        }
    };

    const handleApprove = async () => {
        if (!previewId) return;
        setApproving(true);
        try {
            await apiPersonalization.createPetPortraitOrder({ previewId });
            toast.success('Sipariş oluşturuldu');
            resetForm();
            loadOrders(template?.id);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Sipariş oluşturulamadı');
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle flex items-center justify-center text-accent">
                        <Wand2 className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-text-primary">Kişiselleştirme — Owner & Pet Portrait</h1>
                        <p className="text-xs text-text-tertiary">Kişi + evcil hayvan fotoğrafını AI ile tek portrede birleştir</p>
                    </div>
                </div>
                <button
                    onClick={refresh}
                    className="h-9 px-4 rounded-lg bg-bg-elevated border border-border-subtle text-xs font-medium text-text-secondary flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Yenile
                </button>
            </div>

            {loadingTemplate ? (
                <div className="h-40 rounded-2xl bg-bg-elevated border border-border-subtle animate-pulse" />
            ) : !template ? (
                <p className="text-xs text-text-tertiary py-8 text-center">Aktif "Owner & Pet Portrait" şablonu bulunamadı.</p>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6">
                    {/* LEFT: Upload form */}
                    <section className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle space-y-4">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Fotoğraflar</h2>

                        <div>
                            <label className="text-[11px] text-text-tertiary mb-1.5 block">Kişi Fotoğrafı</label>
                            {personFile ? (
                                <div className="relative w-full h-28 rounded-xl overflow-hidden border border-border-subtle">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={URL.createObjectURL(personFile)} alt="Kişi fotoğrafı" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => setPersonFile(null)}
                                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <FileDropzone onFile={setPersonFile} accept="image/*" label="Kişi fotoğrafını buraya bırak veya seç" />
                            )}
                        </div>

                        <div>
                            <label className="text-[11px] text-text-tertiary mb-1.5 block">Evcil Hayvan Fotoğrafı</label>
                            {petFile ? (
                                <div className="relative w-full h-28 rounded-xl overflow-hidden border border-border-subtle">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={URL.createObjectURL(petFile)} alt="Evcil hayvan fotoğrafı" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => setPetFile(null)}
                                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <FileDropzone onFile={setPetFile} accept="image/*" label="Evcil hayvan fotoğrafını buraya bırak veya seç" />
                            )}
                        </div>

                        <div>
                            <label className="text-[11px] text-text-tertiary mb-1.5 block">İsimler (opsiyonel)</label>
                            <input
                                type="text"
                                value={names}
                                onChange={e => setNames(e.target.value)}
                                placeholder="örn. SARAH & MAX"
                                className="w-full h-9 px-3 rounded-lg bg-bg-base border border-border-subtle text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
                            />
                        </div>

                        <button
                            onClick={handleGeneratePreview}
                            disabled={generating || !personFile || !petFile}
                            className="w-full h-10 rounded-lg bg-accent text-white text-xs font-bold flex items-center justify-center gap-2 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            {generating ? 'Oluşturuluyor (2-5dk sürebilir)...' : 'Önizleme Oluştur'}
                        </button>
                    </section>

                    {/* RIGHT: Preview + approve */}
                    <section className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle space-y-4">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Önizleme</h2>
                        {previewUrl ? (
                            <div className="space-y-4">
                                <div className="rounded-xl overflow-hidden border border-border-subtle bg-white">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={previewUrl} alt="Portre önizleme" className="w-full h-auto" />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={resetForm}
                                        className="flex-1 h-10 rounded-lg bg-bg-base border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                                    >
                                        Vazgeç
                                    </button>
                                    <button
                                        onClick={handleApprove}
                                        disabled={approving}
                                        className="flex-1 h-10 rounded-lg bg-accent text-white text-xs font-bold flex items-center justify-center gap-2 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100"
                                    >
                                        {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                        Siparişi Onayla
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-text-tertiary py-10 text-center">Fotoğrafları yükleyip önizleme oluştur.</p>
                        )}
                    </section>
                </div>
            )}

            {/* Orders list */}
            <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Siparişler</h2>
                <div className="bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-bg-base/50 text-[11px] font-bold text-text-tertiary uppercase tracking-widest">
                                <th className="px-6 py-3">Portre</th>
                                <th className="px-6 py-3">Şablon</th>
                                <th className="px-6 py-3">Durum</th>
                                <th className="px-6 py-3">Tarih</th>
                                <th className="px-6 py-3 text-right">Mockup</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle">
                            {loadingOrders ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-10 text-center text-text-tertiary">
                                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                                    </td>
                                </tr>
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-10 text-center text-xs text-text-tertiary">Henüz sipariş yok.</td>
                                </tr>
                            ) : orders.map(o => {
                                const thumbUrl = o.customerPhotoUrl || o.printFileUrl;
                                const thumbBroken = brokenThumbIds.has(o.id);
                                return (
                                <tr key={o.id} className="text-sm hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-3">
                                        {thumbUrl && !thumbBroken ? (
                                            <button
                                                type="button"
                                                onClick={() => setLightboxUrl(resolveUrl(thumbUrl))}
                                                className="block w-10 h-10 rounded-lg overflow-hidden border border-border-subtle bg-white hover:border-accent transition-colors"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={toThumbUrl(resolveUrl(thumbUrl))}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={e => {
                                                        const original = resolveUrl(thumbUrl);
                                                        if (e.currentTarget.src !== original) {
                                                            e.currentTarget.src = original;
                                                        } else {
                                                            setBrokenThumbIds(prev => new Set(prev).add(o.id));
                                                        }
                                                    }}
                                                />
                                            </button>
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg border border-border-subtle bg-bg-base flex items-center justify-center text-text-tertiary text-[9px]">—</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-3">
                                        <span className="text-text-secondary text-xs">{o.template?.name ?? '—'}</span>
                                    </td>
                                    <td className="px-6 py-3"><StatusBadge status={o.status} /></td>
                                    <td className="px-6 py-3 text-[11px] text-text-tertiary">{new Date(o.createdAt).toLocaleString('tr-TR')}</td>
                                    <td className="px-6 py-3 text-right">
                                        {o.mockupUrl ? (
                                            <a href={resolveUrl(o.mockupUrl)} target="_blank" rel="noopener noreferrer" className="text-accent text-xs font-medium hover:underline">
                                                Görüntüle
                                            </a>
                                        ) : (
                                            <span className="text-text-tertiary text-xs">—</span>
                                        )}
                                    </td>
                                </tr>
                            );})}
                        </tbody>
                    </table>
                </div>
            </section>

            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        onClick={() => setLightboxUrl(null)}
                        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20"
                    >
                        <X className="w-4 h-4" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={lightboxUrl}
                        alt=""
                        className="max-w-full max-h-full rounded-xl object-contain bg-white"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
