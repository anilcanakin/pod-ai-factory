'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFactory, apiGallery, apiTools, apiSeo } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Loader2, ArrowRight, Upload, X, Sparkles, Wand2,
    Zap, CheckCircle, Image as ImageIcon, Cpu, Eye, Palette,
    Brush, Layers, ChevronDown, ChevronUp, Pencil, Trash2,
    Scissors, ZoomIn, Download, RotateCcw, Tag, Copy, Clock
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const STYLE_PRESETS = [
  { 
    id: 'vintage', 
    label: 'Vintage', 
    emoji: '🏚️',
    prompt: 'vintage distressed t-shirt graphic, retro worn texture, faded colors, aged look, screen print style, pure white background'
  },
  { 
    id: 'minimalist', 
    label: 'Minimal', 
    emoji: '◻️',
    prompt: 'minimalist line art illustration, clean simple lines, single color, modern design, pure white background, vector style'
  },
  { 
    id: 'grunge', 
    label: 'Grunge', 
    emoji: '⚡',
    prompt: 'grunge punk rock t-shirt design, rough edges, distressed texture, bold aggressive style, pure white background, screen print'
  },
  { 
    id: 'retro', 
    label: 'Retro', 
    emoji: '🌈',
    prompt: 'retro 80s style graphic, bold colors, geometric shapes, neon accents, vintage typography influence, pure white background'
  },
  { 
    id: 'botanical', 
    label: 'Botanical', 
    emoji: '🌿',
    prompt: 'botanical illustration style, detailed line art, nature elements, elegant floral design, pure white background, fine details'
  },
  { 
    id: 'collegiate', 
    label: 'Collegiate', 
    emoji: '🏆',
    prompt: 'collegiate varsity style, bold athletic typography, shield or badge composition, classic American sports aesthetic, pure white background'
  },
  { 
    id: 'streetwear', 
    label: 'Street', 
    emoji: '🔥',
    prompt: 'streetwear urban graphic, bold statement design, modern youth culture, high contrast, pure white background, screen print ready'
  },
  { 
    id: 'watercolor', 
    label: 'Watercolor', 
    emoji: '🎨',
    prompt: 'watercolor illustration style, soft flowing colors, artistic brushwork, delicate details, pure white background, artistic print'
  },
];

const PROMPT_TEMPLATES = [
  {
    label: 'T-Shirt Graphic',
    template: 'A {STYLE} t-shirt graphic of a {SUBJECT}, pure white background (#FFFFFF), vector clean edges, screen print ready, high contrast, no background scenery'
  },
  {
    label: 'Badge / Emblem',
    template: 'A {STYLE} badge emblem design featuring {SUBJECT}, circular or shield composition, vintage typography, pure white background, perfect for screen printing'
  },
  {
    label: 'Minimal Icon',
    template: 'A minimalist {STYLE} icon of a {SUBJECT}, single line art, clean simple design, pure white background, scalable vector style'
  },
  {
    label: 'Typography + Graphic',
    template: 'A {STYLE} t-shirt design combining {SUBJECT} illustration with bold typography, pure white background, screen print style, high contrast'
  },
  {
    label: 'Nature / Wildlife',
    template: 'A detailed {STYLE} illustration of a {SUBJECT} in natural pose, pure white background, fine line art, suitable for nature-themed apparel'
  },
  {
    label: 'Retro Mascot',
    template: 'A retro vintage mascot character of a {SUBJECT}, bold outline, limited color palette, pure white background, classic American sports graphic style'
  },
];

