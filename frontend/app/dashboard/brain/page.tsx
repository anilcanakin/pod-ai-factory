'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
    CloudUpload,
    Youtube,
    Database,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Clock,
    Zap,
    FileText,
    RefreshCw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
type JobState = 'idle' | 'uploading' | 'queued' | 'active' | 'completed' | 'failed';

interface JobStatus {
    jobId: string;
    state: string;
    progress: number;
    failedReason: string | null;
    isCompleted: boolean;
    isFailed: boolean;
    isActive: boolean;
    name: string;
}

interface MessageBag {
    type: 'success' | 'error' | 'info';
    text: string;
}

// ─── Status Badge ─────────────────────────────────────────────
function StatusBadge({ state }: { state: JobState }) {
    const map: Record<JobState, { icon: React.ReactNode; label: string; cls: string }> = {
        idle:      { icon: null, label: '', cls: '' },
        uploading: { icon: <Loader2 className="w-4 h-4 animate-spin" />, label: 'Yükleniyor…', cls: 'text-blue-400 bg-blue-400/10 border-blue-400/30' },
        queued:    { icon: <Clock className="w-4 h-4 animate-pulse" />,  label: 'Kuyrukta Bekliyor…', cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' },
        active:    { icon: <Zap  className="w-4 h-4 animate-bounce" />, label: 'İşleniyor…',  cls: 'text-purple-400 bg-purple-400/10 border-purple-400/30' },
        completed: { icon: <CheckCircle2 className="w-4 h-4" />,         label: 'Başarıyla İşlendi ✓', cls: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30' },
        failed:    { icon: <AlertCircle  className="w-4 h-4" />,         label: 'İşlem Başarısız', cls: 'text-red-400 bg-red-400/10 border-red-400/30' },
    };

    const { icon, label, cls } = map[state];
    if (!label) return null;

    return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${cls}`}>
            {icon}
            <span>{label}</span>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AIBackgroundBrain() {
    const [file, setFile]         = useState<File | null>(null);
    const [ytUrl, setYtUrl]       = useState('');
    const [stats, setStats]       = useState({ count: 0 });
    const [message, setMessage]   = useState<MessageBag | null>(null);
    const [jobState, setJobState] = useState<JobState>('idle');
    const [failedReason, setFailedReason] = useState<string | null>(null);
    const [currentJobName, setCurrentJobName] = useState('');

    const pollRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => { fetchStats(); }, []);
    // Cleanup polling on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const fetchStats = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/knowledge/stats');
            const data = await res.json();
            setStats(data);
        } catch { /* silent */ }
    };

    // ── Polling ──────────────────────────────────────────────
    const startPolling = (jobId: string) => {
        if (pollRef.current) clearInterval(pollRef.current);

        pollRef.current = setInterval(async () => {
            try {
                const res = await fetch(`http://localhost:3000/api/knowledge/status/${jobId}`);
                if (!res.ok) return;
                const status: JobStatus = await res.json();

                setJobState(status.isCompleted ? 'completed' : status.isFailed ? 'failed' : status.isActive ? 'active' : 'queued');

                if (status.isCompleted) {
                    clearInterval(pollRef.current!);
                    setMessage({ type: 'success', text: `"${status.name}" başarıyla beyne aktarıldı ve vektörlendi! 🎉` });
                    fetchStats();    // Chunk sayısını güncelle
                }
                if (status.isFailed) {
                    clearInterval(pollRef.current!);
                    setFailedReason(status.failedReason || 'Bilinmeyen hata.');
                    setMessage({ type: 'error', text: 'İşlem başarısız oldu.' });
                }
            } catch { /* network hiccup — devam et */ }
        }, 2000);
    };

    // ── Upload Handler ────────────────────────────────────────
    const handleFileUpload = async () => {
        if (!file) return;

        setJobState('uploading');
        setMessage(null);
        setFailedReason(null);
        setCurrentJobName(file.name);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('http://localhost:3000/api/knowledge/upload', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (!res.ok) {
                setJobState('failed');
                setMessage({ type: 'error', text: data.error || 'Yükleme başarısız.' });
                return;
            }

            setFile(null);
            setJobState('queued');
            setMessage({ type: 'info', text: `"${data.file}" kuyruğa eklendi. İşlenirken bekleyebilirsiniz…` });

            if (data.jobId) {
                startPolling(data.jobId);
            }
        } catch (err) {
            setJobState('failed');
            setMessage({ type: 'error', text: 'Sunucuya bağlanılamadı.' });
        }
    };

    // ── YouTube Handler ───────────────────────────────────────
    const handleYoutubeSub = async () => {
        if (!ytUrl) return;
        setJobState('uploading');
        setMessage(null);
        setFailedReason(null);

        try {
            const res = await fetch('http://localhost:3000/api/knowledge/youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: ytUrl }),
            });
            const data = await res.json();
            if (res.ok) {
                setYtUrl('');
                setJobState('queued');
                setMessage({ type: 'info', text: data.message });
                if (data.jobId) startPolling(data.jobId);
            } else {
                setJobState('failed');
                setMessage({ type: 'error', text: data.error });
            }
        } catch {
            setJobState('failed');
            setMessage({ type: 'error', text: 'İşlem başarısız oldu.' });
        }
    };

    const isProcessing = ['uploading', 'queued', 'active'].includes(jobState);
    const msgColors: Record<string, string> = {
        success: 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400',
        error:   'bg-red-500/10 border border-red-500/30 text-red-400',
        info:    'bg-blue-500/10 border border-blue-500/30 text-blue-400',
    };

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <header>
                <h1 className="text-3xl font-bold text-text-primary flex items-center gap-3">
                    <Database className="text-accent" /> AI Brain Center
                </h1>
                <p className="text-text-secondary mt-2">
                    Etsy stratejileri, eğitim videoları ve dökümanlarla yapay zekayı eğitin.
                    Multimodal analiz (Ses + Görüntü) asenkron olarak arka planda çalışır.
                </p>
            </header>

            {/* Stats + Live Status Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Stat Card */}
                <div className="bg-bg-surface border border-border-strong rounded-xl p-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-mono uppercase tracking-widest text-text-tertiary">Mevcut Bilgi Birikimi</h3>
                        <p className="text-4xl font-bold text-accent mt-1">
                            {stats.count.toLocaleString()}
                            <span className="text-lg font-normal text-text-secondary"> Chunk</span>
                        </p>
                    </div>
                    <button
                        className="p-4 bg-accent-subtle rounded-full hover:scale-105 transition-transform"
                        onClick={fetchStats}
                        title="Yenile"
                    >
                        <RefreshCw className="text-accent w-6 h-6" />
                    </button>
                </div>

                {/* Live Processing Status */}
                <div className="bg-bg-surface border border-border-strong rounded-xl p-6 flex flex-col justify-center gap-3">
                    <h3 className="text-sm font-mono uppercase tracking-widest text-text-tertiary">İşlem Durumu</h3>
                    {jobState === 'idle' ? (
                        <p className="text-text-tertiary text-sm">Henüz bir işlem başlatılmadı.</p>
                    ) : (
                        <>
                            <StatusBadge state={jobState} />
                            {currentJobName && jobState !== 'idle' && (
                                <p className="text-xs text-text-tertiary flex items-center gap-1 truncate">
                                    <FileText className="w-3 h-3 shrink-0" />
                                    {currentJobName}
                                </p>
                            )}
                            {failedReason && (
                                <p className="text-xs text-red-400 bg-red-400/10 rounded px-2 py-1 mt-1">
                                    <strong>Hata:</strong> {failedReason}
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Upload Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* File Upload */}
                <div className="bg-bg-surface border border-border-default rounded-xl p-6 space-y-4">
                    <h4 className="font-semibold flex items-center gap-2">
                        <CloudUpload size={18} /> Döküman veya Video Yükle
                    </h4>
                    <div
                        className="border-2 border-dashed border-border-strong rounded-lg p-8 text-center hover:border-accent transition-colors cursor-pointer"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
                        }}
                    >
                        {file ? (
                            <span className="text-accent font-medium truncate block">{file.name}</span>
                        ) : (
                            <span className="text-text-tertiary text-sm">PDF, MP4 veya TXT sürükleyin ya da tıklayın</span>
                        )}
                        <input
                            type="file"
                            className="hidden"
                            id="fileInput"
                            onChange={(e) => e.target.files && setFile(e.target.files[0])}
                        />
                        <button
                            className="mt-4 text-xs font-bold uppercase text-accent"
                            onClick={() => document.getElementById('fileInput')?.click()}
                        >
                            Dosya Seç
                        </button>
                    </div>
                    <button
                        disabled={!file || isProcessing}
                        onClick={handleFileUpload}
                        className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    >
                        {isProcessing ? <Loader2 className="animate-spin w-4 h-4" /> : <CloudUpload className="w-4 h-4" />}
                        {isProcessing ? 'İşleniyor…' : 'Beyne Aktar'}
                    </button>
                </div>

                {/* YouTube */}
                <div className="bg-bg-surface border border-border-default rounded-xl p-6 space-y-4">
                    <h4 className="font-semibold flex items-center gap-2">
                        <Youtube size={18} /> YouTube Eğitim Videosu
                    </h4>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs text-text-tertiary">Video URL</label>
                        <input
                            type="text"
                            placeholder="https://youtube.com/watch?v=..."
                            className="bg-bg-base border border-border-default rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                            value={ytUrl}
                            onChange={(e) => setYtUrl(e.target.value)}
                        />
                    </div>
                    <button
                        disabled={!ytUrl || isProcessing}
                        onClick={handleYoutubeSub}
                        className="w-full bg-danger text-white font-bold py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                    >
                        {isProcessing ? <Loader2 className="animate-spin w-4 h-4" /> : <Youtube className="w-4 h-4" />}
                        {isProcessing ? 'İşleniyor…' : 'Kuyruğa Ekle'}
                    </button>
                </div>
            </div>

            {/* Message Toast */}
            {message && (
                <div className={`p-4 rounded-lg flex items-start gap-3 ${msgColors[message.type]}`}>
                    {message.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : message.type === 'error' ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <Clock size={18} className="mt-0.5 shrink-0" />}
                    <span className="text-sm font-medium">{message.text}</span>
                </div>
            )}
        </div>
    );
}
