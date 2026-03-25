'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFactory } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Loader2, ArrowRight, Upload, X, Sparkles, Wand2,
    Zap, CheckCircle, Image as ImageIcon, Cpu, Eye, Palette,
    Brush, Layers, ChevronDown, ChevronUp, Pencil, Trash2
} from 'lucide-react';
import Link from 'next/link';

export function FactoryClient() {
    // ── State ──────────────────────────────────────────────────
    const [refImages, setRefImages] = useState<string[]>([]);
    const [mainPrompt, setMainPrompt] = useState('');
    const [variations, setVariations] = useState<{ id: string; prompt: string; selected: boolean }[]>([]);
    const [variationMode, setVariationMode] = useState<'subject' | 'style' | 'color'>('subject');
    const [variationCount, setVariationCount] = useState(4);
    const [model, setModel] = useState('fal-ai/flux/dev');
    
    const { data: models = [], isLoading: isLoadingModels } = useQuery({
        queryKey: ['models'],
        queryFn: apiFactory.getModels,
        staleTime: Infinity
    });

    const [imageSize, setImageSize] = useState('square_hd');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGettingVariations, setIsGettingVariations] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [lastJobId, setLastJobId] = useState<string | null>(null);
    const [expandedVariation, setExpandedVariation] = useState<string | null>(null);
    const [editingVariation, setEditingVariation] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // ── Image compression (reuse existing Canvas logic) ───────
    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            toast.error('Please upload an image file (JPG/PNG).');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const img = new window.Image();
            img.onload = () => {
                const MAX_DIM = 1024;
                let width = img.width;
                let height = img.height;
                if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                        height = Math.round((height * MAX_DIM) / width);
                        width = MAX_DIM;
                    } else {
                        width = Math.round((width * MAX_DIM) / height);
                        height = MAX_DIM;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                    setRefImages(prev => [...prev, compressedBase64].slice(0, 3));
                } else {
                    setRefImages(prev => [...prev, reader.result as string].slice(0, 3));
                }
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) {
            Array.from(e.dataTransfer.files).forEach(f => processFile(f));
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            Array.from(e.target.files).forEach(f => processFile(f));
        }
    };

    const removeImage = (idx: number) => {
        setRefImages(prev => prev.filter((_, i) => i !== idx));
    };

    // ── API Calls ─────────────────────────────────────────────
    const analyzeImages = async () => {
        if (refImages.length === 0) return toast.error('Please upload at least one reference image.');
        setIsAnalyzing(true);
        try {
            const data = await apiFactory.analyze({ referenceImageIds: refImages });
            setMainPrompt(data.prompt);
            
            if (data.isSynthetic || data.provider === 'synthetic') {
                toast.warning('Vision APIs failed or unavailable — using synthetic prompt');
            } else if (data.provider === 'anthropic') {
                toast.success('Analyzed with Claude');
            } else if (data.provider === 'openai') {
                toast.success('Analyzed with GPT-4o');
            } else if (data.provider === 'gemini') {
                toast.success('Analyzed with Gemini');
            } else {
                toast.success('AI prompt extracted!');
            }
            
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Analysis failed');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const fetchVariations = async () => {
        if (!mainPrompt.trim()) return toast.error('Please enter a prompt first.');
        setIsGettingVariations(true);
        try {
            const data = await apiFactory.getVariations({
                basePrompt: mainPrompt,
                count: variationCount,
                variationMode
            });
            setVariations(data.variations.map((p, i) => ({
                id: `var-${Date.now()}-${i}`,
                prompt: p,
                selected: true
            })));
            toast.success(`${data.variations.length} variations generated!`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Variation generation failed');
        } finally {
            setIsGettingVariations(false);
        }
    };

    const startGeneration = async () => {
        const selectedPrompts = getSelectedPrompts();
        if (selectedPrompts.length === 0) return toast.error('No prompts selected for generation.');
        setIsGenerating(true);
        try {
            const data = await apiFactory.generate({
                prompts: selectedPrompts,
                model,
                imageSize
            });
            setLastJobId(data.jobId);
            toast.success(`${data.imageCount} images queued for generation!`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setIsGenerating(false);
        }
    };

    // ── Helpers ────────────────────────────────────────────────
    const getSelectedPrompts = () => {
        const varPrompts = variations.filter(v => v.selected).map(v => v.prompt);
        if (varPrompts.length > 0) return varPrompts;
        if (mainPrompt.trim()) return [mainPrompt.trim()];
        return [];
    };

    const toggleVariation = (id: string) => {
        setVariations(prev => prev.map(v => v.id === id ? { ...v, selected: !v.selected } : v));
    };

    const selectAllVariations = () => setVariations(prev => prev.map(v => ({ ...v, selected: true })));
    const deselectAllVariations = () => setVariations(prev => prev.map(v => ({ ...v, selected: false })));

    const deleteVariation = (id: string) => {
        setVariations(prev => prev.filter(v => v.id !== id));
    };

    const updateVariation = (id: string, newPrompt: string) => {
        setVariations(prev => prev.map(v => v.id === id ? { ...v, prompt: newPrompt } : v));
        setEditingVariation(null);
    };

    const selectedCount = variations.filter(v => v.selected).length || (mainPrompt.trim() ? 1 : 0);

    // ── Render ─────────────────────────────────────────────────
    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-text-primary">AI Design Generator</h1>
                <p className="text-sm text-text-secondary mt-1">Create POD-ready designs with AI-powered generation</p>
            </div>

            <div className="flex gap-0 min-h-[calc(100vh-180px)]">
                {/* ── LEFT PANEL ─────────────────────────────── */}
                <div className="w-[400px] flex-shrink-0 border-r border-border-subtle pr-6 space-y-6">

                    {/* Upload Area */}
                    <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">Reference Images</h3>

                        {/* Thumbnails */}
                        {refImages.length > 0 && (
                            <div className="flex gap-2 mb-3">
                                {refImages.map((img, i) => (
                                    <div key={i} className="relative w-20 h-20 rounded-[8px] overflow-hidden border border-border-default group">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={img} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => removeImage(i)}
                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X className="w-3 h-3 text-white" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {refImages.length < 3 && (
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={e => { e.preventDefault(); setIsDragging(false); }}
                                onDrop={handleDrop}
                                className={cn(
                                    "border-2 border-dashed rounded-[10px] h-28 flex flex-col items-center justify-center transition-all cursor-pointer group",
                                    isDragging ? "bg-accent-subtle border-accent" : "bg-bg-elevated/50 border-border-default hover:border-accent/50"
                                )}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    multiple
                                    onChange={handleFileChange}
                                />
                                <Upload className={cn("w-6 h-6 mb-1 transition-colors", isDragging ? "text-accent" : "text-text-tertiary group-hover:text-accent")} />
                                <p className="text-xs text-text-secondary">Drop images or <span className="text-accent">browse</span></p>
                                <p className="text-[10px] text-text-tertiary mt-0.5">JPG, PNG up to 10MB · Max 3</p>
                            </div>
                        )}
                    </section>

                    {/* Get AI Prompt Button */}
                    <button
                        onClick={analyzeImages}
                        disabled={refImages.length === 0 || isAnalyzing}
                        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isAnalyzing ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                        ) : (
                            <><Sparkles className="w-4 h-4" /> Get AI Prompt</>
                        )}
                    </button>

                    {/* Prompt Textarea */}
                    <section>
                        <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2 block">Generation Prompt</label>
                        <div className="relative">
                            <textarea
                                value={mainPrompt}
                                onChange={e => setMainPrompt(e.target.value)}
                                rows={6}
                                className="w-full bg-bg-elevated border border-border-default rounded-[10px] px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent resize-none"
                                placeholder="Upload a reference image and click 'Get AI Prompt', or write your own..."
                            />
                            <span className="absolute bottom-2 right-3 text-[10px] text-text-tertiary tabular-nums">
                                {mainPrompt.length}
                            </span>
                        </div>
                    </section>

                    {/* Variation Controls */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">Variations</h3>

                        {/* Mode pills */}
                        <div className="flex gap-1.5">
                            {(['subject', 'style', 'color'] as const).map(m => (
                                <button
                                    key={m}
                                    onClick={() => setVariationMode(m)}
                                    className={cn(
                                        'px-3 py-1.5 text-xs rounded-full font-medium transition-all border',
                                        variationMode === m
                                            ? 'bg-accent-subtle text-accent border-accent-border'
                                            : 'bg-bg-elevated text-text-secondary border-border-default hover:border-border-strong'
                                    )}
                                >
                                    {m.charAt(0).toUpperCase() + m.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Count input */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-text-secondary">Count:</label>
                            <input
                                type="number"
                                min={1}
                                max={8}
                                value={variationCount}
                                onChange={e => setVariationCount(Math.min(8, Math.max(1, parseInt(e.target.value) || 1)))}
                                className="w-16 bg-bg-elevated border border-border-default rounded-[8px] px-2 py-1.5 text-sm text-text-primary text-center focus:outline-none focus:border-accent"
                            />
                        </div>

                        {/* Get Variations Button */}
                        <button
                            onClick={fetchVariations}
                            disabled={!mainPrompt.trim() || isGettingVariations}
                            className="w-full flex items-center justify-center gap-2 bg-bg-elevated border border-border-default hover:border-accent text-text-primary px-4 py-2.5 rounded-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isGettingVariations ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Generating variations...</>
                            ) : (
                                <><Wand2 className="w-4 h-4 text-accent" /> Get Variations</>
                            )}
                        </button>
                    </section>

                    {/* Variations List */}
                    {variations.length > 0 && (
                        <section className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-text-secondary">{variations.filter(v => v.selected).length}/{variations.length} selected</span>
                                <div className="flex gap-2">
                                    <button onClick={selectAllVariations} className="text-[10px] text-accent hover:underline">Select All</button>
                                    <button onClick={deselectAllVariations} className="text-[10px] text-text-tertiary hover:text-text-secondary">Deselect All</button>
                                </div>
                            </div>

                            <div className="space-y-1.5 max-h-[280px] overflow-y-auto scrollbar-thin pr-1">
                                {variations.map(v => (
                                    <div key={v.id} className={cn(
                                        "rounded-[8px] border p-2.5 transition-all cursor-pointer",
                                        v.selected ? "border-accent-border bg-accent-subtle/50" : "border-border-default bg-bg-elevated hover:border-border-strong"
                                    )}>
                                        <div className="flex items-start gap-2">
                                            {/* Checkbox */}
                                            <button
                                                onClick={() => toggleVariation(v.id)}
                                                className={cn(
                                                    "mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
                                                    v.selected ? "bg-accent border-accent" : "border-border-strong bg-transparent"
                                                )}
                                            >
                                                {v.selected && <CheckCircle className="w-3 h-3 text-white" />}
                                            </button>

                                            {/* Prompt text */}
                                            <div className="flex-1 min-w-0">
                                                {editingVariation === v.id ? (
                                                    <textarea
                                                        defaultValue={v.prompt}
                                                        autoFocus
                                                        rows={3}
                                                        className="w-full bg-bg-base border border-accent rounded-[6px] px-2 py-1 text-xs text-text-primary focus:outline-none resize-none"
                                                        onBlur={e => updateVariation(v.id, e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); updateVariation(v.id, (e.target as HTMLTextAreaElement).value); } }}
                                                    />
                                                ) : (
                                                    <p
                                                        className={cn("text-xs leading-relaxed", expandedVariation === v.id ? "" : "line-clamp-2")}
                                                        onClick={() => setExpandedVariation(expandedVariation === v.id ? null : v.id)}
                                                    >
                                                        {v.prompt}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-0.5 flex-shrink-0">
                                                <button onClick={() => setEditingVariation(v.id)} className="p-1 rounded hover:bg-bg-overlay text-text-tertiary hover:text-accent transition-colors">
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                                <button onClick={() => deleteVariation(v.id)} className="p-1 rounded hover:bg-bg-overlay text-text-tertiary hover:text-danger transition-colors">
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                {/* ── RIGHT PANEL ────────────────────────────── */}
                <div className="flex-1 pl-6 space-y-6">

                    {/* Model Selection */}
                    <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">AI Model</h3>
                        <div className="grid grid-cols-2 gap-2">
                            {isLoadingModels ? (
                                Array.from({ length: 4 }).map((_, i) => (
                                    <div key={i} className="h-[90px] rounded-[10px] bg-bg-elevated skeleton-shimmer border border-border-default" />
                                ))
                            ) : (
                                models.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => setModel(m.id)}
                                        className={cn(
                                            "flex flex-col gap-1.5 p-3 rounded-[10px] border text-left transition-all",
                                            model === m.id
                                                ? "border-accent bg-accent-subtle"
                                                : "border-border-default bg-bg-elevated hover:border-border-strong"
                                        )}
                                    >
                                        <p className={cn("text-sm font-medium", model === m.id ? "text-accent" : "text-text-primary")}>{m.name}</p>
                                        <p className="text-xs text-text-tertiary">{m.description}</p>
                                        <div className="mt-1">
                                            {m.strength === 'general' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-overlay text-text-secondary border border-border-default">General</span>}
                                            {m.strength === 'speed' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success-subtle text-success border border-[rgba(34,197,94,0.20)]">⚡ Fast</span>}
                                            {m.strength === 'typography' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning-subtle text-warning border border-[rgba(234,179,8,0.20)]">T Typography</span>}
                                            {m.strength === 'vector' && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-subtle text-accent border border-accent/20">◈ Vector</span>}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </section>

                    {/* Settings */}
                    <section>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-3">Settings</h3>
                        <div className="bg-bg-elevated rounded-[10px] border border-border-default p-4 space-y-4">
                            <div>
                                <label className="text-xs text-text-secondary block mb-1.5">Aspect Ratio</label>
                                <select
                                    value={imageSize}
                                    onChange={e => setImageSize(e.target.value)}
                                    className="w-full bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                                >
                                    <option value="square_hd">Square HD (1024×1024)</option>
                                    <option value="portrait_4_3">Portrait 4:3 (768×1024)</option>
                                    <option value="landscape_4_3">Landscape 4:3 (1024×768)</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Generate Button */}
                    <button
                        onClick={startGeneration}
                        disabled={selectedCount === 0 || isGenerating}
                        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-4 rounded-[10px] font-bold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isGenerating ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</>
                        ) : (
                            <>Generate ({selectedCount}) <ArrowRight className="w-5 h-5" /></>
                        )}
                    </button>

                    {/* Success / Gallery link */}
                    {lastJobId && !isGenerating && (
                        <div className="rounded-[10px] border border-[rgba(34,197,94,0.20)] bg-success-subtle p-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-success" />
                                <div>
                                    <p className="text-sm font-medium text-success">Images queued successfully</p>
                                    <p className="text-[10px] text-text-tertiary font-mono mt-0.5">{lastJobId}</p>
                                </div>
                            </div>
                            <Link
                                href={`/dashboard/gallery?jobId=${lastJobId}`}
                                className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-[8px] text-sm font-medium transition-colors"
                            >
                                View in Gallery <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>
                    )}

                    {/* Empty state hint */}
                    {selectedCount === 0 && !lastJobId && (
                        <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                            <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                            <p className="text-sm">Upload references & generate prompts</p>
                            <p className="text-xs mt-1">Or write a prompt directly in the left panel</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
