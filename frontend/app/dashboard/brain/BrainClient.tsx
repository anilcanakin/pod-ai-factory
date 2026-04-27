'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
    Brain, FileText, Zap, ChevronRight, Plus, Trash2,
    Loader2, Lightbulb, Target, Layout, CheckCircle2,
    RefreshCw, BookOpen, Mic, BarChart2, ArrowUpCircle, MessageSquare,
    GraduationCap, Youtube, Clock, XCircle, Video, Shield, Search,
    ChevronDown, ListVideo, Eye, ArrowUpDown, CheckSquare, Square,
    TrendingUp, Calendar, Timer, RotateCcw, Terminal,
    Share2, Upload, Compass, Globe, Twitter, Instagram, FileUp,
    Sparkles, ImageIcon, ChevronDown as ChevronDownIcon, Star
} from 'lucide-react';
import { apiBrain, CorporateMemory, VideoAnalysis, apiKnowledge, IngestJob, ChannelVideo, QueueStats, apiLogs, LogEntry, apiBatch, BatchRule, BatchStatus, BrainstormResult, BrainstormIdea, FINAL_RENDER_MODELS, FinalRenderModelKey, StylePreset, StyleProfile, LockedDNA, apiStyles } from '@/lib/api';
import { drawSloganOverlay } from '@/lib/canvas-overlay';
import { toast } from 'sonner';
import { TrendsClient } from '../trends/TrendsClient';
import { AnalyticsClient } from '../analytics/AnalyticsClient';
import { IdeasClient } from '../ideas/IdeasClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['STRATEGY', 'RULES', 'SEO_TACTICS', 'SEO', 'VISUAL', 'MANAGEMENT'];

const CAT_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
    STRATEGY:    { label: 'Strateji',   color: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-500/25' },
    RULES:       { label: 'Kurallar',   color: 'text-red-300',    bg: 'bg-red-500/15',    border: 'border-red-500/25' },
    SEO_TACTICS: { label: 'SEO Taktik', color: 'text-emerald-300',bg: 'bg-emerald-500/15',border: 'border-emerald-500/25' },
    SEO:         { label: 'SEO',        color: 'text-blue-300',   bg: 'bg-blue-500/15',   border: 'border-blue-500/25' },
    VISUAL:      { label: 'Görsel',     color: 'text-pink-300',   bg: 'bg-pink-500/15',   border: 'border-pink-500/25' },
    MANAGEMENT:  { label: 'Yönetim',   color: 'text-amber-300',  bg: 'bg-amber-500/15',  border: 'border-amber-500/25' },
};

const DEFAULT_CAT = { label: 'Diğer', color: 'text-slate-300', bg: 'bg-slate-500/15', border: 'border-slate-500/25' };

const ITEM_H   = 68;   // px — memory card
const HEADER_H = 44;   // px — category header

// ─── Types ────────────────────────────────────────────────────────────────────

type InputTab = 'youtube' | 'social' | 'file' | 'radar' | 'factory' | 'text' | 'test' | 'learn' | 'brainstorm';
type YtSubTab = 'urls' | 'channel';
type SocialPlatform = 'twitter' | 'instagram';
type RadarPlatform = 'pinterest' | 'tiktok';

const SOURCE_TABS: InputTab[] = ['youtube', 'social', 'file', 'radar'];

type FlatItem =
    | { kind: 'header'; category: string; count: number }
    | { kind: 'item';   memory: CorporateMemory };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayTitle(m: CorporateMemory): string {
    if (m.analysisResult?.displayTitle) return m.analysisResult.displayTitle;
    return m.title
        .replace(/^\[YouTube\]\s*/i, '')
        .replace(/\s*—\s*(STRATEGY|RULES|SEO_TACTICS|SEO|VISUAL|MANAGEMENT)\s*$/i, '')
        .replace(/\s*\[\d+\/\d+\]\s*$/i, '')
        .slice(0, 40);
}

function getSourceIcon(m: CorporateMemory) {
    const t = m.title.toLowerCase();
    if (t.includes('[youtube]') || m.type === 'YOUTUBE_SMART')
        return <Youtube className="w-3 h-3 text-red-400 flex-shrink-0" />;
    if (m.type === 'STRATEGIC_RULE')
        return <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />;
    if (m.type === 'VIDEO_FULL' || m.type === 'BRAIN_VIDEO')
        return <Video className="w-3 h-3 text-blue-400 flex-shrink-0" />;
    return <FileText className="w-3 h-3 text-text-tertiary flex-shrink-0" />;
}

function extractUrls(text: string): string[] {
    return text.split(/\n|,/).map(l => l.trim()).filter(l => l.startsWith('http'));
}

function fmtFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
}

function fmtViews(n: number | null): string {
    if (n === null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
}

function fmtDuration(secs: number | null): string {
    if (!secs) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(d: string | null): string {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: '2-digit' }); }
    catch { return d; }
}

function JobStateChip({ state, progress }: { state: string; progress: number }) {
    if (state === 'completed')
        return <span className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="w-3 h-3" /> Tamamlandı</span>;
    if (state === 'failed')
        return <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3 h-3" /> Hata</span>;
    if (state === 'active')
        return <span className="flex items-center gap-1 text-blue-400 text-xs"><Loader2 className="w-3 h-3 animate-spin" /> %{progress}</span>;
    return <span className="flex items-center gap-1 text-amber-400 text-xs"><Clock className="w-3 h-3" /> Bekliyor</span>;
}

