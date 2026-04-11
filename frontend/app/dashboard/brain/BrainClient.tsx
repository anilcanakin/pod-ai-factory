'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Brain, Upload, Video, FileText, Zap, ChevronRight, Plus, Trash2,
    Loader2, Lightbulb, Target, Layout, CheckCircle2, AlertCircle,
    RefreshCw, BookOpen, Mic, BarChart2, ArrowUpCircle, X, MessageSquare
} from 'lucide-react';
import { apiBrain, CorporateMemory, VideoAnalysis } from '@/lib/api';
import { toast } from 'sonner';

type InputTab = 'video' | 'text' | 'test';
type VideoType = 'training' | 'meeting' | 'etsy_update' | 'tutorial';
type ProcessStep = 'idle' | 'uploading' | 'transcribing' | 'analyzing' | 'saving' | 'done';

const VIDEO_TYPE_LABELS: Record<VideoType, string> = {
    training: 'Training Video',
    meeting: 'Meeting Recording',
    etsy_update: 'Etsy Update',
    tutorial: 'Tutorial'
};

const STEP_LABELS: Record<ProcessStep, string> = {
    idle: '',
    uploading: 'Uploading video...',
    transcribing: 'Transcribing audio with Whisper...',
    analyzing: 'Analyzing frames with Claude Vision...',
    saving: 'Saving to knowledge base...',
    done: 'Done!'
};

const STEPS: ProcessStep[] = ['uploading', 'transcribing', 'analyzing', 'saving', 'done'];

const CATEGORIES = [
    { value: 'auto', label: '🤖 Auto-detect' },
    { value: 'pod_apparel', label: '👕 POD Apparel' },
    { value: 'seo_tips', label: '🔍 SEO Tips' },
    { value: 'etsy_algorithm', label: '⚙️ Etsy Algorithm' },
    { value: 'niche_research', label: '🎯 Niche Research' },
    { value: 'digital_products', label: '💾 Digital Products' },
    { value: 'general_etsy', label: '🛒 General Etsy' },
] as const;

type CategoryValue = typeof CATEGORIES[number]['value'];

const CATEGORY_COLORS: Record<string, string> = {
    pod_apparel:      'bg-blue-500/20 text-blue-400',
    seo_tips:         'bg-green-500/20 text-green-400',
    etsy_algorithm:   'bg-yellow-500/20 text-yellow-400',
    niche_research:   'bg-purple-500/20 text-purple-400',
    digital_products: 'bg-pink-500/20 text-pink-400',
    general_etsy:     'bg-slate-500/20 text-slate-400',
};

