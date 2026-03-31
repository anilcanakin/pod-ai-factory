'use client';

import { useState, useRef } from 'react';
import { apiSeo, type EtsySEO } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Upload, X, Sparkles, Loader2, Copy, Check, Tag, AlertTriangle
} from 'lucide-react';

export function SEOClient() {
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [keyword, setKeyword] = useState('');
    const [result, setResult] = useState<EtsySEO | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            toast.error('Please upload an image file.');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const img = new window.Image();
            img.onload = () => {
                const MAX = 1024;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else { w = Math.round(w * MAX / h); h = MAX; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, 0, 0, w, h);
                    setSourceImage(canvas.toDataURL('image/jpeg', 0.8));
                } else {
                    setSourceImage(reader.result as string);
                }
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    };

    const generate = async () => {
        if (!sourceImage) return toast.error('Please upload an image first.');
        setIsGenerating(true);
        setResult(null);
        try {
            const data = await apiSeo.generate(sourceImage, keyword || undefined);
            setResult(data);
            toast.success('SEO content generated!');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Generation failed');
        } finally {
            setIsGenerating(false);
        }
    };

    const copyField = async (text: string, field: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(null), 2000);
        toast.success('Copied!');
    };

    const copyAll = async () => {
        if (!result) return;
        const text = `${result.title}\n\n${result.description}\n\n${result.tags.join(', ')}`;
        await navigator.clipboard.writeText(text);
        setCopied('all');
        setTimeout(() => setCopied(null), 2000);
        toast.success('All copied!');
    };

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-text-primary">
                    Etsy SEO Generator
                </h1>
                <p className="text-sm text-text-secondary mt-1">
                    Upload your design → get optimized title, description & 13 tags
                </p>
            </div>

            {/* Input section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Image upload */}
                {!sourceImage ? (
                    <div
                        className={cn(
                            "border-2 border-dashed rounded-[12px] p-10 text-center cursor-pointer transition-all",
                            isDragging
                                ? "border-accent bg-accent-subtle"
                                : "border-border-default hover:border-border-strong bg-bg-elevated"
                        )}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => e.target.files?.[0] && processFile(e.target.files[0])}
                        />
                        <Upload className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
                        <p className="text-sm font-medium text-text-primary mb-1">Upload design</p>
                        <p className="text-xs text-text-tertiary">JPG, PNG, WEBP</p>
                    </div>
                ) : (
                    <div className="relative rounded-[12px] overflow-hidden border border-border-default bg-bg-elevated">
                        <img src={sourceImage} alt="Design" className="w-full object-contain max-h-[200px]" />
                        <button
                            onClick={() => { setSourceImage(null); setResult(null); }}
                            className="absolute top-2 right-2 p-1.5 bg-bg-overlay/80 hover:bg-danger-subtle text-text-secondary hover:text-danger rounded-[6px] border border-border-default transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* Settings */}
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-medium text-text-secondary block mb-1.5">
                            Focus Keyword <span className="text-text-tertiary">(optional)</span>
                        </label>
                        <input
                            type="text"
                            value={keyword}
                            onChange={e => setKeyword(e.target.value)}
                            placeholder="e.g. vintage eagle shirt, patriotic gift"
                            className="w-full bg-bg-elevated border border-border-default rounded-[8px] px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent transition-colors"
                        />
                        <p className="text-[10px] text-text-tertiary mt-1">
                            Adding a keyword helps target specific buyer searches
                        </p>
                    </div>

                    <button
                        onClick={generate}
                        disabled={!sourceImage || isGenerating}
                        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-[10px] font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {isGenerating ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Generating SEO...</>
                        ) : (
                            <><Sparkles className="w-4 h-4" /> Generate SEO Content</>
                        )}
                    </button>

                    {result && (
                        <button
                            onClick={copyAll}
                            className="w-full flex items-center justify-center gap-2 bg-bg-elevated hover:bg-bg-overlay text-text-primary px-4 py-2.5 rounded-[10px] text-sm border border-border-default transition-colors"
                        >
                            {copied === 'all'
                                ? <><Check className="w-4 h-4 text-success" /> Copied!</>
                                : <><Copy className="w-4 h-4" /> Copy All (Etsy format)</>
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* Results */}
            {result && (
                <div className="space-y-4">

                    {/* Live Etsy Data */}
                    {result.etsySuggestions && result.etsySuggestions.length > 0 && (
                        <div className="bg-bg-elevated rounded-[12px] border border-border-default overflow-hidden">
                            <div className="px-4 py-3 border-b border-border-default bg-bg-surface">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-bg-overlay text-text-secondary border border-border-default uppercase tracking-wider">
                                        Live Etsy Data
                                    </span>
                                    <span className="text-xs text-text-tertiary">
                                        Real searches from Etsy buyers
                                    </span>
                                </div>
                            </div>
                            <div className="p-4">
                                <div className="flex flex-wrap gap-2">
                                    {result.etsySuggestions.map((kw, i) => (
                                        <button
                                            key={i}
                                            onClick={() => copyField(kw, `kw-${i}`)}
                                            className="flex items-center gap-1 px-2.5 py-1 bg-success-subtle hover:bg-success text-success hover:text-white text-xs rounded-[6px] border border-[rgba(34,197,94,0.20)] transition-colors font-mono"
                                            title="Click to copy"
                                        >
                                            {copied === `kw-${i}`
                                                ? <Check className="w-3 h-3" />
                                                : <Tag className="w-3 h-3" />
                                            }
                                            {kw}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-text-tertiary mt-2">
                                    These are real searches from Etsy's autocomplete — use them in your listings
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Title */}
                    <div className="bg-bg-elevated rounded-[12px] border border-border-default overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-surface">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-subtle text-accent border border-accent/20 uppercase tracking-wider">Title</span>
                                <span className="text-xs text-text-tertiary font-mono">{result.charCount}/140</span>
                                <div className="w-24 h-1 bg-bg-overlay rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-accent rounded-full transition-all"
                                        style={{ width: `${(result.charCount / 140) * 100}%` }}
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => copyField(result.title, 'title')}
                                className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-accent transition-colors"
                            >
                                {copied === 'title' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                                Copy
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-text-primary leading-relaxed">{result.title}</p>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="bg-bg-elevated rounded-[12px] border border-border-default overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-surface">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-success-subtle text-success border border-[rgba(34,197,94,0.20)] uppercase tracking-wider">Description</span>
                            </div>
                            <button
                                onClick={() => copyField(result.description, 'desc')}
                                className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-accent transition-colors"
                            >
                                {copied === 'desc' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                                Copy
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{result.description}</p>
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="bg-bg-elevated rounded-[12px] border border-border-default overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-surface">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-warn-subtle text-warn border border-[rgba(245,158,11,0.20)] uppercase tracking-wider">Tags</span>
                                <span className="text-xs text-text-tertiary">{result.tags.length}/13 tags</span>
                            </div>
                            <button
                                onClick={() => copyField(result.tags.join(', '), 'tags')}
                                className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-accent transition-colors"
                            >
                                {copied === 'tags' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                                Copy
                            </button>
                        </div>
                        <div className="p-4">
                            <div className="flex flex-wrap gap-2">
                                {result.tags.map((tag, i) => (
                                    <button
                                        key={i}
                                        onClick={() => copyField(tag, `tag-${i}`)}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-bg-overlay hover:bg-accent-subtle text-text-secondary hover:text-accent text-xs rounded-[6px] border border-border-default hover:border-accent/30 transition-colors font-mono"
                                        title="Click to copy"
                                    >
                                        {copied === `tag-${i}` ? <Check className="w-3 h-3 text-success" /> : <Tag className="w-3 h-3" />}
                                        {tag}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-text-tertiary mt-3">
                                Click any tag to copy individually
                            </p>
                        </div>
                    </div>

                    {/* Etsy Checklist */}
                    {(() => {
                        const titleOk = result.title.length <= 140;
                        const tagOk = result.tags.length === 13;
                        const descWords = result.description.trim().split(/\s+/).filter(Boolean).length;
                        const descOk = descWords >= 150 && descWords <= 300;
                        const allText = (result.title + ' ' + result.description).toLowerCase();
                        const wordFreq: Record<string, number> = {};
                        allText.split(/\s+/).forEach(w => {
                            const clean = w.replace(/[^a-z]/g, '');
                            if (clean.length > 3) wordFreq[clean] = (wordFreq[clean] || 0) + 1;
                        });
                        const stuffed = Object.entries(wordFreq).filter(([, c]) => c > 5).map(([w]) => w);
                        const noStuffing = stuffed.length === 0;

                        const CheckRow = ({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) => (
                            <div className="flex items-center gap-2.5 text-xs">
                                {ok ? (
                                    <Check className="w-3.5 h-3.5 text-success shrink-0" />
                                ) : warn ? (
                                    <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0" />
                                ) : (
                                    <X className="w-3.5 h-3.5 text-danger shrink-0" />
                                )}
                                <span className={ok ? 'text-text-secondary' : warn ? 'text-warn' : 'text-danger'}>{label}</span>
                            </div>
                        );

                        return (
                            <div className="bg-bg-elevated rounded-[12px] border border-border-default overflow-hidden">
                                <div className="px-4 py-3 border-b border-border-default bg-bg-surface">
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-bg-overlay text-text-secondary border border-border-default uppercase tracking-wider">
                                        Etsy Checklist
                                    </span>
                                </div>
                                <div className="p-4 space-y-2.5">
                                    <CheckRow ok={titleOk} label={titleOk ? `Title ≤ 140 chars (${result.title.length})` : `Title too long — ${result.title.length}/140 chars`} />
                                    <CheckRow ok={tagOk} label={tagOk ? '13 tags used ✓' : `Only ${result.tags.length} tags — Etsy allows 13`} />
                                    <CheckRow ok={descOk} warn={descWords < 150} label={descOk ? `Description ${descWords} words (150–300 ✓)` : descWords < 150 ? `Description too short — ${descWords} words (aim for 150+)` : `Description too long — ${descWords} words (keep ≤ 300)`} />
                                    <CheckRow ok={noStuffing} warn={!noStuffing} label={noStuffing ? 'No keyword stuffing detected' : `Possible stuffing: ${stuffed.slice(0, 3).join(', ')}`} />
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
