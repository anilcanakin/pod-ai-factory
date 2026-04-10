'use client';

import { useState, useRef } from 'react';
import { apiTools } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Upload, X, ZoomIn, Loader2, Download } from 'lucide-react';

export function UpscaleClient() {
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [result, setResult] = useState<string | null>(null);
    const [resultModel, setResultModel] = useState<string>('aurasr-v2');
    const [scale, setScale] = useState<number>(4);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
            toast.error('Please upload an image file.');
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            setSourceImage(reader.result as string);
            setResult(null);
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
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

    const upscaleImage = async () => {
        if (!sourceImage) return toast.error('Please upload an image first.');
        setIsProcessing(true);
        try {
            const res = await apiTools.upscale(sourceImage, scale);
            setResult(res.url);
            setResultModel(res.model ?? 'aurasr-v2');
            if (res.savedImageId) {
                toast.success('Saved to gallery — ready for mockup!');
            } else {
                toast.success(`Upscaled ${res.scale} — ${res.model}`);
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Upscale failed');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-text-primary">
                    AI Upscaler
                </h1>
                <p className="text-sm text-text-secondary mt-1">
                    Enhance image resolution up to 4x with AuraSR v2
                </p>
            </div>

            {!sourceImage ? (
                <div
                    className={cn(
                        "border-2 border-dashed rounded-[12px] p-16 text-center cursor-pointer transition-all",
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
                    <ZoomIn className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm font-medium text-text-primary mb-1">
                        Drop your image here
                    </p>
                    <p className="text-xs text-text-tertiary">
                        JPG, PNG, WEBP — recommended max 1024px input
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Controls */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Scale selector */}
                        <div className="flex items-center gap-1 bg-bg-elevated rounded-[8px] border border-border-default p-1">
                            {[1, 2, 3, 4, 6, 8].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setScale(s)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-[6px] text-xs font-medium transition-all",
                                        scale === s
                                            ? "bg-accent text-white"
                                            : "text-text-secondary hover:text-text-primary"
                                    )}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={upscaleImage}
                            disabled={isProcessing}
                            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-[8px] text-sm font-medium transition-colors disabled:opacity-40"
                        >
                            {isProcessing
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Upscaling...</>
                                : <><ZoomIn className="w-4 h-4" /> Upscale {scale}x</>
                            }
                        </button>

                        <button
                            onClick={() => { setSourceImage(null); setResult(null); }}
                            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs text-text-tertiary hover:text-danger border border-border-default rounded-[8px] transition-colors"
                        >
                            <X className="w-3.5 h-3.5" /> Clear
                        </button>
                    </div>

                    {/* Before / After */}
                    <div className={cn(
                        "grid gap-4",
                        result ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 max-w-md"
                    )}>
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Original</p>
                            <div className="rounded-[10px] overflow-hidden border border-border-default bg-bg-elevated">
                                <img src={sourceImage} alt="Original" className="w-full object-contain max-h-[500px]" />
                            </div>
                        </div>

                        {result && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-accent uppercase tracking-wider">
                                    Upscaled {scale}x — AuraSR v2
                                </p>
                                <div className="rounded-[10px] overflow-hidden border border-accent/20 bg-bg-elevated">
                                    <img src={result} alt="Upscaled" className="w-full object-contain max-h-[500px]" />
                                </div>
                                
                                <button
                                    onClick={() => downloadImage(result!, `upscaled-${scale}x-${resultModel.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.png`)}
                                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-accent-subtle hover:bg-accent text-accent hover:text-white text-xs rounded-[8px] border border-accent/30 transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" /> Download
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