function extractVideoId(url: string): string | null {
    const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function getYtThumbnail(url: string): string | null {
    const id = extractVideoId(url);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function fmtTimestamp(ts?: number): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BrainClient() {
    // ── Global state ──────────────────────────────────────────────────────────
    const [memories, setMemories]     = useState<CorporateMemory[]>([]);
    const [loading, setLoading]       = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [inputTab, setInputTab]     = useState<InputTab>('youtube');

    type MainTab = 'knowledge' | 'radar' | 'brainstorm' | 'feedback';
    const [mainTab, setMainTab]       = useState<MainTab>('knowledge');

    // ── Sidebar state ─────────────────────────────────────────────────────────
    const [searchQuery, setSearchQuery]       = useState('');
    const [openCategories, setOpenCategories] = useState<Set<string>>(
        () => new Set(CATEGORY_ORDER)     // all open by default
    );

    // ── Text tab ──────────────────────────────────────────────────────────────
    const [textTitle, setTextTitle]     = useState('');
    const [textSource, setTextSource]   = useState('');
    const [textContent, setTextContent] = useState('');
    const [addingText, setAddingText]   = useState(false);

    // ── Test tab ──────────────────────────────────────────────────────────────
    const [testQuestion, setTestQuestion] = useState('');
    const [testAnswer, setTestAnswer]     = useState('');
    const [testing, setTesting]           = useState(false);

    // ── Academy Rules tab ─────────────────────────────────────────────────────
    const [learnTitle, setLearnTitle]       = useState('');
    const [learnContent, setLearnContent]   = useState('');
    const [learnCategory, setLearnCategory] = useState<'STRATEGY' | 'RULES' | 'SEO_TACTICS'>('STRATEGY');
    const [learning, setLearning]           = useState(false);
    const [learnResult, setLearnResult]     = useState<{ saved: number } | null>(null);

    // ── Brainstorm tab ────────────────────────────────────────────────────────
    const router = useRouter();
    const [brainstormRunning, setBrainstormRunning]   = useState(false);
    const [brainstormResult, setBrainstormResult]     = useState<BrainstormResult | null>(null);
    const [brainstormFocusNiche, setBrainstormFocusNiche] = useState('');
    const [brainstormCount, setBrainstormCount]       = useState(5);
    const [brainstormTab, setBrainstormTab]           = useState<'new'|'pool'>('new');
    const [brainstormMode, setBrainstormMode]         = useState<'ai' | 'ideas'>('ai');
    const [negativeConstraints, setNegativeConstraints] = useState<string[]>([]);

    type IdeaStatus = 'idle' | 'drafting' | 'draft_ready' | 'finalizing' | 'completed';
    interface IdeaCardState {
        status:           IdeaStatus;
        draftBatchId?:    string;
        draftImages?:     { id: string; url: string; seed?: string | null }[];
        finalBatchId?:    string;
        finalImageUrl?:   string;
        finalModelKey?:   FinalRenderModelKey;
        finalSeed?:       string | null;
        showModelPicker:  boolean;
        selectedDraftId?: string;
        overlayUrl?:      string | null;
        applyingOverlay?: boolean;
    }
    const [ideaStates, setIdeaStates] = useState<Map<number, IdeaCardState>>(new Map());
    const pollRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    // ── Style Consistency ─────────────────────────────────────────────────────
    const [stylePresets, setStylePresets]           = useState<StylePreset[]>([]);
    const [savedProfiles, setSavedProfiles]         = useState<StyleProfile[]>([]);
    const [activeStylePreset, setActiveStylePreset] = useState<string | null>(null);
    const [activeProfileId, setActiveProfileId]     = useState<string | null>(null);
    const [lockedDNA, setLockedDNA]                 = useState<LockedDNA | null>(null);

    // ── YouTube Ingest tab ────────────────────────────────────────────────────
    const [ytSubTab, setYtSubTab]       = useState<YtSubTab>('urls');
    const [rawInput, setRawInput]       = useState('');
    const [submitting, setSubmitting]   = useState(false);
    const [jobs, setJobs]               = useState<IngestJob[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [queueStats, setQueueStats]   = useState<QueueStats | null>(null);
    const [jobListTab, setJobListTab]   = useState<'active' | 'completed' | 'failed'>('active');
    const [consoleLogs, setConsoleLogs] = useState<LogEntry[]>([]);
    const [pollError, setPollError]     = useState(false);
    const pollRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const backoffRef = useRef(5000);
    const errCountRef = useRef(0);
    const consoleRef  = useRef<HTMLDivElement>(null);
    const prevCompletedRef = useRef(0);

    // ── Channel Extractor (YouTube sub-tab) ───────────────────────────────────
    const [channelUrl, setChannelUrl]         = useState('');
    const [channelName, setChannelName]       = useState<string | null>(null);
    const [channelVids, setChannelVids]       = useState<ChannelVideo[]>([]);
    const [channelLoading, setChannelLoading] = useState(false);
    const [channelSending, setChannelSending] = useState(false);
    const [selected, setSelected]             = useState<Set<string>>(new Set());
    const [sortBy, setSortBy]                 = useState<'views' | 'date'>('views');
    const [minViews, setMinViews]             = useState(0);

    // ── Social tab ────────────────────────────────────────────────────────────
    const [socialPlatform, setSocialPlatform] = useState<SocialPlatform>('twitter');
    const [socialInput, setSocialInput]       = useState('');
    const [socialCookies, setSocialCookies]   = useState('');
    const [showCookies, setShowCookies]       = useState(false);
    const [socialSubmitting, setSocialSubmitting] = useState(false);

    // ── Radar tab ─────────────────────────────────────────────────────────────
    const [radarPlatform, setRadarPlatform]   = useState<RadarPlatform>('pinterest');
    const [radarInput, setRadarInput]         = useState('');
    const [radarSubmitting, setRadarSubmitting] = useState(false);

    // ── File tab ──────────────────────────────────────────────────────────────
    const [fileUploading, setFileUploading]   = useState(false);
    const [stagedFiles, setStagedFiles]       = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
    const [fileDragOver, setFileDragOver]     = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Factory Control tab ───────────────────────────────────────────────────
    const [factoryRules, setFactoryRules]     = useState<BatchRule[]>([]);
    const [factoryLoading, setFactoryLoading] = useState(false);
    const [factoryStarting, setFactoryStarting] = useState(false);
    const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
    const [factoryEngine, setFactoryEngine]   = useState('fal-ai/flux/schnell');
    const [factoryStyle, setFactoryStyle]     = useState('minimalist');
    const [factoryCount, setFactoryCount]     = useState(10);
    const [activeBatchId, setActiveBatchId]   = useState<string | null>(null);
    const [batchStatus, setBatchStatus]       = useState<BatchStatus | null>(null);
    const batchPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const parsedUrls = extractUrls(rawInput);

    // ─── Virtual scrolling ref ────────────────────────────────────────────────
    const parentRef = useRef<HTMLDivElement>(null);

    // ─── Flat virtual item list ───────────────────────────────────────────────

    const flatItems = useMemo<FlatItem[]>(() => {
        const q = searchQuery.trim().toLowerCase();

        if (q) {
            // Search mode: flat filtered list (no headers)
            return memories
                .filter(m => getDisplayTitle(m).toLowerCase().includes(q))
                .map(m => ({ kind: 'item' as const, memory: m }));
        }

        // Grouped mode
        const grouped: Record<string, CorporateMemory[]> = {};
        for (const m of memories) {
            const cat = m.category || 'STRATEGY';
            (grouped[cat] = grouped[cat] || []).push(m);
        }

        const items: FlatItem[] = [];
        const allCats = [
            ...CATEGORY_ORDER.filter(c => grouped[c]?.length),
            ...Object.keys(grouped).filter(c => !CATEGORY_ORDER.includes(c) && grouped[c]?.length),
        ];

        for (const cat of allCats) {
            const mems = grouped[cat] || [];
            items.push({ kind: 'header', category: cat, count: mems.length });
            if (openCategories.has(cat)) {
                for (const m of mems) items.push({ kind: 'item', memory: m });
            }
        }
        return items;
    }, [memories, searchQuery, openCategories]);

    const virtualizer = useVirtualizer({
        count: flatItems.length,
        getScrollElement: () => parentRef.current,
        estimateSize: (i) => flatItems[i].kind === 'header' ? HEADER_H : ITEM_H,
        overscan: 8,
    });

    // ─── Data loading ──────────────────────────────────────────────────────────

    const [showAddPanel, setShowAddPanel] = useState(false);

    const loadMemories = async () => {
        setLoading(true);
        try {
            const data = await apiBrain.list();
            setMemories(data);
        } catch { toast.error('Brain verileri yüklenemedi'); }
        finally { setLoading(false); }
    };

    const loadJobs = useCallback(async (): Promise<boolean> => {
        try {
            const [res, stats, logRes] = await Promise.all([
                apiKnowledge.getIngestJobs(),
                apiKnowledge.getQueueStats(),
                apiLogs.getRecent(20),
            ]);
            setJobs(res.jobs);
            setQueueStats(stats);
            setConsoleLogs(logRes.logs);
            if (stats.completed > prevCompletedRef.current) {
                prevCompletedRef.current = stats.completed;
                loadMemories();
            }
            return true;
        } catch {
            return false;
        } finally {
            setLoadingJobs(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => { loadMemories(); }, []);
    useEffect(() => { loadJobs(); }, [loadJobs]);

    useEffect(() => {
        if (!SOURCE_TABS.includes(inputTab)) {
            if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
            return;
        }
        let cancelled = false;
        const run = async () => {
            if (cancelled) return;
            const ok = await loadJobs();
            if (cancelled) return;
            if (ok) {
                backoffRef.current = 5000;
                errCountRef.current = 0;
                setPollError(false);
            } else {
                errCountRef.current++;
                backoffRef.current = Math.min(backoffRef.current * 2, 60000);
                if (errCountRef.current >= 2) setPollError(true);
            }
            pollRef.current = setTimeout(run, backoffRef.current);
        };
        pollRef.current = setTimeout(run, 5000);
        return () => {
            cancelled = true;
            if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
        };
    }, [inputTab, loadJobs]);

    useEffect(() => {
        if (consoleRef.current) {
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }
    }, [consoleLogs]);

    // ─── Handlers ─────────────────────────────────────────────────────────────

    const toggleCategory = (cat: string) => {
        setOpenCategories(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
        });
    };

    const handleRetryJob = async (jobId: string) => {
        try {
            await apiKnowledge.retryFailed({ jobIds: [jobId] });
            toast.success('Video Deep Scavenger ile yeniden kuyruğa alındı');
            await loadJobs();
        } catch { toast.error('Yeniden deneme başarısız'); }
    };

    const handleYoutubeSubmit = async () => {
        if (parsedUrls.length === 0) return;
        setSubmitting(true);
        try {
            const res = await apiKnowledge.submitYoutubeBulk(parsedUrls.map(url => ({ url })));
            toast.success(`${res.jobs.length} video kuyruğa eklendi`);
            setRawInput('');
            await loadJobs();
        } catch (err: unknown) {
            toast.error('Hata: ' + (err instanceof Error ? err.message : String(err)));
        } finally { setSubmitting(false); }
    };

    const handleAddText = async () => {
        if (!textTitle.trim() || !textContent.trim()) { toast.error('Başlık ve içerik zorunludur'); return; }
        setAddingText(true);
        try {
            const result = await apiBrain.addText(textTitle, textContent, textSource || 'manual', undefined);
            setMemories(prev => [result, ...prev]);
            setSelectedId(result.id);
            setTextTitle(''); setTextSource(''); setTextContent('');
            toast.success('Bilgi tabanına eklendi!');
        } catch (err) { toast.error('Hata: ' + (err as Error).message); }
        finally { setAddingText(false); }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Bu kaydı sil?')) return;
        try {
            await apiBrain.delete(id);
            setMemories(prev => prev.filter(m => m.id !== id));
            if (selectedId === id) setSelectedId(memories.find(m => m.id !== id)?.id ?? null);
            toast.success('Kayıt silindi');
        } catch { toast.error('Silinemedi'); }
    };

    const handleTest = async () => {
        if (!testQuestion.trim()) return;
        setTesting(true); setTestAnswer('');
        try {
            const res = await fetch('/api/brain/test-knowledge', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: testQuestion }),
            });
            const data = await res.json();
            setTestAnswer(data.answer || 'Cevap bulunamadı. Önce bilgi ekleyin.');
        } catch { setTestAnswer('Bilgi tabanına bağlanılamadı.'); }
        finally { setTesting(false); }
    };

    const handleLearn = async () => {
        if (!learnTitle.trim() || !learnContent.trim()) { toast.error('Başlık ve içerik zorunludur'); return; }
        setLearning(true); setLearnResult(null);
        try {
            const res = await apiKnowledge.ingestText(learnTitle.trim(), learnContent.trim(), learnCategory);
            setLearnResult({ saved: res.saved });
            setLearnTitle(''); setLearnContent('');
            toast.success(`${res.saved} chunk kaydedildi`);
        } catch (err) { toast.error('Hata: ' + (err as Error).message); }
        finally { setLearning(false); }
    };

    const handleBrainstorm = async () => {
        setBrainstormRunning(true);
        setBrainstormResult(null);
        try {
            const result = await apiBrain.brainstorm({
                count: brainstormCount,
                focusNiche: brainstormFocusNiche.trim() || undefined,
                excludeNiches: negativeConstraints.length > 0 ? negativeConstraints : undefined,
            });
            setBrainstormResult(result);
            toast.success(`${result.ideas.length} fikir üretildi — ${result.rulesUsed} kural kullanıldı`);
        } catch (err) { toast.error('Brainstorm hatası: ' + (err as Error).message); }
        finally { setBrainstormRunning(false); }
    };

    const setIdeaState = (i: number, patch: Partial<IdeaCardState>) =>
        setIdeaStates(prev => {
            const next = new Map(prev);
            next.set(i, { showModelPicker: false, status: 'idle', ...prev.get(i), ...patch });
            return next;
        });

    const startPoll = (ideaIndex: number, batchJobId: string, phase: 'draft' | 'final') => {
        const tick = async () => {
            try {
                const s = await apiBatch.getStatus(batchJobId);
                const hasReady = (s.images ?? []).some(img => img.imageUrl && img.imageUrl !== 'PENDING');

                if (s.status === 'COMPLETED' || hasReady) {
                    if (phase === 'draft') {
                        const draftImgs = (s.images ?? [])
                            .filter(img => img.imageUrl && img.imageUrl !== 'PENDING')
                            .map(img => ({ id: img.id, url: img.imageUrl as string, seed: img.seed }));
                        setIdeaState(ideaIndex, { status: 'draft_ready', draftImages: draftImgs });
                        toast.success('2 taslak hazır — Final Render için bir tanesini seç');
                    } else {
                        const finalImg = (s.images ?? []).find(img => img.imageUrl && img.imageUrl !== 'PENDING');
                        setIdeaState(ideaIndex, { status: 'completed', finalImageUrl: finalImg?.imageUrl ?? undefined, finalSeed: finalImg?.seed ?? null });
                        toast.success('Final görsel hazır!', {
                            action: { label: 'Galeri →', onClick: () => router.push('/dashboard/gallery') },
                            duration: 8000,
                        });
                    }
                    pollRefs.current.delete(ideaIndex);
                    return;
                }
                if (s.status === 'FAILED') {
                    setIdeaState(ideaIndex, { status: phase === 'draft' ? 'idle' : 'draft_ready' });
                    toast.error(`${phase === 'draft' ? 'Taslak' : 'Final render'} başarısız`);
                    pollRefs.current.delete(ideaIndex);
                    return;
                }
            } catch { /* network hiccup, retry */ }
            const t = setTimeout(tick, 4000);
            pollRefs.current.set(ideaIndex, t);
        };
        const t = setTimeout(tick, 3000);
        pollRefs.current.set(ideaIndex, t);
    };

    const handleStartDraft = async (idea: BrainstormIdea, i: number) => {
        setIdeaState(i, { status: 'drafting' });
        try {
            const inheritedSeed = lockedDNA?.seed;
            const res = await apiBatch.draft({
                niche:         idea.niche,
                designBrief:   idea.designBrief,
                productType:   idea.productType,
                ideaTitle:     idea.title,
                stylePresetId: activeStylePreset || lockedDNA?.stylePresetId || undefined,
                styleProfileId: activeProfileId || lockedDNA?.profileId || undefined,
                referenceImageUrl: lockedDNA?.referenceImageUrl || undefined,
                seed:          inheritedSeed,
            });
            setIdeaState(i, { draftBatchId: res.batchJobId });
            startPoll(i, res.batchJobId, 'draft');
        } catch (err) {
            setIdeaState(i, { status: 'idle' });
            toast.error('Taslak başlatılamadı: ' + (err as Error).message);
        }
    };

    const handleFinalRender = async (idea: BrainstormIdea, i: number, modelKey: FinalRenderModelKey) => {
        const cs = ideaStates.get(i);
        const inheritedSeed = lockedDNA?.seed ?? (cs?.draftImages?.[0]?.seed ? parseInt(cs.draftImages[0].seed!) : undefined);
        setIdeaState(i, { status: 'finalizing', showModelPicker: false, finalModelKey: modelKey });
        try {
            const res = await apiBatch.finalRender({
                modelKey,
                designBrief:   idea.designBrief,
                niche:         idea.niche,
                variantLabel:  idea.title,
                stylePresetId: activeStylePreset || lockedDNA?.stylePresetId || undefined,
                styleProfileId: activeProfileId || lockedDNA?.profileId || undefined,
                seed:          inheritedSeed,
            });
            setIdeaState(i, { finalBatchId: res.batchJobId });
            startPoll(i, res.batchJobId, 'final');
            toast(`${FINAL_RENDER_MODELS[modelKey].label} ile render başladı…`);
        } catch (err) {
            setIdeaState(i, { status: 'draft_ready' });
            toast.error('Final render başlatılamadı: ' + (err as Error).message);
        }
    };

    const handleLockStyle = async (idea: BrainstormIdea, i: number) => {
        const cs = ideaStates.get(i);
        if (!cs || cs.status !== 'completed') return;
        const dna: LockedDNA = {
            sourceTitle:    idea.title,
            modelKey:       cs.finalModelKey || 'PREMIUM_GOOGLE',
            stylePresetId:  activeStylePreset || undefined,
            seed:           cs.finalSeed ? parseInt(cs.finalSeed) : undefined,
            designBrief:    idea.designBrief,
            referenceImageUrl: cs.finalImageUrl || undefined,
        };
        try {
            const res = await apiStyles.fromLockedDNA(dna);
            if (res.success && res.profile) {
                dna.profileId = res.profile.id;
            }
            setLockedDNA(dna);
            toast.success(`"${idea.title.slice(0, 30)}" stili kilitlendi — yeni kartlar bu genetiği kullanacak`, { duration: 5000 });
        } catch (err) {
            toast.error('Stil kilitlenirken hata: ' + (err as Error).message);
        }
    };

    const handleSloganOverlay = async (idea: BrainstormIdea, i: number) => {
        const cs = ideaStates.get(i);
        if (!cs?.finalImageUrl) return;
        if (cs.overlayUrl) {
            setIdeaState(i, { overlayUrl: null });
            return;
        }
        setIdeaState(i, { applyingOverlay: true });
        try {
            const dataUrl = await drawSloganOverlay(cs.finalImageUrl, idea.title, { position: 'bottom', uppercase: true });
            setIdeaState(i, { overlayUrl: dataUrl, applyingOverlay: false });
        } catch {
            setIdeaState(i, { applyingOverlay: false });
            toast.error('Yazı katmanı eklenemedi — CORS kısıtlaması olabilir');
        }
    };

    const handleRefreshIdea = async (id: string) => {
        try {
            const res = await apiBrain.updateIdea(id);
            if (res.success && res.updatedData) {
                setMemories(prev => prev.map(m => m.id === id ? { ...m, analysisResult: { ...m.analysisResult, ...res.updatedData } } : m));
                toast.success('Fikir başarıyla güncellendi (re-scored)!');
            }
        } catch (err) {
            toast.error('Fikir güncellenirken hata: ' + (err as Error).message);
        }
    };

    // ── Social / Radar / File handlers ────────────────────────────────────────

    const handleSocialSubmit = async () => {
        const urls = extractUrls(socialInput);
        if (urls.length === 0) { toast.error('En az 1 URL girin'); return; }
        setSocialSubmitting(true);
        try {
            const res = await apiKnowledge.ingest({ source: 'social', urls, platform: socialPlatform });
            toast.success(`${res.jobs.length} sosyal medya sayfası kuyruğa eklendi`);
            setSocialInput('');
            await loadJobs();
        } catch (err) { toast.error('Hata: ' + (err as Error).message); }
        finally { setSocialSubmitting(false); }
    };

    const handleRadarSubmit = async () => {
        const urls = extractUrls(radarInput);
        if (urls.length === 0) { toast.error('En az 1 URL girin'); return; }
        setRadarSubmitting(true);
        try {
            const res = await apiKnowledge.ingest({ source: 'radar', urls, platform: radarPlatform });
            toast.success(`${res.jobs.length} trend sayfası kuyruğa eklendi`);
            setRadarInput('');
            await loadJobs();
        } catch (err) { toast.error('Hata: ' + (err as Error).message); }
        finally { setRadarSubmitting(false); }
    };

    const addStagedFiles = (files: File[]) => {
        setStagedFiles(prev => {
            const existing = new Set(prev.map(f => f.name));
            return [...prev, ...files.filter(f => !existing.has(f.name))];
        });
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) addStagedFiles(files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setFileDragOver(false);
        const files = Array.from(e.dataTransfer.files).filter(f =>
            /\.(pdf|txt|mp4|mov|avi|mp3|wav)$/i.test(f.name)
        );
        if (files.length) addStagedFiles(files);
    };

    const handleBulkUpload = async () => {
        if (!stagedFiles.length) return;
        setFileUploading(true);
        setUploadProgress({ done: 0, total: stagedFiles.length });
        let done = 0;
        const errors: string[] = [];
        for (const file of stagedFiles) {
            try {
                await apiKnowledge.uploadFile(file);
                done++;
                setUploadProgress({ done, total: stagedFiles.length });
            } catch {
                errors.push(file.name);
            }
        }
        if (errors.length === 0) {
            toast.success(`${done} dosya kuyruğa eklendi`);
        } else {
            if (done > 0) toast.success(`${done} dosya kuyruğa eklendi`);
            toast.error(`${errors.length} dosya yüklenemedi: ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '…' : ''}`);
        }
        setStagedFiles([]);
        setUploadProgress(null);
        setFileUploading(false);
        await loadJobs();
    };

    // ── Factory Control handlers ───────────────────────────────────────────────

    const loadFactoryRules = useCallback(async () => {
        setFactoryLoading(true);
        try {
            const res = await apiBatch.getRules();
            setFactoryRules(res.rules);
        } catch { toast.error('Kurallar yüklenemedi'); }
        finally { setFactoryLoading(false); }
    }, []);

    const handleStartBatch = async () => {
        const rule = factoryRules.find(r => r.id === selectedRuleId);
        if (!rule) { toast.error('Önce bir kural seç'); return; }
        setFactoryStarting(true);
        try {
            const res = await apiBatch.startFromRule({
                ruleId:      rule.id,
                ruleTitle:   rule.title,
                ruleContent: rule.content,
                count:       factoryCount,
                engine:      factoryEngine,
                style:       factoryStyle,
            });
            toast.success(`${res.imageCount} tasarım kuyruğa alındı — $${res.projectedCost.toFixed(3)} tahmini maliyet`);
            setActiveBatchId(res.batchJobId);
            setBatchStatus(null);
        } catch (err) { toast.error('Batch başlatılamadı: ' + (err as Error).message); }
        finally { setFactoryStarting(false); }
    };

    const pollBatchStatus = useCallback(async (batchJobId: string) => {
        try {
            const s = await apiBatch.getStatus(batchJobId);
            setBatchStatus(s);
            if (s.status === 'PROCESSING' || s.pending > 0) {
                batchPollRef.current = setTimeout(() => pollBatchStatus(batchJobId), 4000);
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (inputTab === 'factory' && factoryRules.length === 0) loadFactoryRules();
    }, [inputTab, factoryRules.length, loadFactoryRules]);

    useEffect(() => {
        if (inputTab === 'brainstorm' && stylePresets.length === 0) {
            apiBatch.getStyles().then(r => setStylePresets(r.presets)).catch(() => {});
        }
    }, [inputTab, stylePresets.length]);

    useEffect(() => {
        if (inputTab === 'brainstorm') {
            apiStyles.list().then(r => setSavedProfiles(r.profiles)).catch(() => {});
        }
    }, [inputTab]);

    useEffect(() => {
        if (activeBatchId) {
            pollBatchStatus(activeBatchId);
            return () => { if (batchPollRef.current) clearTimeout(batchPollRef.current); };
        }
    }, [activeBatchId, pollBatchStatus]);

    // ── Channel Extractor handlers ──────────────────────────────────────────────

    const handleChannelScan = async () => {
        if (!channelUrl.trim()) return;
        setChannelLoading(true);
        setChannelVids([]); setSelected(new Set()); setChannelName(null);
        try {
            const res = await apiKnowledge.extractChannel(channelUrl.trim(), 200);
            const uniqueVids = res.videos.filter((v: {videoId: string}, i: number, arr: {videoId: string}[]) => arr.findIndex(x => x.videoId === v.videoId) === i);
            setChannelVids(uniqueVids);
            setChannelName(res.channelName);
            setSelected(new Set(uniqueVids.map((v: {videoId: string}) => v.videoId)));
            toast.success(`${res.videos.length} video bulundu${res.channelName ? ` — ${res.channelName}` : ''}`);
        } catch (err) { toast.error('Kanal tarama hatası: ' + (err as Error).message); }
        finally { setChannelLoading(false); }
    };

    const handleChannelIngest = async () => {
        const toIngest = channelVids.filter(v => selected.has(v.videoId));
        if (toIngest.length === 0) { toast.error('En az 1 video seç'); return; }
        setChannelSending(true);
        toast.info(`${toIngest.length} video kuyruğa gönderiliyor...`);
        try {
            const res = await apiKnowledge.submitYoutubeBulk(
                toIngest.map(v => ({ url: v.url, title: v.title, category: 'STRATEGY' }))
            );
            toast.success(`${res.jobs.length} video Brain kuyruğuna eklendi!`);
            setSelected(new Set());
            setInputTab('youtube');
            await loadJobs();
        } catch (err) { toast.error('Gönderme hatası: ' + (err as Error).message); }
        finally { setChannelSending(false); }
    };

    const filteredVids = channelVids
        .filter(v => minViews === 0 || (v.viewCount ?? 0) >= minViews)
        .sort((a, b) => {
            if (sortBy === 'views') return (b.viewCount ?? -1) - (a.viewCount ?? -1);
            return (b.uploadDate ?? '').localeCompare(a.uploadDate ?? '');
        });

    const toggleAll = () => {
        if (selected.size === filteredVids.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filteredVids.map(v => v.videoId)));
        }
    };

    const toggleOne = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const selectedMemory  = memories.find(m => m.id === selectedId);
    const activeJobCount  = jobs.filter(j => j.state === 'active' || j.state === 'waiting' || j.state === 'delayed').length;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-[calc(100vh-120px)]">
            {/* ── MAIN TABS ── */}
            <div className="flex bg-bg-base border-b border-border-subtle px-6 pt-2">
                {([
                    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
                    { id: 'radar', label: 'Radar', icon: Compass },
                    { id: 'brainstorm', label: 'Brainstorm', icon: Lightbulb },
                    { id: 'feedback', label: 'Feedback', icon: BarChart2 },
                ] as const).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => { setMainTab(tab.id); setSelectedId(null); setShowAddPanel(false); if (tab.id === 'brainstorm') setInputTab('brainstorm'); if (tab.id === 'knowledge') setInputTab('youtube'); }}
                        className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all ${
                            mainTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'
                        }`}
                    >
                        <tab.icon className="w-4 h-4" /> <span className="hidden md:block">{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="flex flex-1 p-2 overflow-hidden">

                {/* ══ MAIN PANEL ═══════════════════════════════════════════════ */}
            <div className="flex-1 bg-[#111827] border border-border-subtle rounded-2xl overflow-hidden flex flex-col min-w-0">

                {mainTab === 'radar' ? (
                    <div className="flex-1 overflow-y-auto w-full"><TrendsClient /></div>
                ) : mainTab === 'feedback' ? (
                    <div className="flex-1 overflow-y-auto w-full p-6"><AnalyticsClient onSendToBrainstorm={(niche) => {
                        setNegativeConstraints(prev => [...new Set([...prev, niche])]);
                        setBrainstormFocusNiche('');
                        setMainTab('brainstorm');
                        setBrainstormMode('ai');
                        setBrainstormTab('new');
                        setInputTab('brainstorm');
                        toast.info(`"${niche}" negatif kısıt olarak eklendi → Brainstorm'a geçildi`, { duration: 4000 });
                    }} /></div>
                ) : selectedMemory ? (
                    /* ── Memory Detail ────────────────────────────────────── */
                    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-7">
                        {/* Back */}
                        <button onClick={() => setSelectedId(null)} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors mb-1">
                            <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Hazineye Dön
                        </button>
                        {/* Header */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                                {(() => {
                                    const cm = CAT_META[selectedMemory.category] || DEFAULT_CAT;
                                    return (
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-semibold border ${cm.bg} ${cm.color} ${cm.border}`}>
                                            {cm.label}
                                        </span>
                                    );
                                })()}
                                {selectedMemory.analysisResult?.seoUpdated && (
                                    <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/20 flex items-center gap-1">
                                        <ArrowUpCircle className="w-3 h-3" /> SEO Güncellendi
                                    </span>
                                )}
                                <span className="text-text-tertiary text-xs">
                                    {new Date(selectedMemory.createdAt).toLocaleString('tr-TR')}
                                </span>
                            </div>
                            <h1 className="text-xl font-bold text-text-primary">
                                {getDisplayTitle(selectedMemory)}
                            </h1>
                            {selectedMemory.analysisResult?.frameCount && (
                                <p className="text-xs text-text-tertiary flex items-center gap-2">
                                    <BarChart2 className="w-3.5 h-3.5" />
                                    {selectedMemory.analysisResult.frameCount} kare analiz edildi
                                </p>
                            )}
                        </div>

                        {/* Synthesis */}
                        {selectedMemory.analysisResult?.synthesis && (
                            <Section icon={<Brain className="w-4 h-4 text-accent" />} title="Bilgi Sentezi">
                                <div className="p-5 rounded-xl bg-bg-base border border-border-subtle">
                                    <pre className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                                        {selectedMemory.analysisResult.synthesis}
                                    </pre>
                                </div>
                            </Section>
                        )}

                        {/* IF-THEN Rules */}
                        {(selectedMemory.analysisResult?.actionableRules?.length ?? 0) > 0 && (
                            <Section icon={<Target className="w-4 h-4 text-accent" />} title="IF-THEN Kurallar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {selectedMemory.analysisResult!.actionableRules!.map((rule: {condition: string; action: string; rationale: string}, i: number) => (
                                        <div key={i} className="p-4 rounded-xl bg-bg-base border border-border-subtle hover:border-accent/30 transition-colors">
                                            <div className="space-y-2">
                                                <div className="flex items-start gap-2">
                                                    <span className="text-[10px] font-black text-accent bg-accent/10 px-2 py-0.5 rounded flex-shrink-0">IF</span>
                                                    <p className="text-sm text-text-primary">{rule.condition}</p>
                                                </div>
                                                <div className="flex items-start gap-2">
                                                    <span className="text-[10px] font-black text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded flex-shrink-0">THEN</span>
                                                    <p className="text-sm text-text-secondary">{rule.action}</p>
                                                </div>
                                                <p className="text-[11px] text-text-tertiary italic pt-2 border-t border-border-subtle">
                                                    {rule.rationale}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* UI Insights */}
                        {(selectedMemory.analysisResult?.uiInsights?.length ?? 0) > 0 && (
                            <Section icon={<Layout className="w-4 h-4 text-blue-400" />} title="Arayüz İçgörüleri">
                                {selectedMemory.analysisResult!.uiInsights!.map((ins: {element: string; recommendation: string}, i: number) => (
                                    <div key={i} className="flex gap-3 p-4 rounded-xl bg-bg-base border border-border-subtle">
                                        <div>
                                            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">{ins.element}</p>
                                            <p className="text-sm text-text-secondary mt-0.5">{ins.recommendation}</p>
                                        </div>
                                    </div>
                                ))}
                            </Section>
                        )}

                        {/* Strategic Notes */}
                        {(selectedMemory.analysisResult?.strategicNotes?.length ?? 0) > 0 && (
                            <Section icon={<Lightbulb className="w-4 h-4 text-amber-400" />} title="Stratejik Notlar">
                                {selectedMemory.analysisResult!.strategicNotes!.map((note: string, i: number) => (
                                    <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-bg-base border border-border-subtle">
                                        <ChevronRight className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                                        <p className="text-sm text-text-secondary">{note}</p>
                                    </div>
                                ))}
                            </Section>
                        )}

                        {/* Raw content fallback */}
                        {selectedMemory.content && !selectedMemory.analysisResult?.synthesis && (
                            <Section icon={<FileText className="w-4 h-4 text-text-tertiary" />} title="İçerik">
                                <div className="p-5 rounded-xl bg-bg-base border border-border-subtle">
                                    <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                                        {selectedMemory.content}
                                    </p>
                                </div>
                            </Section>
                        )}

                        {/* Transcript */}
                        {selectedMemory.analysisResult?.transcript && selectedMemory.analysisResult.transcript.length > 50 && (
                            <details className="group">
                                <summary className="flex items-center gap-2 cursor-pointer text-text-tertiary hover:text-text-secondary text-xs font-medium select-none">
                                    <Mic className="w-3.5 h-3.5" />
                                    Ses transkripsiyonu
                                    <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
                                </summary>
                                <div className="mt-3 p-4 rounded-xl bg-bg-base border border-border-subtle">
                                    <p className="text-xs text-text-tertiary leading-relaxed whitespace-pre-wrap font-mono">
                                        {selectedMemory.analysisResult.transcript.slice(0, 1000)}
                                        {selectedMemory.analysisResult.transcript.length > 1000 && '…'}
                                    </p>
                                </div>
                            </details>
                        )}
                    </div>
                ) : (showAddPanel || mainTab === 'brainstorm' || mainTab === 'knowledge') ? (
                    /* ── Input Panel ────────────────────────────────────── */
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Back to dashboard — only when showAddPanel was triggered manually */}
                        {showAddPanel && mainTab !== 'knowledge' && (
                        <div className="px-5 pt-4 pb-0 flex-shrink-0">
                            <button onClick={() => { setShowAddPanel(false); setMainTab('knowledge'); }} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors">
                                <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Hazineye Dön
                            </button>
                        </div>
                        )}

                        {/* ── Yeni Bilgi Kaynağı Ekle — Unified Tab Bar ── */}
                        {mainTab !== 'brainstorm' && (
                            <div className="flex border-b border-border-subtle px-3 flex-shrink-0 overflow-x-auto mt-2">
                                {([
                                    { key: 'youtube', label: 'YouTube',    icon: Youtube,       badge: 'YT' },
                                    { key: 'social',  label: 'Sosyal',     icon: Share2,        badge: 'Social' },
                                    { key: 'file',    label: 'Dosya',      icon: Upload,        badge: 'File' },
                                    { key: 'text',    label: 'Metin',      icon: FileText,      badge: null },
                                    { key: 'learn',       label: 'Kural',       icon: GraduationCap, badge: null },
                                ] as const).map(({ key, label, icon: Icon, badge }) => (
                                    <button
                                    key={key}
                                    onClick={() => setInputTab(key as InputTab)}
                                    className={`relative flex items-center gap-1.5 px-3 py-3.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                                        inputTab === key
                                            ? 'border-accent text-accent'
                                            : 'border-transparent text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                                    {label}
                                    {badge && (
                                        <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                            inputTab === key ? 'bg-accent/20 text-accent' : 'bg-white/5 text-text-tertiary'
                                        }`}>{badge}</span>
                                    )}
                                    {key === 'youtube' && activeJobCount > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold">
                                            {activeJobCount}
                                        </span>
                                    )}
                                </button>
                            ))}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-6 w-full max-w-none">

                            {/* ── YouTube (URLs + Channel merged) ─────── */}
                            {inputTab === 'youtube' && (
                                <div className="space-y-5">
                                    {/* YT Sub-tabs */}
                                    <div className="flex items-center gap-1 p-1 bg-white/3 border border-border-subtle rounded-xl w-fit">
                                        <button onClick={() => setYtSubTab('urls')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${ytSubTab === 'urls' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><Youtube className="w-3 h-3" /> URL Yapıştır</span>
                                        </button>
                                        <button onClick={() => setYtSubTab('channel')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${ytSubTab === 'channel' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><ListVideo className="w-3 h-3" /> Kanal Tarayıcı</span>
                                        </button>
                                    </div>

                                    {/* ── URL Ingest sub-tab ── */}
                                    {ytSubTab === 'urls' && (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">YouTube URL&apos;leri</label>
                                                <textarea value={rawInput} onChange={e => setRawInput(e.target.value)}
                                                    placeholder={"https://www.youtube.com/watch?v=abc123\nhttps://youtu.be/xyz456"} rows={4}
                                                    className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none transition-colors" />
                                                {parsedUrls.length > 0 && <p className="mt-1 text-xs text-text-tertiary">{parsedUrls.length} URL algılandı</p>}
                                            </div>
                                            <div className="flex items-start gap-3 p-3 rounded-xl bg-violet-500/8 border border-violet-500/20">
                                                <Brain className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                                                <p className="text-xs text-text-secondary leading-relaxed">AI içeriği analiz eder, kategorilere otomatik dağıtır. Çelişen eski bilgileri otomatik devre dışı bırakır.</p>
                                            </div>
                                            <button onClick={handleYoutubeSubmit} disabled={submitting || parsedUrls.length === 0}
                                                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity">
                                                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Kuyruğa ekleniyor...</> : <><Youtube className="w-4 h-4" /> {parsedUrls.length > 0 ? `${parsedUrls.length} video gönder` : 'URL girin'}</>}
                                            </button>
                                        </div>
                                    )}

                                    {/* ── Channel Scanner sub-tab ── */}
                                    {ytSubTab === 'channel' && (
                                        <div className="space-y-4">
                                            <p className="text-sm text-text-secondary leading-relaxed">Kanal veya playlist URL'si gir → son 200 videoyu çeker, seçtiklerini Brain'e gönder.</p>

                                    {/* URL Input */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={channelUrl}
                                            onChange={e => setChannelUrl(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleChannelScan()}
                                            placeholder="https://www.youtube.com/@kanaladi  veya  /playlist?list=..."
                                            className="flex-1 bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                                        />
                                        <button
                                            onClick={handleChannelScan}
                                            disabled={channelLoading || !channelUrl.trim()}
                                            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center gap-2 transition-opacity whitespace-nowrap"
                                        >
                                            {channelLoading
                                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Taranıyor...</>
                                                : <><Search className="w-4 h-4" /> Tara</>
                                            }
                                        </button>
                                    </div>

                                    {/* Results */}
                                    {channelVids.length > 0 && (
                                        <div className="space-y-3">
                                            {/* Toolbar */}
                                            <div className="flex items-center justify-between flex-wrap gap-3">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    {channelName && (
                                                        <span className="text-xs font-semibold text-accent flex items-center gap-1">
                                                            <Youtube className="w-3.5 h-3.5 text-red-400" /> {channelName}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-text-tertiary">
                                                        {filteredVids.length} / {channelVids.length} video
                                                        {selected.size > 0 && <span className="text-accent ml-1">· {selected.size} seçili</span>}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {/* Sort toggle */}
                                                    <button
                                                        onClick={() => setSortBy(s => s === 'views' ? 'date' : 'views')}
                                                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border-subtle text-text-tertiary hover:text-text-secondary hover:border-border-default transition-colors"
                                                    >
                                                        <ArrowUpDown className="w-3 h-3" />
                                                        {sortBy === 'views' ? 'İzlenme ↓' : 'Tarih ↓'}
                                                    </button>
                                                    {/* Min views filter */}
                                                    <div className="flex items-center gap-1.5 text-xs border border-border-subtle rounded-lg px-2 py-1">
                                                        <Eye className="w-3 h-3 text-text-tertiary" />
                                                        <input
                                                            type="number"
                                                            value={minViews || ''}
                                                            onChange={e => setMinViews(parseInt(e.target.value || '0', 10))}
                                                            placeholder="Min görüntülenme"
                                                            className="bg-transparent outline-none w-28 text-text-secondary placeholder:text-text-tertiary"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Table */}
                                            <div className="border border-border-subtle rounded-xl overflow-hidden">
                                                {/* Table header */}
                                                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2 bg-white/3 border-b border-border-subtle text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                                                    <button onClick={toggleAll} className="text-text-tertiary hover:text-accent transition-colors">
                                                        {selected.size === filteredVids.length && filteredVids.length > 0
                                                            ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                                                            : <Square className="w-3.5 h-3.5" />
                                                        }
                                                    </button>
                                                    <span>Başlık</span>
                                                    <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> İzlenme</span>
                                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Tarih</span>
                                                    <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> Süre</span>
                                                </div>

                                                {/* Rows */}
                                                <div className="divide-y divide-border-subtle max-h-80 overflow-y-auto">
                                                    {filteredVids.map(vid => {
                                                        const isSelected = selected.has(vid.videoId);
                                                        return (
                                                            <div
                                                                key={vid.videoId}
                                                                onClick={() => toggleOne(vid.videoId)}
                                                                className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                                                                    isSelected ? 'bg-accent/5 hover:bg-accent/8' : 'hover:bg-white/3'
                                                                }`}
                                                            >
                                                                <div className="text-accent flex-shrink-0">
                                                                    {isSelected
                                                                        ? <CheckSquare className="w-3.5 h-3.5" />
                                                                        : <Square className="w-3.5 h-3.5 text-text-tertiary" />
                                                                    }
                                                                </div>
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    {vid.thumbnail && (
                                                                        <img
                                                                            src={vid.thumbnail}
                                                                            alt=""
                                                                            className="w-12 h-8 object-cover rounded flex-shrink-0 bg-bg-overlay"
                                                                            onError={e => { e.currentTarget.style.display = 'none'; }}
                                                                        />
                                                                    )}
                                                                    <span className="text-xs text-text-primary truncate">{vid.title}</span>
                                                                </div>
                                                                <span className={`text-xs font-mono font-medium whitespace-nowrap ${
                                                                    (vid.viewCount ?? 0) >= 100_000 ? 'text-emerald-400' :
                                                                    (vid.viewCount ?? 0) >= 10_000 ? 'text-blue-400' : 'text-text-tertiary'
                                                                }`}>
                                                                    {fmtViews(vid.viewCount)}
                                                                </span>
                                                                <span className="text-[11px] text-text-tertiary whitespace-nowrap">{fmtDate(vid.uploadDate)}</span>
                                                                <span className="text-[11px] text-text-tertiary whitespace-nowrap font-mono">{fmtDuration(vid.duration)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Submit button */}
                                            <button
                                                onClick={handleChannelIngest}
                                                disabled={channelSending || selected.size === 0}
                                                className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-violet-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity"
                                            >
                                                {channelSending
                                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Brain'e gönderiliyor...</>
                                                    : <><Youtube className="w-4 h-4" /> {selected.size > 0 ? `${selected.size} Videoyu Brain'e Öğret` : 'Video seç'}</>
                                                }
                                            </button>
                                        </div>
                                    )}

                                    {!channelLoading && channelVids.length === 0 && channelUrl && (
                                        <div className="flex flex-col items-center gap-3 py-8 text-center">
                                            <ListVideo className="w-8 h-8 text-text-tertiary opacity-20" />
                                            <p className="text-xs text-text-tertiary">Kanal URL'si gir ve Tara'ya bas.</p>
                                        </div>
                                    )}
                                        </div>
                                    )}

                                    {/* ── Command Center ─── */}
                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="bg-white/3 border border-border-subtle rounded-xl p-3 text-center">
                                            <div className="text-lg font-bold text-text-primary">{queueStats?.total ?? '—'}</div>
                                            <div className="text-[10px] text-text-tertiary uppercase tracking-wider mt-0.5">TOTAL</div>
                                        </div>
                                        <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-3 text-center">
                                            <div className="text-lg font-bold text-emerald-400">{queueStats?.indexed ?? '—'}</div>
                                            <div className="text-[10px] text-emerald-400/60 uppercase tracking-wider mt-0.5">INDEXED</div>
                                        </div>
                                        <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 text-center">
                                            <div className="text-lg font-bold text-blue-400">{queueStats?.inQueue ?? '—'}</div>
                                            <div className="text-[10px] text-blue-400/60 uppercase tracking-wider mt-0.5">IN QUEUE</div>
                                        </div>
                                        <div className="bg-red-500/8 border border-red-500/20 rounded-xl p-3 text-center">
                                            <div className="text-lg font-bold text-red-400">{queueStats?.failed ?? '—'}</div>
                                            <div className="text-[10px] text-red-400/60 uppercase tracking-wider mt-0.5">FAILED</div>
                                        </div>
                                    </div>
                                    {queueStats && queueStats.total > 0 && (() => {
                                        const pct = Math.round(queueStats.completed / queueStats.total * 100);
                                        const donePct = Math.round((queueStats.completed + queueStats.failed) / queueStats.total * 100);
                                        return (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="text-text-secondary">İşlem İlerlemesi</span>
                                                    <span className="text-text-tertiary font-mono"><span className="text-emerald-400 font-bold">{queueStats.completed}</span>/{queueStats.total} <span className="text-text-primary font-bold">%{pct}</span></span>
                                                </div>
                                                <div className="h-2.5 bg-white/5 rounded-full overflow-hidden relative">
                                                    <div className="absolute inset-y-0 left-0 bg-red-500/40 rounded-full transition-all duration-700" style={{ width: `${donePct}%` }} />
                                                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: 'linear-gradient(to right, #7c3aed, #2563eb)' }} />
                                                </div>
                                                {pollError && <p className="text-[10px] text-amber-400">⚠ Sunucu bağlantısı kesildi</p>}
                                            </div>
                                        );
                                    })()}
                                    {/* Job list */}
                                    <div className="border border-border-subtle rounded-xl overflow-hidden">
                                        <div className="flex items-center border-b border-border-subtle bg-white/2">
                                            <div className="flex flex-1">
                                                {([
                                                    { id: 'active' as const, label: '⏳ Sırada', count: jobs.filter(j => j.state === 'active' || j.state === 'waiting' || j.state === 'delayed').length, color: 'text-blue-400' },
                                                    { id: 'completed' as const, label: '✅ Tamamlanan', count: jobs.filter(j => j.state === 'completed').length, color: 'text-emerald-400' },
                                                    { id: 'failed' as const, label: '❌ Hatalı', count: jobs.filter(j => j.state === 'failed').length, color: 'text-red-400' },
                                                ] as const).map(tab => (
                                                    <button key={tab.id} onClick={() => setJobListTab(tab.id)}
                                                        className={`flex-1 py-2 text-[11px] font-medium flex items-center justify-center gap-1 border-b-2 transition-colors ${jobListTab === tab.id ? 'border-accent text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}`}>
                                                        {tab.label} {tab.count > 0 && <span className={`font-bold ${tab.color}`}>{tab.count}</span>}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-1 px-2 border-l border-border-subtle">
                                                {jobListTab === 'failed' && jobs.filter(j => j.state === 'failed').length > 0 && (
                                                    <>
                                                        <button onClick={async () => { try { const r = await apiKnowledge.retryFailed(); toast.success(`${r.retried} iş yeniden kuyruğa alındı`); await loadJobs(); } catch { toast.error('Başarısız'); } }}
                                                            className="p-1.5 rounded text-amber-400 hover:bg-amber-500/10 transition-colors" title="Yeniden dene"><RotateCcw className="w-3 h-3" /></button>
                                                        <button onClick={async () => { try { const r = await apiKnowledge.queueCleanup({ cleanFailed: true }); toast.success(`${r.failedCleaned} temizlendi`); await loadJobs(); } catch { toast.error('Başarısız'); } }}
                                                            className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors" title="Temizle"><Trash2 className="w-3 h-3" /></button>
                                                    </>
                                                )}
                                                <button onClick={loadJobs} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-white/5 transition-colors"><RefreshCw className="w-3 h-3" /></button>
                                            </div>
                                        </div>
                                        {(() => {
                                            const tabJobs = jobListTab === 'active' ? jobs.filter(j => j.state === 'active' || j.state === 'waiting' || j.state === 'delayed') : jobListTab === 'completed' ? jobs.filter(j => j.state === 'completed') : jobs.filter(j => j.state === 'failed');
                                            if (loadingJobs) return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>;
                                            if (tabJobs.length === 0) return <div className="flex flex-col items-center py-6 text-text-tertiary gap-1"><Brain className="w-6 h-6 opacity-15" /><p className="text-xs">{jobListTab === 'active' ? 'Kuyrukta iş yok' : jobListTab === 'completed' ? 'Tamamlanan yok' : 'Hatalı yok'}</p></div>;
                                            return (
                                                <div className="divide-y divide-border-subtle max-h-60 overflow-y-auto">
                                                    {tabJobs.map(job => {
                                                        const thumb = getYtThumbnail(job.url);
                                                        const srcIcon = job.sourceType === 'SOCIAL_MEDIA' ? '🌐' : job.sourceType === 'RADAR_TREND' ? '📡' : job.sourceType === 'FILE' ? '📄' : null;
                                                        return (
                                                            <div key={job.jobId} className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${jobListTab === 'completed' ? 'bg-emerald-500/4' : jobListTab === 'failed' ? 'bg-red-500/4' : 'hover:bg-white/3'}`}>
                                                                <div className="w-10 h-[24px] rounded overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center text-[10px]">
                                                                    {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="" loading="lazy" /> : (srcIcon || <Youtube className="w-3 h-3 text-text-tertiary opacity-40" />)}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs text-text-primary truncate">{job.title !== job.url ? job.title : job.url.slice(0, 50)}</p>
                                                                    {jobListTab === 'active' && <JobStateChip state={job.state} progress={job.progress} />}
                                                                    {jobListTab === 'failed' && job.failedReason && <p className="text-[10px] text-red-400 truncate">{job.failedReason}</p>}
                                                                </div>
                                                                <span className="text-[10px] text-text-tertiary whitespace-nowrap">{fmtTimestamp(job.timestamp)}</span>
                                                                {jobListTab === 'failed' && <button onClick={() => handleRetryJob(job.jobId)} className="p-1 rounded text-amber-400 hover:bg-amber-500/10"><RotateCcw className="w-3 h-3" /></button>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    {/* Console */}
                                    <div className="border border-border-subtle rounded-xl overflow-hidden">
                                        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-white/2">
                                            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider"><Terminal className="w-3 h-3" /> Console</span>
                                        </div>
                                        <div ref={consoleRef} className="font-mono text-[10px] p-2 space-y-0.5 max-h-28 overflow-y-auto bg-[#08090a]">
                                            {consoleLogs.length === 0 ? <p className="text-white/20 text-center py-2">Log bekleniyor...</p> : consoleLogs.map((log, i) => (
                                                <div key={i} className={`flex gap-2 leading-relaxed ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-emerald-300/80'}`}>
                                                    <span className="text-white/25 flex-shrink-0 tabular-nums">{new Date(log.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                    <span className="break-all">{log.msg}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── Sosyal Medya ─────────────────────────── */}
                            {inputTab === 'social' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1 flex items-center gap-2"><Share2 className="w-4 h-4 text-accent" /> Sosyal Medya İstihbaratı</h2>
                                        <p className="text-sm text-text-secondary">Twitter veya Instagram sayfalarından bilgi çek ve Brain&apos;e kaydet.</p>
                                    </div>
                                    <div className="flex items-center gap-1 p-1 bg-white/3 border border-border-subtle rounded-xl w-fit">
                                        <button onClick={() => setSocialPlatform('twitter')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${socialPlatform === 'twitter' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><Twitter className="w-3 h-3" /> Twitter / X</span>
                                        </button>
                                        <button onClick={() => setSocialPlatform('instagram')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${socialPlatform === 'instagram' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><Instagram className="w-3 h-3" /> Instagram</span>
                                        </button>
                                    </div>
                                    <textarea value={socialInput} onChange={e => setSocialInput(e.target.value)}
                                        placeholder={socialPlatform === 'twitter' ? "https://x.com/kullanici/status/123\nhttps://twitter.com/..." : "https://www.instagram.com/p/abc123/"}
                                        rows={4} className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none transition-colors" />
                                    <button onClick={() => setShowCookies(!showCookies)} className="text-xs text-text-tertiary hover:text-text-secondary flex items-center gap-1.5"><Shield className="w-3 h-3" /> {showCookies ? 'Cookies gizle' : 'Cookies ekle (opsiyonel)'}</button>
                                    {showCookies && <textarea value={socialCookies} onChange={e => setSocialCookies(e.target.value)} placeholder="cookie1=val; cookie2=val" rows={2} className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-xs text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none transition-colors" />}
                                    <button onClick={handleSocialSubmit} disabled={socialSubmitting || extractUrls(socialInput).length === 0}
                                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity">
                                        {socialSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> İşleniyor...</> : <><Share2 className="w-4 h-4" /> {extractUrls(socialInput).length > 0 ? `${extractUrls(socialInput).length} sayfa gönder` : 'URL girin'}</>}
                                    </button>
                                </div>
                            )}

                            {/* ── Dosya Yükleme ───────────────────────── */}
                            {inputTab === 'file' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1 flex items-center gap-2"><FileUp className="w-4 h-4 text-accent" /> PDF & Belge Yükleme</h2>
                                        <p className="text-sm text-text-secondary">Birden fazla dosya seç veya sürükle — AI otomatik analiz eder.</p>
                                    </div>

                                    <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.mp4,.mov,.avi,.mp3,.wav" onChange={handleFileSelect} className="hidden" />

                                    {/* Drop zone */}
                                    <div
                                        onClick={() => !fileUploading && fileInputRef.current?.click()}
                                        onDragOver={e => { e.preventDefault(); setFileDragOver(true); }}
                                        onDragLeave={() => setFileDragOver(false)}
                                        onDrop={handleFileDrop}
                                        className={`w-full py-10 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 group cursor-pointer select-none
                                            ${fileUploading ? 'opacity-50 cursor-not-allowed' : ''}
                                            ${fileDragOver ? 'border-accent bg-accent/8' : 'border-border-subtle hover:border-accent/40 bg-white/2 hover:bg-accent/5'}`}
                                    >
                                        {uploadProgress
                                            ? <>
                                                <Loader2 className="w-8 h-8 text-accent animate-spin" />
                                                <span className="text-sm font-semibold text-text-primary">{uploadProgress.done}/{uploadProgress.total} yükleniyor...</span>
                                                <div className="w-40 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                    <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }} />
                                                </div>
                                              </>
                                            : <>
                                                <Upload className="w-8 h-8 text-text-tertiary group-hover:text-accent transition-colors" />
                                                <div className="text-center">
                                                    <span className="text-sm font-semibold text-text-primary">Dosyaları seç veya sürükle</span>
                                                    <p className="text-xs text-text-tertiary mt-1">PDF, TXT, MP4, MOV, MP3 — Çoklu seçim desteklenir</p>
                                                </div>
                                              </>
                                        }
                                    </div>

                                    {/* Staged file list */}
                                    {stagedFiles.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">{stagedFiles.length} dosya seçildi</span>
                                                <button onClick={() => setStagedFiles([])} disabled={fileUploading} className="text-xs text-text-tertiary hover:text-red-400 transition-colors">Temizle</button>
                                            </div>
                                            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                                {stagedFiles.map((f, i) => (
                                                    <div key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/3 border border-border-subtle group/file">
                                                        <FileText className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                                                        <span className="flex-1 text-xs text-text-primary truncate">{f.name}</span>
                                                        <span className="text-xs text-text-tertiary flex-shrink-0">{fmtFileSize(f.size)}</span>
                                                        <button
                                                            onClick={() => setStagedFiles(prev => prev.filter((_, j) => j !== i))}
                                                            disabled={fileUploading}
                                                            className="opacity-0 group-hover/file:opacity-100 p-0.5 rounded text-text-tertiary hover:text-red-400 transition-all"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                onClick={handleBulkUpload}
                                                disabled={fileUploading}
                                                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity"
                                            >
                                                {fileUploading
                                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor...</>
                                                    : <><Upload className="w-4 h-4" /> {stagedFiles.length} dosyayı yükle</>
                                                }
                                            </button>
                                        </div>
                                    )}

                                    <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-500/8 border border-blue-500/20">
                                        <Brain className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-text-secondary leading-relaxed">PDF metin çıkarılır, video/ses Whisper ile transkript edilir, tümü Brain&apos;e kaydedilir.</p>
                                    </div>
                                </div>
                            )}

                            {/* ── Trend Radar ──────────────────────────── */}
                            {inputTab === 'radar' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1 flex items-center gap-2"><Compass className="w-4 h-4 text-accent" /> Trend Radar</h2>
                                        <p className="text-sm text-text-secondary">Pinterest veya TikTok trend linklerini yapıştır — AI strateji olarak Brain&apos;e kaydeder.</p>
                                    </div>
                                    <div className="flex items-center gap-1 p-1 bg-white/3 border border-border-subtle rounded-xl w-fit">
                                        <button onClick={() => setRadarPlatform('pinterest')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${radarPlatform === 'pinterest' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><Globe className="w-3 h-3" /> Pinterest</span>
                                        </button>
                                        <button onClick={() => setRadarPlatform('tiktok')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${radarPlatform === 'tiktok' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}>
                                            <span className="flex items-center gap-1.5"><Video className="w-3 h-3" /> TikTok</span>
                                        </button>
                                    </div>
                                    <textarea value={radarInput} onChange={e => setRadarInput(e.target.value)}
                                        placeholder={radarPlatform === 'pinterest' ? "https://www.pinterest.com/pin/123\nhttps://www.pinterest.com/search/..." : "https://www.tiktok.com/@user/video/123"}
                                        rows={4} className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-accent resize-none transition-colors" />
                                    <button onClick={handleRadarSubmit} disabled={radarSubmitting || extractUrls(radarInput).length === 0}
                                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity">
                                        {radarSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Taranıyor...</> : <><Compass className="w-4 h-4" /> {extractUrls(radarInput).length > 0 ? `${extractUrls(radarInput).length} trend linki gönder` : 'URL girin'}</>}
                                    </button>
                                    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                                        <Compass className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-text-secondary leading-relaxed">Trend sayfaları AI ile analiz edilir ve STRATEGY olarak Brain&apos;e kaydedilir.</p>
                                    </div>
                                </div>
                            )}
                            {/* ── Fabrika Kontrol ──────────────────────── */}
                            {inputTab === 'factory' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1 flex items-center gap-2">
                                            <Zap className="w-4 h-4 text-amber-400" /> Fabrika Kontrol
                                        </h2>
                                        <p className="text-sm text-text-secondary">Brain&apos;deki stratejik bir kuralı seç → Claude {factoryCount} farklı tasarım varyasyonu üretir ve FAL.ai kuyruğuna atar.</p>
                                    </div>

                                    {/* Rule list */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Stratejik Kurallar</label>
                                            <button onClick={loadFactoryRules} disabled={factoryLoading} className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-white/5 transition-colors">
                                                <RefreshCw className={`w-3 h-3 ${factoryLoading ? 'animate-spin' : ''}`} />
                                            </button>
                                        </div>
                                        {factoryLoading ? (
                                            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>
                                        ) : factoryRules.length === 0 ? (
                                            <div className="flex flex-col items-center py-8 gap-3 text-center">
                                                <Shield className="w-8 h-8 text-text-tertiary opacity-20" />
                                                <p className="text-sm text-text-tertiary">Henüz stratejik kural yok.</p>
                                                <p className="text-xs text-text-tertiary">Kural sekmesinden STRATEGIC_RULE tipinde kural ekle.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                                {factoryRules.map(rule => {
                                                    const cat = rule.category || 'STRATEGY';
                                                    const meta = CAT_META[cat] || DEFAULT_CAT;
                                                    const isSelected = selectedRuleId === rule.id;
                                                    return (
                                                        <button
                                                            key={rule.id}
                                                            onClick={() => setSelectedRuleId(isSelected ? null : rule.id)}
                                                            className={`w-full text-left p-3 rounded-xl border transition-all ${
                                                                isSelected
                                                                    ? 'bg-amber-500/10 border-amber-500/30'
                                                                    : 'bg-bg-base border-border-subtle hover:border-border-default'
                                                            }`}
                                                        >
                                                            <div className="flex items-start gap-2.5">
                                                                <Shield className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isSelected ? 'text-amber-400' : 'text-text-tertiary'}`} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className={`text-xs font-semibold ${isSelected ? 'text-amber-300' : 'text-text-primary'}`}>{rule.title}</span>
                                                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${meta.bg} ${meta.color} border ${meta.border}`}>{meta.label}</span>
                                                                    </div>
                                                                    <p className="text-[11px] text-text-tertiary line-clamp-2 leading-relaxed">{rule.content.slice(0, 120)}{rule.content.length > 120 ? '…' : ''}</p>
                                                                </div>
                                                                {isSelected && <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* Config panel — shown when rule is selected */}
                                    {selectedRuleId && (
                                        <div className="space-y-4 p-4 rounded-xl bg-white/3 border border-border-subtle">
                                            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Üretim Ayarları</p>

                                            {/* Engine */}
                                            <div>
                                                <label className="block text-xs text-text-tertiary mb-1.5">Model</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {[
                                                        { value: 'fal-ai/flux/schnell', label: 'Flux Schnell', desc: 'Hızlı & ucuz' },
                                                        { value: 'fal-ai/flux/dev',     label: 'Flux Dev',     desc: 'Yüksek kalite' },
                                                        { value: 'fal-ai/ideogram/v2',  label: 'Ideogram v2',  desc: 'Metin odaklı' },
                                                        { value: 'fal-ai/recraft-v3',   label: 'Recraft v3',   desc: 'Vektör temiz' },
                                                    ].map(e => (
                                                        <button key={e.value} onClick={() => setFactoryEngine(e.value)}
                                                            className={`p-2.5 rounded-lg text-left border transition-all ${factoryEngine === e.value ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-bg-base border-border-subtle text-text-secondary hover:border-border-default'}`}>
                                                            <p className="text-xs font-semibold">{e.label}</p>
                                                            <p className="text-[10px] text-text-tertiary">{e.desc}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Style */}
                                            <div>
                                                <label className="block text-xs text-text-tertiary mb-1.5">Stil</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {['minimalist', 'retro', 'bold', 'funny', 'motivational'].map(s => (
                                                        <button key={s} onClick={() => setFactoryStyle(s)}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${factoryStyle === s ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-bg-base border-border-subtle text-text-secondary hover:border-border-default'}`}>
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Count */}
                                            <div>
                                                <label className="block text-xs text-text-tertiary mb-1.5">Varyasyon Sayısı</label>
                                                <div className="flex gap-2">
                                                    {[5, 10, 15, 20].map(n => (
                                                        <button key={n} onClick={() => setFactoryCount(n)}
                                                            className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${factoryCount === n ? 'bg-accent/10 border-accent/30 text-accent' : 'bg-bg-base border-border-subtle text-text-secondary hover:border-border-default'}`}>
                                                            {n}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Cost preview */}
                                            <div className="flex items-center justify-between text-xs text-text-tertiary">
                                                <span>Tahmini maliyet:</span>
                                                <span className="font-mono font-semibold text-amber-400">${(factoryCount * 0.036).toFixed(3)}</span>
                                            </div>

                                            {/* CTA */}
                                            <button onClick={handleStartBatch} disabled={factoryStarting}
                                                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity">
                                                {factoryStarting
                                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Kuyruğa alınıyor...</>
                                                    : <><Zap className="w-4 h-4" /> {factoryCount} Tasarım Üret</>
                                                }
                                            </button>
                                        </div>
                                    )}

                                    {/* Batch status */}
                                    {batchStatus && (
                                        <div className="space-y-4">
                                            {/* Progress bar */}
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-text-secondary font-medium">{batchStatus.niche || 'Batch'}</span>
                                                    <span className="font-mono text-text-tertiary">
                                                        <span className="text-emerald-400 font-bold">{batchStatus.completed}</span>
                                                        /{batchStatus.total} — %{batchStatus.progress}
                                                    </span>
                                                </div>
                                                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-700"
                                                        style={{ width: `${batchStatus.progress}%`, background: 'linear-gradient(to right, #d97706, #ea580c)' }}
                                                    />
                                                </div>
                                                <div className="flex gap-3 text-[11px]">
                                                    <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{batchStatus.completed} tamamlandı</span>
                                                    {batchStatus.failed > 0 && <span className="text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3" />{batchStatus.failed} hata</span>}
                                                    {batchStatus.pending > 0 && <span className="text-blue-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{batchStatus.pending} bekliyor</span>}
                                                    {batchStatus.totalCost > 0 && <span className="text-text-tertiary ml-auto font-mono">${batchStatus.totalCost.toFixed(3)}</span>}
                                                </div>
                                            </div>

                                            {/* Action Cards grid */}
                                            {batchStatus.images.length > 0 && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    {batchStatus.images.map(img => (
                                                        <div key={img.id} className={`rounded-xl border overflow-hidden transition-all ${
                                                            img.status === 'COMPLETED' ? 'border-emerald-500/25 bg-emerald-500/5' :
                                                            img.status === 'FAILED'    ? 'border-red-500/25 bg-red-500/5' :
                                                            'border-border-subtle bg-bg-base'
                                                        }`}>
                                                            {/* Thumbnail */}
                                                            <div className="aspect-square bg-white/3 flex items-center justify-center">
                                                                {img.imageUrl ? (
                                                                    <img src={img.imageUrl} alt={img.slogan} className="w-full h-full object-cover" />
                                                                ) : img.status === 'FAILED' ? (
                                                                    <XCircle className="w-6 h-6 text-red-400 opacity-40" />
                                                                ) : (
                                                                    <Loader2 className="w-5 h-5 text-text-tertiary animate-spin opacity-40" />
                                                                )}
                                                            </div>
                                                            {/* Info */}
                                                            <div className="p-2">
                                                                <p className="text-[11px] font-semibold text-text-primary line-clamp-2 leading-tight">{img.slogan || '—'}</p>
                                                                <div className="flex items-center justify-between mt-1.5">
                                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                                                        img.status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-400' :
                                                                        img.status === 'FAILED'    ? 'bg-red-500/15 text-red-400' :
                                                                        'bg-blue-500/15 text-blue-400'
                                                                    }`}>{img.status}</span>
                                                                    {img.imageUrl && (
                                                                        <a href={img.imageUrl} target="_blank" rel="noreferrer"
                                                                            className="text-[10px] text-accent hover:underline flex items-center gap-0.5">
                                                                            <ArrowUpCircle className="w-3 h-3" /> Aç
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Metin Ekle ───────────────────────────── */}
                            {inputTab === 'text' && (
                                <div className="space-y-4">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1">Metin Bilgisi Ekle</h2>
                                        <p className="text-sm text-text-secondary">Etsy güncellemeleri, strateji notları veya makale içeriği yapıştır.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">Başlık *</label>
                                        <input type="text" value={textTitle} onChange={e => setTextTitle(e.target.value)}
                                            placeholder="ör. Etsy Satıcı Kılavuzu 2026"
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">Kaynak</label>
                                        <input type="text" value={textSource} onChange={e => setTextSource(e.target.value)}
                                            placeholder="ör. Etsy Seller Handbook, blog, YouTube"
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">İçerik *</label>
                                        <textarea value={textContent} onChange={e => setTextContent(e.target.value)}
                                            placeholder="Notlarını buraya yapıştır..." rows={10}
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-none font-mono" />
                                        <p className="text-[11px] text-text-tertiary mt-1 text-right">{textContent.length.toLocaleString()} karakter</p>
                                    </div>
                                    <button onClick={handleAddText} disabled={addingText || !textTitle.trim() || !textContent.trim()}
                                        className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity">
                                        {addingText ? <><Loader2 className="w-4 h-4 animate-spin" /> İşleniyor...</> : <><Zap className="w-4 h-4" /> Bilgi Tabanına Ekle</>}
                                    </button>
                                </div>
                            )}

                            {/* ── Bilgi Testi ──────────────────────────── */}
                            {inputTab === 'test' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1">Bilgi Tabanını Test Et</h2>
                                        <p className="text-sm text-text-secondary">AI&apos;ın yüklediğin içeriği doğru anlayıp anlamadığını doğrula.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Hızlı Sorular</label>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                'Bu ay hangi nişlere odaklanmalıyım?',
                                                '2026 için en iyi başlık formatı?',
                                                'Kaçınılması gereken SEO hataları?',
                                                'Fiyatlandırmada dikkat etmem gerekenler?',
                                                'Vatanseverlik ürünleri için en iyi taglar?',
                                            ].map(q => (
                                                <button key={q} onClick={() => setTestQuestion(q)}
                                                    className="text-xs px-2.5 py-1.5 bg-bg-base border border-border-subtle hover:border-accent/40 text-text-secondary hover:text-text-primary rounded-lg transition-colors">
                                                    {q}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <input type="text" value={testQuestion} onChange={e => setTestQuestion(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleTest()}
                                            placeholder="Etsy, POD veya işinle ilgili herhangi bir şey sor..."
                                            className="flex-1 bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors" />
                                        <button onClick={handleTest} disabled={testing || !testQuestion.trim()}
                                            className="px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity flex-shrink-0">
                                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                                            Sor
                                        </button>
                                    </div>
                                    {testAnswer && (
                                        <div className="bg-bg-base border border-border-subtle rounded-xl p-5 space-y-3">
                                            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">AI Yanıtı</p>
                                            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{testAnswer}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Brainstorm ───────────────────────────── */}
                            {inputTab === 'brainstorm' && (
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1 flex items-center gap-2">
                                            <Lightbulb className="w-4 h-4 text-amber-400" /> Brainstorm
                                        </h2>
                                        <p className="text-sm text-text-secondary">AI kurallarına göre tasarım fikirleri üret veya niche bazlı Ideas Engine'i kullan.</p>
                                    </div>

                                    {/* ── Mode Switcher: AI Brainstorm | Ideas Engine ── */}
                                    <div className="flex items-center gap-1 p-1 bg-white/3 border border-border-subtle rounded-xl w-fit">
                                        <button
                                            onClick={() => setBrainstormMode('ai')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${brainstormMode === 'ai' ? 'bg-amber-500 text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}
                                        >
                                            <Brain className="w-3 h-3" /> AI Brainstorm
                                        </button>
                                        <button
                                            onClick={() => setBrainstormMode('ideas')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${brainstormMode === 'ideas' ? 'bg-accent text-white shadow' : 'text-text-tertiary hover:text-text-secondary'}`}
                                        >
                                            <Lightbulb className="w-3 h-3" /> Ideas Engine
                                        </button>
                                    </div>

                                    {/* ── Ideas Engine Mode ── */}
                                    {brainstormMode === 'ideas' ? (
                                        <div className="w-full">
                                            <IdeasClient />
                                        </div>
                                    ) : (
                                    <>

                                    <div className="flex border-b border-border-subtle mb-4">
                                        <button onClick={() => setBrainstormTab('new')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${brainstormTab === 'new' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                                            Yeni Fikirler
                                        </button>
                                        <button onClick={() => setBrainstormTab('pool')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${brainstormTab === 'pool' ? 'border-accent text-accent' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                                            Idea Pool (Geçmiş)
                                        </button>
                                    </div>

                                    {brainstormTab === 'new' ? (
                                        <>

                                    {/* ── Negative Constraints ── */}
                                    {negativeConstraints.length > 0 && (
                                        <div className="p-3 rounded-xl bg-red-500/8 border border-red-500/20 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                                                    <XCircle className="w-3 h-3" /> Negatif Kısıtlar ({negativeConstraints.length})
                                                </p>
                                                <button onClick={() => setNegativeConstraints([])} className="text-[10px] text-text-tertiary hover:text-red-400 transition-colors">Temizle</button>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {negativeConstraints.map((nc, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/25 text-red-300 text-[10px] font-medium">
                                                        {nc}
                                                        <button onClick={() => setNegativeConstraints(p => p.filter((_, j) => j !== i))} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                                                    </span>
                                                ))}
                                            </div>
                                            <p className="text-[10px] text-text-tertiary">Bu niche/ürünler düşük performans gösterdi — AI brainstorm&apos;dan hariç tutulacak.</p>
                                        </div>
                                    )}

                                    {/* ── Stil Preset Seçici ── */}
                                    {stylePresets.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                Stil Preset <span className="font-normal normal-case text-text-tertiary">(isteğe bağlı)</span>
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {stylePresets.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            setActiveProfileId(null);
                                                            setActiveStylePreset(prev => prev === p.id ? null : p.id);
                                                        }}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                                            activeStylePreset === p.id
                                                                ? 'bg-accent/15 border-accent text-accent'
                                                                : 'bg-bg-base border-border-subtle text-text-secondary hover:border-accent/40'
                                                        }`}
                                                    >
                                                        <span>{p.emoji}</span>
                                                        {p.label}
                                                        {/* Renk paleti önizlemesi */}
                                                        <span className="flex gap-0.5 ml-1">
                                                            {p.colorPalette.slice(0, 3).map(c => (
                                                                <span key={c.hex} className="w-2.5 h-2.5 rounded-full border border-white/10 flex-shrink-0" style={{ background: c.hex }} />
                                                            ))}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                            {activeStylePreset && (() => {
                                                const p = stylePresets.find(x => x.id === activeStylePreset);
                                                return p ? (
                                                    <p className="mt-1.5 text-[11px] text-text-tertiary leading-relaxed">
                                                        <span className="text-accent font-medium">{p.label}:</span> {p.styleGuide}
                                                    </p>
                                                ) : null;
                                            })()}
                                        </div>
                                    )}

                                    {/* ── Kayıtlı Stiller (Kilitlenmiş DNA Profilleri) ── */}
                                    {savedProfiles.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                                Kayıtlı Stiller <span className="font-normal normal-case text-text-tertiary">(Kilitlenmiş DNA profillerim)</span>
                                            </label>
                                            <div className="flex flex-wrap gap-2">
                                                {savedProfiles.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => {
                                                            setActiveStylePreset(null);
                                                            setActiveProfileId(prev => prev === p.id ? null : p.id);
                                                        }}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                                                            activeProfileId === p.id
                                                                ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
                                                                : 'bg-bg-base border-border-subtle text-text-secondary hover:border-emerald-500/40'
                                                        }`}
                                                    >
                                                        <span>{p.emoji}</span>
                                                        {p.name}
                                                        {p.colorPalette && (
                                                            <span className="flex gap-0.5 ml-1">
                                                                {p.colorPalette.slice(0, 3).map((c: { hex: string }) => (
                                                                    <span key={c.hex} className="w-2.5 h-2.5 rounded-full border border-white/10 flex-shrink-0" style={{ background: c.hex }} />
                                                                ))}
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                            {activeProfileId && (() => {
                                                const p = savedProfiles.find(x => x.id === activeProfileId);
                                                return p ? (
                                                    <p className="mt-1.5 text-[11px] text-text-tertiary leading-relaxed">
                                                        <span className="text-emerald-400 font-medium">{p.emoji} {p.name}:</span>{' '}
                                                        {p.promptPrefix ? `${p.promptPrefix.slice(0, 80)}…` : p.baseModel}
                                                    </p>
                                                ) : null;
                                            })()}
                                        </div>
                                    )}

                                    {/* ── Kilitli DNA Banner ── */}
                                    {lockedDNA && (
                                        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/25">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Star className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-semibold text-emerald-400 truncate">DNA Kilitli: {lockedDNA.sourceTitle.slice(0, 35)}</p>
                                                    <p className="text-[10px] text-text-tertiary">
                                                        {FINAL_RENDER_MODELS[lockedDNA.modelKey]?.label}
                                                        {lockedDNA.stylePresetId && ` · ${stylePresets.find(p => p.id === lockedDNA.stylePresetId)?.label || lockedDNA.stylePresetId}`}
                                                        {lockedDNA.seed && ` · seed:${lockedDNA.seed}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setLockedDNA(null)}
                                                className="flex-shrink-0 text-[10px] text-text-tertiary hover:text-red-400 transition-colors px-2 py-1 rounded-lg border border-border-subtle"
                                            >
                                                Kilidi Aç
                                            </button>
                                        </div>
                                    )}

                                    {/* Focus Niche */}
                                    <div>
                                        <label className="block text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-1.5">Focus Niche <span className="font-normal normal-case">(isteğe bağlı)</span></label>
                                        <input
                                            type="text"
                                            value={brainstormFocusNiche}
                                            onChange={e => setBrainstormFocusNiche(e.target.value)}
                                            placeholder="ör. Patriotic T-Shirts, Cat Mom Mugs, Funny Dad Gifts…"
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                                        />
                                    </div>

                                    {/* Count */}
                                    <div>
                                        <label className="block text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2">
                                            Fikir Sayısı — <span className="text-accent">{brainstormCount}</span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            {[3, 5, 8, 10].map(n => (
                                                <button key={n} onClick={() => setBrainstormCount(n)}
                                                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all border ${
                                                        brainstormCount === n
                                                            ? 'bg-accent text-white border-accent'
                                                            : 'bg-bg-base border-border-subtle text-text-secondary hover:border-accent/40'
                                                    }`}>
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleBrainstorm}
                                        disabled={brainstormRunning}
                                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold disabled:opacity-40 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity"
                                    >
                                        {brainstormRunning
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Fikirler üretiliyor...</>
                                            : <><Lightbulb className="w-4 h-4" /> {brainstormCount} Fikir Üret</>
                                        }
                                    </button>

                                    {/* Results */}
                                    {brainstormResult && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
                                                    {brainstormResult.ideas.length} Fikir — {brainstormResult.rulesUsed}/{brainstormResult.totalRules} kural kullanıldı
                                                </p>
                                                <button onClick={() => setBrainstormResult(null)} className="text-xs text-text-tertiary hover:text-text-primary transition-colors">Temizle</button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 w-full">
                                            {brainstormResult.ideas.map((idea: BrainstormIdea, i: number) => {
                                                const cs = ideaStates.get(i) ?? { status: 'idle' as IdeaStatus, showModelPicker: false };
                                                const borderCls =
                                                    cs.status === 'drafting'   ? 'border-amber-500/40 bg-amber-500/5' :
                                                    cs.status === 'draft_ready' ? 'border-blue-500/40 bg-blue-500/5' :
                                                    cs.status === 'finalizing'  ? 'border-purple-500/40 bg-purple-500/5' :
                                                    cs.status === 'completed'   ? 'border-emerald-500/40 bg-emerald-500/5' :
                                                    'border-border-subtle hover:border-accent/30';
                                                return (
                                                <div key={i} className={`p-2 rounded-2xl bg-bg-base border flex flex-col space-y-2 transition-colors h-full w-full ${borderCls}`}>
                                                    {/* ── Header ── */}
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-semibold text-text-primary">{idea.title}</p>
                                                            <p className="text-xs text-accent mt-0.5">{idea.niche} · {idea.productType}</p>
                                                        </div>
                                                        <span className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                                                            idea.estimatedScore >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                                                            idea.estimatedScore >= 60 ? 'bg-blue-500/15 text-blue-400' :
                                                            'bg-white/5 text-text-tertiary'
                                                        }`}>{idea.estimatedScore}/100</span>
                                                    </div>
                                                    <p className="text-xs text-text-secondary leading-relaxed">{idea.designBrief}</p>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        {idea.keyTags.slice(0, 5).map((tag: string, j: number) => (
                                                            <span key={j} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">#{tag}</span>
                                                        ))}
                                                    </div>
                                                    <p className="text-[11px] text-text-tertiary leading-relaxed">{idea.reasoning}</p>

                                                    {/* ── IDLE: Taslak başlat ── */}
                                                    {cs.status === 'idle' && (
                                                        <div className="mt-auto pt-2">
                                                            <button onClick={() => handleStartDraft(idea, i)}
                                                                className="w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all">
                                                                <Zap className="w-3.5 h-3.5" /> 2 Taslak Üret (Hızlı)
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* ── DRAFTING: Yükleniyor ── */}
                                                    {cs.status === 'drafting' && (
                                                        <div className="flex items-center justify-center gap-2 py-3 text-amber-400 text-xs mt-auto">
                                                            <Loader2 className="w-4 h-4 animate-spin" /> Flux Schnell ile taslaklar üretiliyor…
                                                        </div>
                                                    )}

                                                    {/* ── DRAFT_READY: Taslak görseller ── */}
                                                    {cs.status === 'draft_ready' && (
                                                        <div className="space-y-3 mt-auto">
                                                            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Taslaklar — birini seç:</p>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {(cs.draftImages ?? []).map(img => (
                                                                    <div key={img.id} className="relative group rounded-xl overflow-hidden border border-border-subtle">
                                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                        <img src={img.url} alt="taslak" className="w-full aspect-square object-cover" />
                                                                        <button
                                                                            onClick={() => setIdeaState(i, { showModelPicker: true, selectedDraftId: img.id })}
                                                                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity"
                                                                        >
                                                                            <Sparkles className="w-5 h-5 text-white" />
                                                                            <span className="text-white text-[11px] font-semibold">Final Render</span>
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            {/* Model picker */}
                                                            {cs.showModelPicker && (
                                                                <div className="p-3 rounded-xl bg-bg-base border border-accent/30 space-y-2">
                                                                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Model Seç:</p>
                                                                    {(Object.entries(FINAL_RENDER_MODELS) as [FinalRenderModelKey, typeof FINAL_RENDER_MODELS[FinalRenderModelKey]][]).map(([key, m]) => (
                                                                        <button key={key}
                                                                            onClick={() => handleFinalRender(idea, i, key)}
                                                                            className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/4 hover:bg-accent/10 border border-border-subtle hover:border-accent/30 transition-all">
                                                                            <div className="text-left">
                                                                                <p className={`text-xs font-semibold ${m.color}`}>{m.label}</p>
                                                                                <p className="text-[10px] text-text-tertiary">{m.desc}</p>
                                                                            </div>
                                                                            <span className="text-[10px] text-text-tertiary">${m.cost}</span>
                                                                        </button>
                                                                    ))}
                                                                    <button onClick={() => setIdeaState(i, { showModelPicker: false })}
                                                                        className="w-full text-center text-[10px] text-text-tertiary hover:text-text-secondary pt-1">
                                                                        İptal
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {!cs.showModelPicker && (
                                                                <button onClick={() => handleStartDraft(idea, i)}
                                                                    className="w-full text-center text-[10px] text-text-tertiary hover:text-text-secondary">
                                                                    ↺ Yeni taslaklar üret
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* ── FINALIZING ── */}
                                                    {cs.status === 'finalizing' && (
                                                        <div className="flex items-center justify-center gap-2 py-3 text-purple-400 text-xs mt-auto">
                                                            <Loader2 className="w-4 h-4 animate-spin" /> Final görsel + upscale işleniyor…
                                                        </div>
                                                    )}

                                                    {/* ── COMPLETED ── */}
                                                    {cs.status === 'completed' && cs.finalImageUrl && (
                                                        <div className="space-y-2 mt-auto">
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Final görsel hazır
                                                                    {cs.finalSeed && <span className="text-text-tertiary font-normal ml-1">seed:{cs.finalSeed.slice(0,8)}</span>}
                                                                </p>
                                                                {cs.finalModelKey && (
                                                                    <span className={`text-[10px] font-semibold ${FINAL_RENDER_MODELS[cs.finalModelKey]?.color || 'text-text-tertiary'}`}>
                                                                        {FINAL_RENDER_MODELS[cs.finalModelKey]?.label}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={cs.overlayUrl || cs.finalImageUrl}
                                                                alt="final"
                                                                className="w-full rounded-xl border border-emerald-500/30 object-cover"
                                                            />
                                                            {/* Primary actions */}
                                                            <div className="flex gap-2">
                                                                <a href={cs.overlayUrl || cs.finalImageUrl} target="_blank" rel="noreferrer"
                                                                    className="flex-1 text-center py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all">
                                                                    İndir
                                                                </a>
                                                                <button onClick={() => setIdeaState(i, { status: 'idle', draftImages: undefined, finalImageUrl: undefined, overlayUrl: null, finalSeed: null })}
                                                                    className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 border border-border-subtle text-text-tertiary hover:text-text-primary transition-all">
                                                                    Yeniden Başla
                                                                </button>
                                                            </div>
                                                            {/* Style Lock + Overlay */}
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => handleLockStyle(idea, i)}
                                                                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-all ${
                                                                        lockedDNA?.sourceTitle === idea.title
                                                                            ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400'
                                                                            : 'bg-accent/8 border border-accent/30 text-accent hover:bg-accent/15'
                                                                    }`}
                                                                >
                                                                    <Star className="w-3 h-3" />
                                                                    {lockedDNA?.sourceTitle === idea.title ? 'DNA Kilitli' : 'Stile Kilitle'}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleSloganOverlay(idea, i)}
                                                                    disabled={cs.applyingOverlay}
                                                                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition-all ${
                                                                        cs.overlayUrl
                                                                            ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                                                                            : 'bg-white/5 border border-border-subtle text-text-tertiary hover:text-text-primary'
                                                                    }`}
                                                                >
                                                                    {cs.applyingOverlay
                                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                                        : <ImageIcon className="w-3 h-3" />
                                                                    }
                                                                    {cs.overlayUrl ? 'Yazıyı Kaldır' : 'Yazı Ekle'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                );
                                            })}
                                            </div>
                                        </div>
                                    )}

                                        </>
                                    ) : (
                                        <div className="space-y-4">
                                            <p className="text-xs text-text-tertiary">Daha önce üretilen ama henüz Production'a gönderilmeyen Action Card'lar.</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 w-full">
                                                {memories.filter(m => m.type === 'ACTION_CARD' && (m.analysisResult as Record<string, unknown>)?.status === 'PENDING_REVIEW').map((m, i) => {
                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                    const idea = m.analysisResult as any;
                                                    if (!idea) return null;
                                                    return (
                                                        <div key={m.id} className="p-2 rounded-2xl bg-bg-base border border-border-subtle flex flex-col space-y-2 h-full w-full relative group hover:border-accent/30 transition-colors">
                                                            <button
                                                                onClick={() => handleRefreshIdea(m.id)}
                                                                className="absolute top-3 right-3 p-1.5 rounded-lg bg-bg-base border border-border-subtle text-text-tertiary opacity-0 group-hover:opacity-100 transition-all hover:text-accent hover:border-accent/40"
                                                                title="Güncelle (Re-score)"
                                                            >
                                                                <RefreshCw className="w-3.5 h-3.5" />
                                                            </button>
                                                            <div className="flex items-start justify-between gap-2 pr-8">
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-semibold text-text-primary">{m.title}</p>
                                                                    <p className="text-xs text-accent mt-0.5">{idea.niche} · {idea.productType}</p>
                                                                </div>
                                                                <span className={`flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                                                                    (idea.estimatedScore || 0) >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                                                                    (idea.estimatedScore || 0) >= 60 ? 'bg-blue-500/15 text-blue-400' :
                                                                    'bg-white/5 text-text-tertiary'
                                                                }`}>{(idea.estimatedScore || 0)}/100</span>
                                                            </div>
                                                            <p className="text-xs text-text-secondary leading-relaxed">{idea.designBrief}</p>
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                {(idea.keyTags || []).slice(0, 5).map((tag: string, j: number) => (
                                                                    <span key={j} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">#{tag}</span>
                                                                ))}
                                                            </div>
                                                            <p className="text-[11px] text-text-tertiary leading-relaxed mt-auto border-t border-border-subtle pt-2">{idea.reasoning}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 mt-4">
                                        <Lightbulb className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                                        <p className="text-xs text-text-secondary leading-relaxed">Brain&apos;deki STRATEGIC_RULE kayıtlarını analiz eder ve bunlara uyan özgün tasarım fikirleri üretir.</p>
                                    </div>
                                    </>
                                    )}
                                </div>
                            )}

                            {inputTab === 'learn' && (
                                <div className="space-y-4">
                                    <div>
                                        <h2 className="text-base font-semibold text-text-primary mb-1">Kural Öğret</h2>
                                        <p className="text-sm text-text-secondary leading-relaxed">
                                            Strateji, iş kuralları veya SEO taktiklerini doğrudan sisteme öğret.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-2">Kategori</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {([
                                                { value: 'STRATEGY',    label: 'Strateji',   desc: 'İş & büyüme' },
                                                { value: 'RULES',       label: 'Kurallar',   desc: 'Yasaklar & zorunluluklar' },
                                                { value: 'SEO_TACTICS', label: 'SEO Taktik', desc: 'Keyword & başlık' },
                                            ] as const).map(c => (
                                                <button key={c.value} onClick={() => setLearnCategory(c.value)}
                                                    className={`p-3 rounded-xl text-left border transition-all ${
                                                        learnCategory === c.value
                                                            ? 'bg-accent/10 border-accent/30 text-accent'
                                                            : 'bg-bg-base border-border-subtle text-text-secondary hover:border-accent/30'
                                                    }`}>
                                                    <p className="text-xs font-semibold">{c.label}</p>
                                                    <p className="text-[10px] text-text-tertiary mt-0.5">{c.desc}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">Başlık *</label>
                                        <input type="text" value={learnTitle} onChange={e => setLearnTitle(e.target.value)}
                                            placeholder="ör. Rakipten Farklılaşma Kuralları"
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">Kurallar *</label>
                                        <textarea value={learnContent} onChange={e => setLearnContent(e.target.value)}
                                            placeholder={"- Başlıkta asla marka adı kullanma\n- İlk 3 keyword en yüksek arama hacmini hedeflemeli\n- Fiyat rakipten %10-15 düşük başlamalı…"}
                                            rows={10}
                                            className="w-full bg-bg-base border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-none font-mono" />
                                        <p className="text-[11px] text-text-tertiary mt-1 text-right">{learnContent.length.toLocaleString()} karakter</p>
                                    </div>
                                    <button onClick={handleLearn} disabled={learning || !learnTitle.trim() || !learnContent.trim()}
                                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity">
                                        {learning ? <><Loader2 className="w-4 h-4 animate-spin" /> Öğreniliyor...</> : <><GraduationCap className="w-4 h-4" /> Bunu Öğren</>}
                                    </button>
                                    {learnResult && (
                                        <div className="p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/25 flex items-center gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                            <div>
                                                <p className="text-sm font-semibold text-emerald-400">{learnResult.saved} chunk kaydedildi</p>
                                                <p className="text-xs text-text-secondary mt-0.5">WPI ve Scout analizlerinde kullanılıyor.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                ) : (
                    /* ── Brain Dashboard ─────────────────────────────────── */
                    (() => {
                        const ruleCount   = memories.filter(m => m.type === 'STRATEGIC_RULE').length;
                        const actionCount = memories.filter(m => m.type === 'ACTION_CARD').length;
                        return (
                            <div className="flex-1 overflow-y-auto p-6 space-y-6">

                                {/* ── Hero header ── */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
                                            <Brain className="w-5 h-5 text-accent" /> AI Brain Hazinesi
                                        </h1>
                                        <p className="text-xs text-text-tertiary mt-0.5">
                                            {memories.length} kayıt · {ruleCount} stratejik kural · {actionCount} action card
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowAddPanel(true)}
                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                                    >
                                        <Plus className="w-4 h-4" /> Yeni Bilgi Ekle
                                    </button>
                                </div>

                                {/* ── Stats row ── */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[
                                        { label: 'Toplam Kayıt',    value: memories.length, icon: BookOpen,  color: 'text-violet-400', bg: 'bg-violet-500/10' },
                                        { label: 'Stratejik Kural', value: ruleCount,        icon: Shield,    color: 'text-amber-400',  bg: 'bg-amber-500/10'  },
                                        { label: 'Action Card',     value: actionCount,      icon: Zap,       color: 'text-emerald-400',bg: 'bg-emerald-500/10'},
                                        { label: 'Kuyruk',          value: activeJobCount,   icon: Clock,     color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
                                    ].map(s => (
                                        <div key={s.label} className="p-4 rounded-2xl bg-bg-base border border-border-subtle flex items-center gap-3">
                                            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                                                <s.icon className={`w-4 h-4 ${s.color}`} />
                                            </div>
                                            <div>
                                                <p className="text-xl font-bold text-text-primary leading-none">{s.value}</p>
                                                <p className="text-[10px] text-text-tertiary mt-0.5">{s.label}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* ── All features ── */}
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary mb-3">Tüm Özellikler</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                                        {([
                                            { label: 'YouTube Ekle',    desc: 'URL veya kanal tara',           icon: Youtube,       tab: 'youtube'    as InputTab, color: 'text-red-400',     bg: 'bg-red-500/8     hover:bg-red-500/14     border-red-500/20'     },
                                            { label: 'Sosyal Medya',    desc: 'Twitter / Instagram analiz',    icon: Share2,        tab: 'social'     as InputTab, color: 'text-pink-400',    bg: 'bg-pink-500/8    hover:bg-pink-500/14    border-pink-500/20'    },
                                            { label: 'Dosya Yükle',     desc: 'PDF, TXT, video, ses',          icon: FileUp,        tab: 'file'       as InputTab, color: 'text-indigo-400',  bg: 'bg-indigo-500/8  hover:bg-indigo-500/14  border-indigo-500/20'  },
                                            { label: 'Metin Ekle',      desc: 'Makale veya not yapıştır',     icon: FileText,      tab: 'text'       as InputTab, color: 'text-teal-400',    bg: 'bg-teal-500/8    hover:bg-teal-500/14    border-teal-500/20'    },
                                            { label: 'Bilgi Test Et',   desc: 'Brain\'e soru sor',            icon: MessageSquare, tab: 'test'      as InputTab, color: 'text-blue-400',    bg: 'bg-blue-500/8    hover:bg-blue-500/14    border-blue-500/20'    },
                                            { label: 'Kural Öğret',     desc: 'Strateji & SEO kuralı ekle',   icon: GraduationCap, tab: 'learn'     as InputTab, color: 'text-violet-400',  bg: 'bg-violet-500/8  hover:bg-violet-500/14  border-violet-500/20'  },
                                        ] as const).map(a => (
                                            <button
                                                key={a.label}
                                                onClick={() => { setShowAddPanel(true); setInputTab(a.tab); }}
                                                className={`flex flex-col items-start gap-2 p-3.5 rounded-2xl border transition-all text-left ${a.bg}`}
                                            >
                                                <div className={`p-2 rounded-xl bg-white/5`}>
                                                    <a.icon className={`w-4 h-4 ${a.color}`} />
                                                </div>
                                                <div>
                                                    <p className="text-[13px] font-semibold text-text-primary">{a.label}</p>
                                                    <p className="text-[10px] text-text-tertiary mt-0.5 leading-tight">{a.desc}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Empty state */}
                                {memories.length === 0 && !loading && (
                                    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                                        <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
                                            <Brain className="w-8 h-8 text-accent" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-text-primary">Brain henüz boş</p>
                                            <p className="text-xs text-text-tertiary mt-1">Yukarıdaki kartlardan birini seçerek başla.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })()
                )}
            </div>
        </div>
        </div>
    );
}

// ─── Section helper ───────────────────────────────────────────────────────────

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                {icon}
                <h2 className="text-xs font-bold uppercase tracking-widest text-text-primary">{title}</h2>
            </div>
            <div className="space-y-3">{children}</div>
        </div>
    );
}