export function FactoryClient() {
    const router = useRouter();

    // ── State ──────────────────────────────────────────────────
    const [refImages, setRefImages] = useState<string[]>([]);
    const [mainPrompt, setMainPrompt] = useState('');
    const [variations, setVariations] = useState<{ id: string; prompt: string; selected: boolean }[]>([]);
    const [variationMode, setVariationMode] = useState<'subject' | 'style' | 'color'>('subject');
    const [variationCount, setVariationCount] = useState(4);
    const [model, setModel] = useState('fal-ai/flux/dev');
    
    const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, watermark, text, background, scenery');
    const [activePreset, setActivePreset] = useState<string | null>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    
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

    // Üretilen görseller
    const [generatedImages, setGeneratedImages] = useState<Array<{
        id: string;
        imageUrl: string;
        status: string;
        promptUsed?: string;
    }>>([]);
    const [isPolling, setIsPolling] = useState(false);
    const [processingImageId, setProcessingImageId] = useState<string | null>(null);
    const [bgRemovedUrls, setBgRemovedUrls] = useState<Record<string, string>>({});
    const [upscaledUrls, setUpscaledUrls] = useState<Record<string, string>>({});
    const [seoResults, setSeoResults] = useState<Record<string, { title: string; description: string; tags: string[]; charCount: number }>>({});
    const [isGeneratingSeo, setIsGeneratingSeo] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Prompt history
    const [showHistory, setShowHistory] = useState(false);
    const [promptHistory, setPromptHistory] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try { return JSON.parse(localStorage.getItem('prompt_history') || '[]'); } catch { return []; }
    });

    const saveToHistory = (prompt: string) => {
        if (!prompt.trim()) return;
        const updated = [prompt.trim(), ...promptHistory.filter(p => p !== prompt.trim())].slice(0, 10);
        setPromptHistory(updated);
        localStorage.setItem('prompt_history', JSON.stringify(updated));
    };

    const clearHistory = () => {
        setPromptHistory([]);
        localStorage.removeItem('prompt_history');
        setShowHistory(false);
    };

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
                    setRefImages(prev => [...prev, compressedBase64].slice(0, 8));
                } else {
                    setRefImages(prev => [...prev, reader.result as string].slice(0, 8));
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

    const downloadImage = async (url: string, filename: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(objectUrl);
        } catch {
            toast.error('Download failed');
        }
    };

    const handleGenerateSeo = async (imgId: string, imgUrl: string) => {
        setIsGeneratingSeo(imgId);
        try {
            const data = await apiSeo.generate(imgUrl);
            setSeoResults(prev => ({ ...prev, [imgId]: data }));
            toast.success('SEO content generated!');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'SEO generation failed');
        } finally {
            setIsGeneratingSeo(null);
        }
    };

    // ── API Calls ─────────────────────────────────────────────
    const analyzeImages = async () => {
        if (refImages.length === 0) return toast.error('Please upload at least one reference image.');
        setIsAnalyzing(true);
        try {
            if (refImages.length === 1) {
                // Single image: existing behavior — set main prompt
                const data = await apiFactory.analyze({ referenceImageIds: refImages });
                setMainPrompt(data.prompt);
                if (data.isSynthetic || data.provider === 'synthetic') {
                    toast.warning('Vision APIs unavailable — using synthetic prompt');
                } else {
                    toast.success(`Analyzed with ${data.provider === 'anthropic' ? 'Claude' : data.provider === 'openai' ? 'GPT-4o' : data.provider === 'gemini' ? 'Gemini' : 'AI'}`);
                }
            } else {
                // Multiple images: analyze each separately → set all as variations
                const prompts: string[] = [];
                for (let i = 0; i < refImages.length; i++) {
                    toast.info(`Analyzing image ${i + 1} of ${refImages.length}…`);
                    const data = await apiFactory.analyze({ referenceImageIds: [refImages[i]] });
                    prompts.push(data.prompt);
                }
                setMainPrompt(prompts[0]);
                setVariations(prompts.map((p, i) => ({
                    id: `var-${Date.now()}-${i}`,
                    prompt: p,
                    selected: true,
                })));
                toast.success(`${prompts.length} prompts extracted — ready to generate!`);
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
        if (mainPrompt.trim()) saveToHistory(mainPrompt);
        setIsGenerating(true);
        try {
            const data = await apiFactory.generate({
                prompts: selectedPrompts,
                model,
                imageSize,
                negativePrompt
            });
            setLastJobId(data.jobId);
            toast.success(`${data.imageCount} images queued for generation!`);
            setGeneratedImages([]); // sıfırla
            setBgRemovedUrls({});
            setUpscaledUrls({});
            startPolling(data.jobId); // polling başlat
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setIsGenerating(false);
        }
    };

    const startPolling = (jobId: string) => {
        setIsPolling(true);
        const interval = setInterval(async () => {
            try {
                const images = await apiGallery.getImages(jobId);
                setGeneratedImages(images.filter(img => 
                    img.imageUrl && img.imageUrl !== 'PENDING'
                ));
                
                // Hepsi tamamlandıysa polling durdur
                const allDone = images.every(img => 
                    img.status === 'COMPLETED' || 
                    img.status === 'FAILED' ||
                    img.status === 'APPROVED'
                );
                if (allDone && images.length > 0) {
                    clearInterval(interval);
                    setIsPolling(false);
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 3000); // 3 saniyede bir kontrol
        
        // 5 dakika sonra zorla durdur
        setTimeout(() => {
            clearInterval(interval);
            setIsPolling(false);
        }, 300000);
    };

    const handleRemoveBg = async (imgId: string, imgUrl: string, model: 'birefnet' | 'bria' = 'birefnet') => {
        setProcessingImageId(imgId + '-bg');
        try {
            const result = await apiTools.removeBg(imgUrl, model);
            setBgRemovedUrls(prev => ({ ...prev, [imgId]: result.url }));
            toast.success(`Background removed — ${result.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'BG removal failed');
        } finally {
            setProcessingImageId(null);
        }
    };

    const handleUpscale = async (imgId: string, imgUrl: string) => {
        setProcessingImageId(imgId + '-up');
        try {
            const result = await apiTools.upscale(imgUrl, 4);
            setUpscaledUrls(prev => ({ ...prev, [imgId]: result.url }));
            toast.success(`Upscaled 4x — ${result.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Upscale failed');
        } finally {
            setProcessingImageId(null);
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

                        {refImages.length < 8 && (
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
                                <p className="text-[10px] text-text-tertiary mt-0.5">JPG, PNG up to 10MB · Max 8 · Each image analyzed separately</p>
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
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary block">Generation Prompt</label>

                            <div className="flex items-center gap-1.5">
                            {/* History Dropdown Button */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowHistory(!showHistory)}
                                    className="flex items-center gap-1.5 text-[10px] font-medium text-text-tertiary hover:text-text-primary transition-colors bg-bg-elevated/50 px-2.5 py-1 rounded-[6px] border border-border-default"
                                >
                                    <Clock className="w-3 h-3" /> History {promptHistory.length > 0 && <span className="text-accent">({promptHistory.length})</span>}
                                </button>
                                {showHistory && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowHistory(false)} />
                                        <div className="absolute top-full right-0 mt-2 w-72 bg-bg-elevated border border-border-strong rounded-[10px] shadow-xl z-20 py-1.5 overflow-hidden">
                                            <div className="px-3 py-1.5 border-b border-border-default mb-1.5">
                                                <p className="text-xs font-semibold text-text-primary">Prompt History</p>
                                                <p className="text-[10px] text-text-tertiary">Click to restore a previous prompt</p>
                                            </div>
                                            {promptHistory.length === 0 ? (
                                                <p className="px-3 py-3 text-xs text-text-tertiary">No history yet. Generate something first.</p>
                                            ) : (
                                                <div className="max-h-[250px] overflow-y-auto scrollbar-thin">
                                                    {promptHistory.map((p, i) => (
                                                        <button
                                                            key={i}
                                                            className="w-full text-left px-3 py-2 hover:bg-bg-overlay transition-colors border-b border-border-default/50 last:border-0"
                                                            onClick={() => { setMainPrompt(p); setActivePreset(null); setShowHistory(false); }}
                                                        >
                                                            <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">{p}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="px-3 pt-1.5 border-t border-border-default mt-1">
                                                <button onClick={clearHistory} className="text-[10px] text-danger hover:underline">Clear history</button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Templates Dropdown Button */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowTemplates(!showTemplates)}
                                    className="flex items-center gap-1.5 text-[10px] font-medium text-accent hover:text-accent-hover transition-colors bg-accent-subtle/50 px-2.5 py-1 rounded-[6px] border border-accent/20"
                                >
                                    <Layers className="w-3 h-3" /> Templates
                                </button>

                                {showTemplates && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setShowTemplates(false)} />
                                        <div className="absolute top-full right-0 mt-2 w-72 bg-bg-elevated border border-border-strong rounded-[10px] shadow-xl z-20 py-1.5 overflow-hidden">
                                            <div className="px-3 py-1.5 border-b border-border-default mb-1.5">
                                                <p className="text-xs font-semibold text-text-primary">Prompt Templates</p>
                                                <p className="text-[10px] text-text-tertiary">Click to fill. Edit placeholders manually.</p>
                                            </div>
                                            <div className="max-h-[250px] overflow-y-auto scrollbar-thin">
                                                {PROMPT_TEMPLATES.map((tpl, i) => (
                                                    <button
                                                        key={i}
                                                        className="w-full text-left px-3 py-2 hover:bg-bg-overlay transition-colors group border-b border-border-default/50 last:border-0"
                                                        onClick={() => {
                                                            setMainPrompt(tpl.template);
                                                            setActivePreset(null);
                                                            setShowTemplates(false);
                                                        }}
                                                    >
                                                        <p className="text-xs font-medium text-text-primary group-hover:text-accent transition-colors">{tpl.label}</p>
                                                        <p className="text-[10px] text-text-secondary line-clamp-2 mt-0.5 leading-relaxed">{tpl.template}</p>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            </div>{/* end buttons row */}
                        </div>

                        {/* Style Presets (pill list) */}
                        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-2 mb-2 w-full">
                            {STYLE_PRESETS.map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => {
                                        setMainPrompt(preset.prompt);
                                        setActivePreset(preset.id);
                                    }}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border shrink-0",
                                        activePreset === preset.id
                                            ? "bg-accent-subtle border-accent text-accent"
                                            : "bg-bg-elevated border-border-default text-text-secondary hover:border-border-strong"
                                    )}
                                >
                                    <span>{preset.emoji}</span>
                                    <span>{preset.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="relative">
                            <textarea
                                value={mainPrompt}
                                onChange={e => {
                                    setMainPrompt(e.target.value);
                                    setActivePreset(null);
                                }}
                                rows={6}
                                className="w-full bg-bg-elevated border border-border-default rounded-[10px] px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent resize-none"
                                placeholder="Upload a reference image and click 'Get AI Prompt', or write your own..."
                            />
                            <span className="absolute bottom-2 right-3 text-[10px] text-text-tertiary tabular-nums">
                                {mainPrompt.length}
                            </span>
                        </div>
                    </section>

                    {/* Negative Prompt */}
                    <section>
                        <label className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2 block">Negative Prompt</label>
                        <textarea
                            value={negativePrompt}
                            onChange={e => setNegativePrompt(e.target.value)}
                            rows={3}
                            className="w-full bg-bg-elevated border border-border-default rounded-[10px] px-3 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent resize-none"
                            placeholder="blurry, low quality, watermark..."
                        />
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

                    {/* Generated Results */}
                    {(generatedImages.length > 0 || isPolling) && (
                        <section className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                                    Results
                                </h3>
                                {isPolling && (
                                    <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Generating...
                                    </div>
                                )}
                                {!isPolling && generatedImages.length > 0 && (
                                    <span className="text-xs text-text-tertiary">
                                        {generatedImages.length} image{generatedImages.length > 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            <div className="space-y-3">
                                {generatedImages.map(img => {
                                    const displayUrl = upscaledUrls[img.id] || bgRemovedUrls[img.id] || img.imageUrl;
                                    const isBgProcessing = processingImageId === img.id + '-bg';
                                    const isUpProcessing = processingImageId === img.id + '-up';
                                    const hasBgRemoved = !!bgRemovedUrls[img.id];
                                    const hasUpscaled = !!upscaledUrls[img.id];

                                    return (
                                        <div key={img.id} className="bg-bg-elevated rounded-[10px] border border-border-default overflow-hidden">
                                            {/* Görsel */}
                                            <div className="relative aspect-square w-full bg-bg-base">
                                                <img
                                                    src={displayUrl}
                                                    alt="Generated"
                                                    className="w-full h-full object-contain"
                                                />
                                                {/* Status badges */}
                                                <div className="absolute top-2 left-2 flex gap-1">
                                                    {hasBgRemoved && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-success-subtle text-success border border-[rgba(34,197,94,0.20)] font-medium">
                                                            BG Removed
                                                        </span>
                                                    )}
                                                    {hasUpscaled && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-subtle text-accent border border-accent/20 font-medium">
                                                            4x Upscaled
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Action buttons */}
                                            <div className="p-2 flex items-center gap-1.5 flex-wrap">
                                                {/* Remove BG */}
                                                <button
                                                    onClick={() => handleRemoveBg(img.id, upscaledUrls[img.id] || img.imageUrl)}
                                                    disabled={!!processingImageId}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[6px] border border-border-default transition-colors disabled:opacity-40"
                                                >
                                                    {isBgProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                                                    Remove BG
                                                </button>

                                                {/* Bria Premium */}
                                                <button
                                                    onClick={() => handleRemoveBg(img.id, upscaledUrls[img.id] || img.imageUrl, 'bria')}
                                                    disabled={!!processingImageId}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-accent-subtle text-text-tertiary hover:text-accent text-xs rounded-[6px] border border-border-default hover:border-accent/30 transition-colors disabled:opacity-40"
                                                >
                                                    {isBgProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                                                    Bria Pro
                                                </button>

                                                {/* Upscale */}
                                                <button
                                                    onClick={() => handleUpscale(img.id, bgRemovedUrls[img.id] || img.imageUrl)}
                                                    disabled={!!processingImageId}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[6px] border border-border-default transition-colors disabled:opacity-40"
                                                >
                                                    {isUpProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ZoomIn className="w-3 h-3" />}
                                                    Upscale 4x
                                                </button>

                                                {/* SEO */}
                                                <button
                                                    onClick={() => handleGenerateSeo(img.id, displayUrl)}
                                                    disabled={!!processingImageId || isGeneratingSeo === img.id}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-accent-subtle text-text-secondary hover:text-accent text-xs rounded-[6px] border border-border-default hover:border-accent/30 transition-colors disabled:opacity-40"
                                                >
                                                    {isGeneratingSeo === img.id
                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        : <Tag className="w-3.5 h-3.5" />
                                                    }
                                                    SEO
                                                </button>

                                                {/* Download current */}
                                                <button
                                                    onClick={() => {
                                                        const filename = hasUpscaled
                                                            ? `upscaled-${img.id}.png`
                                                            : hasBgRemoved
                                                            ? `no-bg-${img.id}.png`
                                                            : `generated-${img.id}.png`;
                                                        downloadImage(displayUrl, filename);
                                                    }}
                                                    className="ml-auto flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[6px] border border-border-default transition-colors"
                                                >
                                                    <Download className="w-3 h-3" />
                                                </button>

                                                {/* To Mockup */}
                                                <button
                                                    onClick={() => router.push(`/dashboard/mockups?designUrl=${encodeURIComponent(displayUrl)}&designImageId=${img.id}`)}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-accent-subtle text-text-secondary hover:text-accent text-xs rounded-[6px] border border-border-default hover:border-accent/30 transition-colors"
                                                >
                                                    <Layers className="w-3 h-3" />
                                                    To Mockup
                                                </button>

                                                {/* To Remove BG */}
                                                <button
                                                    onClick={() => router.push(`/dashboard/remove-bg?imageUrl=${encodeURIComponent(displayUrl)}`)}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-overlay hover:bg-bg-surface text-text-secondary hover:text-text-primary text-xs rounded-[6px] border border-border-default transition-colors"
                                                >
                                                    <Scissors className="w-3 h-3" />
                                                    To Remove BG
                                                </button>
                                            </div>

                                            {/* SEO result panel */}
                                            {seoResults[img.id] && (
                                                <div className="p-2 border-t border-border-default space-y-1.5">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-0.5">Title</p>
                                                            <p className="text-xs text-text-primary line-clamp-2">{seoResults[img.id].title}</p>
                                                        </div>
                                                        <button
                                                            onClick={() => { navigator.clipboard.writeText(seoResults[img.id].title); toast.success('Title copied!'); }}
                                                            className="p-1 text-text-tertiary hover:text-accent transition-colors flex-shrink-0"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-[10px] text-text-tertiary">{seoResults[img.id].tags.length} tags ready</p>
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => { navigator.clipboard.writeText(seoResults[img.id].tags.join(', ')); toast.success('Tags copied!'); }}
                                                                className="text-[10px] px-2 py-0.5 bg-accent-subtle text-accent rounded border border-accent/20 hover:bg-accent hover:text-white transition-colors"
                                                            >
                                                                Copy Tags
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    const text = `TITLE:\n${seoResults[img.id].title}\n\nDESCRIPTION:\n${seoResults[img.id].description}\n\nTAGS:\n${seoResults[img.id].tags.join(', ')}`;
                                                                    navigator.clipboard.writeText(text);
                                                                    toast.success('All copied!');
                                                                }}
                                                                className="text-[10px] px-2 py-0.5 bg-bg-overlay text-text-secondary rounded border border-border-default hover:bg-bg-elevated transition-colors"
                                                            >
                                                                Copy All
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Polling placeholder'lar */}
                                {isPolling && generatedImages.length === 0 && (
                                    Array.from({ length: 2 }).map((_, i) => (
                                        <div key={i} className="aspect-square rounded-[10px] bg-bg-elevated border border-border-default skeleton-shimmer" />
                                    ))
                                )}
                            </div>
                        </section>
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
