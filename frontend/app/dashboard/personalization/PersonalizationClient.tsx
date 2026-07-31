'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Wand2, Upload, X, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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

function humanizeKey(key: string): string {
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

function emptyVariables(template: PhotoTemplate): Record<string, string> {
    const initial: Record<string, string> = {};
    (template.textLayers || []).forEach(layer => { initial[layer.key] = ''; });
    return initial;
}

export function PersonalizationClient() {
    const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
    const [occasion, setOccasion] = useState<string>('all');
    const [loadingTemplates, setLoadingTemplates] = useState(true);

    const [selectedTemplate, setSelectedTemplate] = useState<PhotoTemplate | null>(null);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    const [orders, setOrders] = useState<PersonalizationOrder[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [brokenThumbIds, setBrokenThumbIds] = useState<Set<string>>(new Set());

    const loadTemplates = useCallback(async () => {
        setLoadingTemplates(true);
        try {
            const res = await apiPhotoTemplates.list();
            setTemplates(res.templates);
        } catch {
            toast.error('Şablonlar yüklenemedi');
        } finally {
            setLoadingTemplates(false);
        }
    }, []);

    const loadOrders = useCallback(async () => {
        setLoadingOrders(true);
        try {
            const res = await apiPersonalization.listOrders();
            setOrders(res.orders);
        } catch {
            toast.error('Siparişler yüklenemedi');
        } finally {
            setLoadingOrders(false);
        }
    }, []);

    useEffect(() => { loadTemplates(); loadOrders(); }, [loadTemplates, loadOrders]);

    const occasions = useMemo(() => Array.from(new Set(templates.map(t => t.occasion))), [templates]);

    const filteredTemplates = useMemo(
        () => occasion === 'all' ? templates : templates.filter(t => t.occasion === occasion),
        [templates, occasion]
    );

    const selectTemplate = (t: PhotoTemplate) => {
        setSelectedTemplate(t);
        setVariables(emptyVariables(t));
    };

    const handlePhotoFile = (file: File) => {
        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(file));
    };

    const photoRequired = selectedTemplate?.templateType !== 'text_only';

    const handleSubmit = async () => {
        if (!selectedTemplate) { toast.error('Önce bir şablon seç'); return; }
        if (photoRequired && !photoFile) { toast.error('Müşteri fotoğrafı yükle'); return; }

        setSubmitting(true);
        try {
            if (photoRequired) {
                const fd = new FormData();
                fd.append('templateId', selectedTemplate.id);
                if (photoFile) fd.append('customerPhoto', photoFile);
                fd.append('variables', JSON.stringify(variables));
                await apiPersonalization.createOrder(fd);
            } else {
                await apiPersonalization.createTextOrder({ templateId: selectedTemplate.id, variables });
            }
            toast.success('Sipariş oluşturuldu, kompozisyon kuyruğa alındı');
            setPhotoFile(null);
            setPhotoPreview(null);
            setVariables(emptyVariables(selectedTemplate));
            loadOrders();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Sipariş oluşturulamadı');
        } finally {
            setSubmitting(false);
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
                        <h1 className="text-xl font-bold text-text-primary">Kişiselleştirme</h1>
                        <p className="text-xs text-text-tertiary">Müşteri fotoğrafından kişiye özel ürün siparişi oluştur</p>
                    </div>
                </div>
                <button
                    onClick={() => { loadTemplates(); loadOrders(); }}
                    className="h-9 px-4 rounded-lg bg-bg-elevated border border-border-subtle text-xs font-medium text-text-secondary flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Yenile
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
                {/* LEFT: Template picker */}
                <section className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setOccasion('all')}
                            className={cn(
                                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                                occasion === 'all'
                                    ? 'bg-accent-subtle text-accent border-accent-border'
                                    : 'bg-bg-elevated text-text-tertiary border-border-subtle hover:text-text-secondary'
                            )}
                        >
                            Tümü
                        </button>
                        {occasions.map(o => (
                            <button
                                key={o}
                                onClick={() => setOccasion(o)}
                                className={cn(
                                    'px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-colors',
                                    occasion === o
                                        ? 'bg-accent-subtle text-accent border-accent-border'
                                        : 'bg-bg-elevated text-text-tertiary border-border-subtle hover:text-text-secondary'
                                )}
                            >
                                {o}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {loadingTemplates ? (
                            Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="aspect-square rounded-xl bg-bg-elevated border border-border-subtle animate-pulse" />
                            ))
                        ) : filteredTemplates.length === 0 ? (
                            <p className="col-span-full text-xs text-text-tertiary py-8 text-center">Bu kategoride şablon yok.</p>
                        ) : (
                            filteredTemplates.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => selectTemplate(t)}
                                    className={cn(
                                        'group relative aspect-square rounded-xl overflow-hidden border-2 transition-all',
                                        selectedTemplate?.id === t.id
                                            ? 'border-accent'
                                            : 'border-border-subtle hover:border-border-default'
                                    )}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={resolveUrl(t.baseArtworkUrl)} alt={t.name} className="w-full h-full object-cover bg-white" />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1.5">
                                        <p className="text-[10px] font-medium text-white truncate">{t.name}</p>
                                        <p className="text-[9px] text-white/60 capitalize">{t.occasion}</p>
                                    </div>
                                    {selectedTemplate?.id === t.id && (
                                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                                            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </section>

                {/* RIGHT: Order form */}
                <section>
                    <div className="p-4 rounded-2xl bg-bg-elevated border border-border-subtle space-y-4">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Yeni Sipariş</h2>

                        {!selectedTemplate ? (
                            <p className="text-xs text-text-tertiary py-6 text-center">Soldan bir şablon seç.</p>
                        ) : (
                            <>
                                <div className="flex items-center gap-3 p-2 rounded-lg bg-bg-base border border-border-subtle">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={resolveUrl(selectedTemplate.baseArtworkUrl)} alt={selectedTemplate.name} className="w-12 h-12 rounded-lg object-cover bg-white" />
                                    <div>
                                        <p className="text-xs font-medium text-text-primary">{selectedTemplate.name}</p>
                                        <p className="text-[10px] text-text-tertiary capitalize">{selectedTemplate.occasion}</p>
                                    </div>
                                </div>

                                {/* Photo upload — 'text_only' şablonlar foto istemiyor */}
                                {photoRequired && (
                                    <div>
                                        <label className="text-[11px] text-text-tertiary mb-1.5 block">Müşteri Fotoğrafı</label>
                                        {photoPreview ? (
                                            <div className="relative w-full h-28 rounded-xl overflow-hidden border border-border-subtle">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={photoPreview} alt="Müşteri fotoğrafı" className="w-full h-full object-cover" />
                                                <button
                                                    onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                                                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ) : (
                                            <FileDropzone onFile={handlePhotoFile} accept="image/*" label="Fotoğrafı buraya bırak veya seç" />
                                        )}
                                    </div>
                                )}

                                {/* Variables */}
                                {selectedTemplate.textLayers?.length > 0 && (
                                    <div className="space-y-2">
                                        <label className="text-[11px] text-text-tertiary block">Metin Alanları</label>
                                        {selectedTemplate.textLayers.map(layer => (
                                            <input
                                                key={layer.key}
                                                type="text"
                                                value={variables[layer.key] ?? ''}
                                                onChange={e => setVariables(prev => ({ ...prev, [layer.key]: e.target.value }))}
                                                placeholder={humanizeKey(layer.key)}
                                                className="w-full h-9 px-3 rounded-lg bg-bg-base border border-border-subtle text-xs text-text-primary focus:outline-none focus:border-accent transition-colors"
                                            />
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting || (photoRequired && !photoFile)}
                                    className="w-full h-10 rounded-lg bg-accent text-white text-xs font-bold flex items-center justify-center gap-2 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:hover:scale-100"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                    Sipariş Oluştur
                                </button>
                            </>
                        )}
                    </div>
                </section>
            </div>

            {/* Orders list */}
            <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Siparişler</h2>
                <div className="bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-bg-base/50 text-[11px] font-bold text-text-tertiary uppercase tracking-widest">
                                <th className="px-6 py-3">Fotoğraf</th>
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
                                                    src={resolveUrl(thumbUrl)}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={() => setBrokenThumbIds(prev => new Set(prev).add(o.id))}
                                                />
                                            </button>
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg border border-border-subtle bg-bg-base flex items-center justify-center text-text-tertiary text-[9px]">
                                                {thumbBroken ? '—' : 'Metin'}
                                            </div>
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