export function BrainClient() {
    const [memories, setMemories] = useState<CorporateMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [inputTab, setInputTab] = useState<InputTab>('video');

    // Video upload state
    const [dragOver, setDragOver] = useState(false);
    const [videoType, setVideoType] = useState<VideoType>('training');
    const [uploadPct, setUploadPct] = useState(0);
    const [processStep, setProcessStep] = useState<ProcessStep>('idle');
    const [lastResult, setLastResult] = useState<VideoAnalysis | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Text input state
    const [textTitle, setTextTitle] = useState('');
    const [textSource, setTextSource] = useState('');
    const [textContent, setTextContent] = useState('');
    const [addingText, setAddingText] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<CategoryValue>('auto');
    const [videoCategory, setVideoCategory] = useState<CategoryValue>('auto');

    // Test knowledge state
    const [testQuestion, setTestQuestion] = useState('');
    const [testAnswer, setTestAnswer] = useState('');
    const [testing, setTesting] = useState(false);

    useEffect(() => { loadMemories(); }, []);

    const loadMemories = async () => {
        setLoading(true);
        try {
            const data = await apiBrain.list();
            setMemories(data);
            if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
        } catch {
            toast.error('Failed to load brain data');
        } finally {
            setLoading(false);
        }
    };

    const handleVideoFile = useCallback(async (file: File) => {
        if (!file.type.startsWith('video/')) {
            toast.error('Please upload a video file (MP4, MOV, AVI)');
            return;
        }
        if (file.size > 500 * 1024 * 1024) {
            toast.error('File too large — max 500MB');
            return;
        }

        setProcessStep('uploading');
        setUploadPct(0);
        setLastResult(null);

        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', file.name.replace(/\.[^/.]+$/, ''));
        formData.append('videoType', videoType);
        if (videoCategory !== 'auto') formData.append('category', videoCategory);

        try {
            const result = await apiBrain.analyzeVideo(formData, (pct) => {
                setUploadPct(pct);
                if (pct === 100) setProcessStep('transcribing');
            });

            setProcessStep('analyzing');
            await new Promise(r => setTimeout(r, 400));
            setProcessStep('saving');
            await new Promise(r => setTimeout(r, 300));
            setProcessStep('done');

            setLastResult(result);
            setMemories(prev => [result.memory, ...prev]);
            setSelectedId(result.memory.id);

            const seoMsg = result.seoUpdated ? ' SEO knowledge base updated.' : '';
            toast.success(`Brain analysis complete! ${result.frameCount} frames analyzed.${seoMsg}`);
        } catch (err) {
            setProcessStep('idle');
            toast.error('Analysis failed: ' + (err as Error).message);
        }
    }, [videoType, videoCategory]);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleVideoFile(file);
    }, [handleVideoFile]);

    const handleAddText = async () => {
        if (!textTitle.trim() || !textContent.trim()) {
            toast.error('Title and content are required');
            return;
        }
        setAddingText(true);
        try {
            const result = await apiBrain.addText(
                textTitle,
                textContent,
                textSource || 'manual',
                selectedCategory === 'auto' ? undefined : selectedCategory
            );
            setMemories(prev => [result, ...prev]);
            setSelectedId(result.id);
            setTextTitle('');
            setTextSource('');
            setTextContent('');
            setSelectedCategory('auto');
            const seoMsg = result.seoUpdated ? ' SEO knowledge base updated.' : '';
            toast.success(`Added to knowledge base!${seoMsg}`);
        } catch (err) {
            toast.error('Failed: ' + (err as Error).message);
        } finally {
            setAddingText(false);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Remove this memory?')) return;
        try {
            await apiBrain.delete(id);
            setMemories(prev => prev.filter(m => m.id !== id));
            if (selectedId === id) setSelectedId(memories.find(m => m.id !== id)?.id ?? null);
            toast.success('Memory removed');
        } catch {
            toast.error('Failed to remove memory');
        }
    };

    const selectedMemory = memories.find(m => m.id === selectedId);
    const handleTest = async () => {
        if (!testQuestion.trim()) return;
        setTesting(true);
        setTestAnswer('');
        try {
            const res = await fetch('/api/brain/test-knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ question: testQuestion })
            });
            const data = await res.json();
            setTestAnswer(data.answer || 'No answer found. Try adding more knowledge first.');
        } catch {
            setTestAnswer('Error connecting to knowledge base.');
        } finally {
            setTesting(false);
        }
    };

    const handleFeedback = (type: 'correct' | 'incorrect' | 'partial') => {
        if (type === 'correct') {
            toast.success('Great! Knowledge base is working correctly.');
        } else if (type === 'incorrect') {
            toast.error('Consider updating your knowledge base with more accurate information.');
        } else {
            toast.info('Consider adding more specific information to improve accuracy.');
        }
    };

    const isProcessing = processStep !== 'idle' && processStep !== 'done';

    const typeIcon = (type: string) => {
        if (type === 'TEXT_NOTE') return <FileText className="w-3 h-3" />;
        return <Video className="w-3 h-3" />;
    };

    const typeColor = (type: string) => {
        if (type === 'TEXT_NOTE') return 'text-blue-400 bg-blue-400/10';
        if (type === 'VIDEO_FULL') return 'text-accent bg-accent/10';
        return 'text-purple-400 bg-purple-400/10';
    };

    return (
        <div className="flex h-[calc(100vh-100px)] gap-4 p-2 overflow-hidden">

            {/* ── Sidebar ─────────────────────────────────────────────── */}
            <div className="w-72 flex flex-col bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden shrink-0">
                <div className="p-4 border-b border-border-subtle">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold flex items-center gap-2">
                            <Brain className="w-4 h-4 text-accent" />
                            AI Corporate Brain
                        </h2>
                        <button
                            onClick={loadMemories}
                            className="w-7 h-7 rounded-lg bg-bg-overlay text-text-tertiary hover:text-text-primary flex items-center justify-center transition-colors"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                        {memories.length} memor{memories.length === 1 ? 'y' : 'ies'} stored
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {/* Add new entry button */}
                    <button
                        onClick={() => setSelectedId(null)}
                        className={`w-full text-left p-3 rounded-xl transition-all border flex items-center gap-2.5 ${
                            selectedId === null
                                ? 'bg-accent/10 border-accent/20 text-accent'
                                : 'border-dashed border-border-subtle hover:bg-bg-overlay text-text-tertiary hover:text-text-secondary'
                        }`}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="text-[12px] font-medium">Add New Knowledge</span>
                    </button>

                    {loading ? (
                        <div className="flex items-center justify-center h-24">
                            <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
                        </div>
                    ) : memories.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-4 text-center space-y-2 mt-4">
                            <BookOpen className="w-8 h-8 text-text-tertiary opacity-20" />
                            <p className="text-[11px] text-text-tertiary leading-relaxed">
                                No training data yet. Upload a video or paste text to start building the AI brain.
                            </p>
                        </div>
                    ) : (
                        memories.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedId(m.id)}
                                className={`w-full text-left p-3 rounded-xl transition-all group border ${
                                    selectedId === m.id
                                        ? 'bg-accent/10 border-accent/20'
                                        : 'border-transparent hover:bg-bg-overlay'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-1.5">
                                    <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                                        <span className={`p-1 rounded-md ${typeColor(m.type)}`}>
                                            {typeIcon(m.type)}
                                        </span>
                                        <span className={`text-[9px] font-bold uppercase tracking-wider truncate ${
                                            selectedId === m.id ? 'text-accent' : 'text-text-tertiary'
                                        }`}>
                                            {m.type.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <Trash2
                                        onClick={(e) => handleDelete(m.id, e)}
                                        className="w-3 h-3 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0 mt-1"
                                    />
                                </div>
                                <p className={`text-[12px] font-medium leading-tight line-clamp-2 ${
                                    selectedId === m.id ? 'text-text-primary' : 'text-text-secondary'
                                }`}>
                                    {m.title}
                                </p>
                                <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-medium mt-1.5 ${CATEGORY_COLORS[m.category] || CATEGORY_COLORS.general_etsy}`}>
                                    {(m.category || 'general_etsy').replace(/_/g, ' ')}
                                </span>
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-[10px] text-text-tertiary">
                                        {new Date(m.createdAt).toLocaleDateString()}
                                    </span>
                                    {m.analysisResult?.seoUpdated && (
                                        <span className="text-[9px] text-green-400 font-bold uppercase tracking-wider">
                                            SEO ↑
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* ── Main Panel ──────────────────────────────────────────── */}
            <div className="flex-1 bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden flex flex-col">

                {selectedMemory ? (
                    /* ── Memory Detail View ─────────────────────────── */
                    <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-8">
                        {/* Header */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${typeColor(selectedMemory.type)}`}>
                                    {selectedMemory.type.replace(/_/g, ' ')}
                                </span>
                                {selectedMemory.analysisResult?.seoUpdated && (
                                    <span className="px-2.5 py-1 rounded-full bg-green-400/10 text-green-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                                        <ArrowUpCircle className="w-3 h-3" /> SEO Updated
                                    </span>
                                )}
                                <span className="text-text-tertiary text-xs">
                                    {new Date(selectedMemory.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <h1 className="text-2xl font-bold text-text-primary">{selectedMemory.title}</h1>
                            {selectedMemory.analysisResult?.frameCount && (
                                <p className="text-xs text-text-tertiary flex items-center gap-2">
                                    <BarChart2 className="w-3.5 h-3.5" />
                                    {selectedMemory.analysisResult.frameCount} frames analyzed
                                    {selectedMemory.analysisResult.videoType && ` · ${selectedMemory.analysisResult.videoType}`}
                                </p>
                            )}
                        </div>

                        {/* New-style: synthesis text */}
                        {selectedMemory.analysisResult?.synthesis && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-accent">
                                    <Brain className="w-4 h-4" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest">Knowledge Synthesis</h2>
                                </div>
                                <div className="p-6 rounded-2xl bg-bg-base border border-border-subtle">
                                    <pre className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap font-sans">
                                        {selectedMemory.analysisResult.synthesis}
                                    </pre>
                                </div>
                            </div>
                        )}

                        {/* Old-style: Gemini actionable rules */}
                        {selectedMemory.analysisResult?.actionableRules && selectedMemory.analysisResult.actionableRules.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-accent">
                                    <Target className="w-4 h-4" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest">IF-THEN Rules</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {selectedMemory.analysisResult.actionableRules.map((rule, i) => (
                                        <div key={i} className="p-5 rounded-2xl bg-bg-base border border-border-subtle hover:border-accent/40 transition-colors">
                                            <div className="space-y-2">
                                                <div className="flex items-start gap-2">
                                                    <span className="text-[10px] font-black text-accent bg-accent/10 px-2 py-0.5 rounded shrink-0">IF</span>
                                                    <p className="text-sm text-text-primary">{rule.condition}</p>
                                                </div>
                                                <div className="flex items-start gap-2">
                                                    <span className="text-[10px] font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded shrink-0">THEN</span>
                                                    <p className="text-sm text-text-secondary">{rule.action}</p>
                                                </div>
                                                <p className="text-[11px] text-text-tertiary italic pt-2 border-t border-border-subtle/50">
                                                    {rule.rationale}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* UI Insights */}
                        {selectedMemory.analysisResult?.uiInsights && selectedMemory.analysisResult.uiInsights.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-blue-400">
                                    <Layout className="w-4 h-4" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest text-text-primary">Interface Insights</h2>
                                </div>
                                {selectedMemory.analysisResult.uiInsights.map((insight, i) => (
                                    <div key={i} className="flex gap-3 p-4 rounded-xl bg-bg-overlay border border-border-subtle">
                                        <div>
                                            <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">{insight.element}</p>
                                            <p className="text-[13px] text-text-secondary mt-0.5">{insight.recommendation}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Strategic Notes */}
                        {selectedMemory.analysisResult?.strategicNotes && selectedMemory.analysisResult.strategicNotes.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-purple-400">
                                    <Lightbulb className="w-4 h-4" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest text-text-primary">Strategic Notes</h2>
                                </div>
                                {selectedMemory.analysisResult.strategicNotes.map((note, i) => (
                                    <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-bg-overlay border border-border-subtle">
                                        <ChevronRight className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                                        <p className="text-[13px] text-text-secondary">{note}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Transcript excerpt */}
                        {selectedMemory.analysisResult?.transcript && selectedMemory.analysisResult.transcript.length > 50 && (
                            <details className="group">
                                <summary className="flex items-center gap-2 cursor-pointer text-text-tertiary hover:text-text-secondary text-xs font-medium select-none">
                                    <Mic className="w-3.5 h-3.5" />
                                    Audio transcript excerpt
                                    <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
                                </summary>
                                <div className="mt-3 p-4 rounded-xl bg-bg-overlay border border-border-subtle">
                                    <p className="text-[12px] text-text-tertiary leading-relaxed whitespace-pre-wrap font-mono">
                                        {selectedMemory.analysisResult.transcript.slice(0, 1000)}
                                        {selectedMemory.analysisResult.transcript.length > 1000 && '…'}
                                    </p>
                                </div>
                            </details>
                        )}
                    </div>
                ) : (
                    /* ── Add New Content Panel ──────────────────────── */
                    <div className="flex-1 overflow-y-auto">
                        {/* Tab bar */}
                        <div className="flex border-b border-border-subtle px-6">
                            {([
                                { key: 'video', label: 'Upload Video', icon: Video },
                                { key: 'text', label: 'Paste Text', icon: FileText },
                                { key: 'test', label: 'Test Knowledge', icon: MessageSquare }
                            ] as const).map(({ key, label, icon: Icon }) => (
                                <button
                                    key={key}
                                    onClick={() => setInputTab(key)}
                                    className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                                        inputTab === key
                                            ? 'border-accent text-accent'
                                            : 'border-transparent text-text-tertiary hover:text-text-secondary'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="p-8 max-w-2xl mx-auto space-y-6">
                            {inputTab === 'video' ? (
                                /* ── Video Upload ─────────────────────── */
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-lg font-bold text-text-primary mb-1">Analyze Video</h2>
                                        <p className="text-sm text-text-tertiary">
                                            Upload a training video, meeting recording, or Etsy tutorial. Claude will extract frames, transcribe audio with Whisper, and synthesize actionable knowledge.
                                        </p>
                                    </div>

                                    {/* Video type selector */}
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Video Type</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(Object.entries(VIDEO_TYPE_LABELS) as [VideoType, string][]).map(([key, label]) => (
                                                <button
                                                    key={key}
                                                    onClick={() => setVideoType(key)}
                                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                                                        videoType === key
                                                            ? 'bg-accent/10 border-accent/30 text-accent'
                                                            : 'bg-bg-overlay border-border-subtle text-text-secondary hover:border-border-default'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Category selector */}
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Category</label>
                                        <select
                                            value={videoCategory}
                                            onChange={e => setVideoCategory(e.target.value as CategoryValue)}
                                            className="w-full bg-bg-overlay border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                                        >
                                            {CATEGORIES.map(c => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Drop zone */}
                                    {processStep === 'idle' || processStep === 'done' ? (
                                        <div
                                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                            onDragLeave={() => setDragOver(false)}
                                            onDrop={onDrop}
                                            onClick={() => fileInputRef.current?.click()}
                                            className={`relative border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                                                dragOver
                                                    ? 'border-accent bg-accent/5 scale-[1.01]'
                                                    : 'border-border-subtle hover:border-border-default hover:bg-bg-overlay'
                                            }`}
                                        >
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="video/*"
                                                className="hidden"
                                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); }}
                                            />
                                            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
                                                <Upload className="w-7 h-7 text-accent" />
                                            </div>
                                            <div className="text-center">
                                                <p className="text-sm font-semibold text-text-primary">Drop video here or click to browse</p>
                                                <p className="text-xs text-text-tertiary mt-1">MP4, MOV, AVI · Max 500MB</p>
                                            </div>
                                            {processStep === 'done' && lastResult && (
                                                <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    Last: {lastResult.frameCount} frames analyzed
                                                    {lastResult.seoUpdated && ' · SEO updated'}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        /* Processing progress */
                                        <div className="border-2 border-accent/20 rounded-2xl p-8 space-y-6 bg-accent/5">
                                            <div className="flex items-center gap-3">
                                                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                                                <span className="text-sm font-semibold text-text-primary">
                                                    {STEP_LABELS[processStep]}
                                                </span>
                                            </div>

                                            {/* Upload progress bar */}
                                            {processStep === 'uploading' && (
                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-xs text-text-tertiary">
                                                        <span>Uploading</span>
                                                        <span>{uploadPct}%</span>
                                                    </div>
                                                    <div className="h-2 bg-bg-overlay rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-accent rounded-full transition-all duration-300"
                                                            style={{ width: `${uploadPct}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            {/* Step indicator */}
                                            <div className="flex gap-2">
                                                {STEPS.map((step) => {
                                                    const stepIdx = STEPS.indexOf(step);
                                                    const currentIdx = STEPS.indexOf(processStep);
                                                    const isDone = stepIdx < currentIdx;
                                                    const isCurrent = step === processStep;
                                                    return (
                                                        <div
                                                            key={step}
                                                            className={`flex-1 h-1 rounded-full transition-all duration-500 ${
                                                                isDone ? 'bg-accent' : isCurrent ? 'bg-accent/50' : 'bg-bg-overlay'
                                                            }`}
                                                        />
                                                    );
                                                })}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                {[
                                                    { step: 'uploading', label: 'Upload', icon: Upload },
                                                    { step: 'transcribing', label: 'Whisper', icon: Mic },
                                                    { step: 'analyzing', label: 'Claude Vision', icon: Brain },
                                                    { step: 'saving', label: 'Save', icon: BookOpen }
                                                ].map(({ step, label, icon: Icon }) => {
                                                    const stepIdx = STEPS.indexOf(step as ProcessStep);
                                                    const currentIdx = STEPS.indexOf(processStep);
                                                    const isDone = stepIdx < currentIdx;
                                                    const isCurrent = step === processStep;
                                                    return (
                                                        <div key={step} className={`flex items-center gap-2 text-xs ${
                                                            isDone ? 'text-accent' : isCurrent ? 'text-text-primary' : 'text-text-tertiary'
                                                        }`}>
                                                            {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : isCurrent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                                                            {label}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : inputTab === 'text' ? (
                                /* ── Text Input ───────────────────────── */
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-lg font-bold text-text-primary mb-1">Add Text Knowledge</h2>
                                        <p className="text-sm text-text-tertiary">
                                            Paste Etsy update notes, seller handbook excerpts, tips, or any business knowledge. Claude will extract and structure the insights.
                                        </p>
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Title *</label>
                                            <input
                                                type="text"
                                                value={textTitle ?? ''}
                                                onChange={e => setTextTitle(e.target.value)}
                                                placeholder="e.g. Etsy Seller Handbook 2026"
                                                className="w-full bg-bg-overlay border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Source</label>
                                            <input
                                                type="text"
                                                value={textSource ?? ''}
                                                onChange={e => setTextSource(e.target.value)}
                                                placeholder="e.g. Etsy Seller Handbook, YouTube, blog post"
                                                className="w-full bg-bg-overlay border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Category</label>
                                            <select
                                                value={selectedCategory}
                                                onChange={e => setSelectedCategory(e.target.value as CategoryValue)}
                                                className="w-full bg-bg-overlay border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
                                            >
                                                {CATEGORIES.map(c => (
                                                    <option key={c.value} value={c.value}>{c.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5">Content *</label>
                                            <textarea
                                                value={textContent ?? ''}
                                                onChange={e => setTextContent(e.target.value)}
                                                placeholder="Paste your notes, tips, or article content here..."
                                                rows={12}
                                                className="w-full bg-bg-overlay border border-border-subtle rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors resize-none font-mono"
                                            />
                                            <p className="text-[11px] text-text-tertiary mt-1 text-right">
                                                {textContent.length.toLocaleString()} chars
                                            </p>
                                        </div>

                                        <button
                                            onClick={handleAddText}
                                            disabled={addingText || !textTitle.trim() || !textContent.trim()}
                                            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity"
                                        >
                                            {addingText ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Processing with Claude...
                                                </>
                                            ) : (
                                                <>
                                                    <Zap className="w-4 h-4" />
                                                    Add to Knowledge Base
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 border-dashed">
                                        <p className="text-[11px] text-accent text-center leading-relaxed">
                                            Claude will extract IF-THEN rules, SEO tips, and action items. If SEO insights are found, the SEO knowledge base will be automatically updated.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                /* ── Test Knowledge ───────────────────── */
                                <div className="space-y-5">
                                    <div>
                                        <h2 className="text-lg font-bold text-text-primary mb-1">Test Knowledge Base</h2>
                                        <p className="text-sm text-text-tertiary">
                                            Ask a question to verify the AI correctly understood your uploaded content.
                                        </p>
                                    </div>

                                    {/* Quick test questions */}
                                    <div>
                                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Quick Questions</label>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                'What are the best tags for patriotic shirts?',
                                                'What did the latest Etsy algorithm update change?',
                                                'What niches should I focus on this month?',
                                                'What title format works best in 2026?',
                                                'What are the top SEO mistakes to avoid?'
                                            ].map(q => (
                                                <button
                                                    key={q}
                                                    onClick={() => setTestQuestion(q)}
                                                    className="text-[11px] px-2.5 py-1 bg-bg-overlay hover:bg-bg-base text-text-tertiary hover:text-text-primary rounded-lg border border-border-subtle hover:border-border-default transition-colors"
                                                >
                                                    {q}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Question input */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={testQuestion ?? ''}
                                            onChange={e => setTestQuestion(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleTest()}
                                            placeholder="Ask anything about Etsy, POD, or your business..."
                                            className="flex-1 bg-bg-overlay border border-border-subtle rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                                        />
                                        <button
                                            onClick={handleTest}
                                            disabled={testing || !testQuestion.trim()}
                                            className="px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity shrink-0"
                                        >
                                            {testing
                                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                                : <MessageSquare className="w-4 h-4" />}
                                            Ask
                                        </button>
                                    </div>

                                    {/* Answer */}
                                    {testAnswer && (
                                        <div className="bg-bg-overlay border border-border-subtle rounded-2xl p-5 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-bold text-text-tertiary uppercase tracking-widest">AI Answer</p>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleFeedback('correct')}
                                                        className="flex items-center gap-1 px-2.5 py-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 text-[10px] font-medium rounded-lg border border-green-500/20 transition-colors"
                                                    >
                                                        ✓ Correct
                                                    </button>
                                                    <button
                                                        onClick={() => handleFeedback('incorrect')}
                                                        className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-medium rounded-lg border border-red-500/20 transition-colors"
                                                    >
                                                        ✗ Wrong
                                                    </button>
                                                    <button
                                                        onClick={() => handleFeedback('partial')}
                                                        className="flex items-center gap-1 px-2.5 py-1 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-[10px] font-medium rounded-lg border border-yellow-500/20 transition-colors"
                                                    >
                                                        ~ Partial
                                                    </button>
                                                </div>
                                            </div>
                                            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{testAnswer}</p>
                                        </div>
                                    )}

                                    {memories.length === 0 && (
                                        <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                                            <p className="text-[11px] text-text-tertiary leading-relaxed">
                                                No knowledge in the brain yet. Upload a video or paste text first to get meaningful answers.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
