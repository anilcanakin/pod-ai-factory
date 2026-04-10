'use client';

import { useState, useEffect } from 'react';
import { 
    Brain, 
    Upload, 
    Video, 
    FileText, 
    Zap, 
    ChevronRight, 
    Plus, 
    Trash2, 
    Loader2, 
    Lightbulb,
    Target,
    Layout
} from 'lucide-react';
import { apiBrain, CorporateMemory } from '@/lib/api';
import { toast } from 'react-hot-toast';

export function BrainClient() {
    const [memories, setMemories] = useState<CorporateMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        loadMemories();
    }, []);

    const loadMemories = async () => {
        try {
            const data = await apiBrain.list();
            setMemories(data);
            if (data.length > 0 && !selectedId) setSelectedId(data[0].id);
        } catch (err) {
            toast.error('Failed to load brain data');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', file.name.replace(/\.[^/.]+$/, ""));
        formData.append('type', 'VIDEO_TUTORIAL');

        const toastId = toast.loading('Feeding the brain... (Analyzing video screens)');

        try {
            const newMemory = await apiBrain.ingestVideo(formData);
            setMemories([newMemory, ...memories]);
            setSelectedId(newMemory.id);
            toast.success('Brain fed! New insights extracted.', { id: toastId });
        } catch (err) {
            toast.error('Failed to process video: ' + (err as Error).message, { id: toastId });
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to forget this memory?')) return;
        try {
            await apiBrain.delete(id);
            setMemories(memories.filter(m => m.id !== id));
            if (selectedId === id) setSelectedId(null);
            toast.success('Memory wiped');
        } catch (err) {
            toast.error('Failed to wipe memory');
        }
    };

    const selectedMemory = memories.find(m => m.id === selectedId);

    return (
        <div className="flex h-[calc(100vh-100px)] gap-6 p-2 overflow-hidden">
            {/* Sidebar List */}
            <div className="w-80 flex flex-col bg-bg-elevated border border-border-subtle rounded-2xl overflow-hidden shrink-0">
                <div className="p-4 border-b border-border-subtle flex items-center justify-between">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                        <Brain className="w-4 h-4 text-accent" />
                        AI Corporate Brain
                    </h2>
                    <label className="cursor-pointer">
                        <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} disabled={uploading} />
                        <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center hover:bg-accent/20 transition-colors">
                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        </div>
                    </label>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-6 h-6 animate-spin text-text-tertiary" />
                        </div>
                    ) : memories.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full p-4 text-center space-y-3">
                            <Video className="w-10 h-10 text-text-tertiary opacity-20" />
                            <p className="text-xs text-text-tertiary leading-relaxed"> No training data yet. Upload a video tutorial or meeting to start building the AI brain.</p>
                        </div>
                    ) : (
                        memories.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedId(m.id)}
                                className={`w-full text-left p-3 rounded-xl transition-all group ${
                                    selectedId === m.id 
                                    ? 'bg-accent/10 border border-accent/20 shadow-sm' 
                                    : 'hover:bg-bg-overlay border border-transparent'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={`p-1.5 rounded-md ${selectedId === m.id ? 'bg-accent text-white' : 'bg-bg-base text-text-tertiary'}`}>
                                            <Video className="w-3 h-3" />
                                        </div>
                                        <span className={`text-[11px] font-bold uppercase tracking-wider ${selectedId === m.id ? 'text-accent' : 'text-text-tertiary'}`}>
                                            {m.type.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <Trash2 
                                        onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                                        className="w-3.5 h-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all" 
                                    />
                                </div>
                                <h3 className={`text-[13px] font-medium leading-tight truncate ${selectedId === m.id ? 'text-text-primary' : 'text-text-secondary'}`}>
                                    {m.title}
                                </h3>
                                <p className="text-[10px] text-text-tertiary mt-2">
                                    {new Date(m.createdAt).toLocaleDateString()}
                                </p>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Main Content View */}
            <div className="flex-1 bg-bg-elevated border border-border-subtle rounded-2xl overflow-y-auto">
                {selectedMemory ? (
                    <div className="p-8 max-w-4xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Header */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-widest">
                                    Deep Analysis
                                </span>
                                <span className="text-text-tertiary text-xs">
                                    Processed on {new Date(selectedMemory.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <h1 className="text-3xl font-bold text-text-primary tracking-tight">
                                {selectedMemory.title}
                            </h1>
                            <p className="text-text-secondary text-lg leading-relaxed">
                                {selectedMemory.analysisResult?.summary}
                            </p>
                        </div>

                        {/* Grid Sections */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Actionable Rules */}
                            <div className="col-span-full space-y-4">
                                <div className="flex items-center gap-2 text-accent">
                                    <Target className="w-5 h-5" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest">Actionable IF-THEN Rules</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {selectedMemory.analysisResult?.actionableRules?.map((rule, i) => (
                                        <div key={i} className="p-5 rounded-2xl bg-bg-base border border-border-subtle relative overflow-hidden group hover:border-accent/40 transition-colors">
                                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                                                <Zap className="w-12 h-12 text-accent" />
                                            </div>
                                            <div className="space-y-3 relative z-10">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-accent bg-accent/10 px-2 py-0.5 rounded">IF</span>
                                                    <p className="text-sm font-medium text-text-primary">{rule.condition}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">THEN</span>
                                                    <p className="text-sm font-medium text-text-secondary">{rule.action}</p>
                                                </div>
                                                <p className="text-[11px] text-text-tertiary italic mt-2 pt-2 border-t border-border-subtle/50">
                                                    Rationale: {rule.rationale}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* UI Insights */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-blue-400">
                                    <Layout className="w-5 h-5" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest text-text-primary">Interface Insights</h2>
                                </div>
                                <div className="space-y-3">
                                    {selectedMemory.analysisResult?.uiInsights?.map((insight, i) => (
                                        <div key={i} className="flex gap-4 p-4 rounded-xl bg-bg-overlay border border-border-subtle">
                                            <div className="flex-1 space-y-1">
                                                <p className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">{insight.element}</p>
                                                <p className="text-[13px] text-text-secondary leading-snug">{insight.recommendation}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Strategic Notes */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-purple-400">
                                    <Lightbulb className="w-5 h-5" />
                                    <h2 className="text-sm font-bold uppercase tracking-widest text-text-primary">Strategic Notes</h2>
                                </div>
                                <div className="space-y-3">
                                    {selectedMemory.analysisResult?.strategicNotes?.map((note, i) => (
                                        <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-bg-overlay border border-border-subtle">
                                            <ChevronRight className="w-4 h-4 text-purple-400 mt-0.5" />
                                            <p className="text-[13px] text-text-secondary">{note}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Visual Evidence Note */}
                        <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 border-dashed">
                            <p className="text-[11px] text-accent text-center italic">
                                * These insights were extracted by analyzing both audio transcript and visual screen changes from the original source.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center space-y-6 text-center">
                        <div className="relative">
                            <Brain className="w-20 h-20 text-accent opacity-20" />
                            <Zap className="w-8 h-8 text-accent absolute top-0 -right-2 animate-pulse" />
                        </div>
                        <div className="space-y-2 max-w-md">
                            <h2 className="text-xl font-bold text-text-primary">The Brain is Idle</h2>
                            <p className="text-sm text-text-tertiary leading-relaxed">
                                Select a memory from the sidebar or upload a new video to see the deep insights extracted from your training materials.
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-8">
                            <div className="p-4 rounded-2xl bg-bg-overlay border border-border-subtle flex flex-col items-center gap-2">
                                <Video className="w-5 h-5 text-accent" />
                                <span className="text-[10px] uppercase font-bold text-text-tertiary">Video Tutorials</span>
                            </div>
                            <div className="p-4 rounded-2xl bg-bg-overlay border border-border-subtle flex flex-col items-center gap-2">
                                <Layout className="w-5 h-5 text-purple-400" />
                                <span className="text-[10px] uppercase font-bold text-text-tertiary">Meeting Recordings</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
