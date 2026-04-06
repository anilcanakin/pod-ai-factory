'use client';

import { useState, useRef } from 'react';
import { apiTools } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Upload, X, Scissors, Loader2, Download } from 'lucide-react';

export function RemoveBgClient() {
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [sourceFile, setSourceFile] = useState<string | null>(null);
    const [resultBirefnet, setResultBirefnet] = useState<string | null>(null);
    const [resultBria, setResultBria] = useState<string | null>(null);
    const [resultPixelcut, setResultPixelcut] = useState<string | null>(null);
    const [isProcessingBirefnet, setIsProcessingBirefnet] = useState(false);
    const [isProcessingBria, setIsProcessingBria] = useState(false);
    const [isProcessingPixelcut, setIsProcessingPixelcut] = useState(false);
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
            setSourceFile(reader.result as string);
            setResultBirefnet(null);
            setResultBria(null);
            setResultPixelcut(null);
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

    const removeBg = async (model: 'birefnet' | 'bria' | 'pixelcut') => {
        if (!sourceImage) return toast.error('Please upload an image first.');

        if (model === 'birefnet') setIsProcessingBirefnet(true);
        else if (model === 'bria') setIsProcessingBria(true);
        else setIsProcessingPixelcut(true);

        try {
            const result = await apiTools.removeBg(sourceImage, model);
            if (model === 'birefnet') setResultBirefnet(result.url);
            else if (model === 'bria') setResultBria(result.url);
            else setResultPixelcut(result.url);
            toast.success(`Background removed — ${result.model}`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed');
        } finally {
            if (model === 'birefnet') setIsProcessingBirefnet(false);
            else if (model === 'bria') setIsProcessingBria(false);
            else setIsProcessingPixelcut(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-text-primary">
                    Background Removal
                </h1>
                <p className="text-sm text-text-secondary mt-1">
                    Remove backgrounds from any image instantly
                </p>
            </div>

            {/* Upload area */}
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
                    <Upload className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                    <p className="text-sm font-medium text-text-primary mb-1">
                        Drop your image here
                    </p>
                    <p className="text-xs text-text-tertiary">
                        JPG, PNG, WEBP — any size
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Action buttons */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            onClick={() => removeBg('birefnet')}
                            disabled={isProcessingBirefnet || isProcessingBria || isProcessingPixelcut}
                            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-[8px] text-sm font-medium transition-colors disabled:opacity-40"
                        >
                            {isProcessingBirefnet
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                : <><Scissors className="w-4 h-4" /> Remove BG (BiRefNet)</>
                            }
                        </button>
                        <button
                            onClick={() => removeBg('bria')}
                            disabled={isProcessingBirefnet || isProcessingBria || isProcessingPixelcut}
                            className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated hover:bg-accent-subtle text-text-primary hover:text-accent rounded-[8px] text-sm font-medium border border-border-default hover:border-accent/30 transition-colors disabled:opacity-40"
                        >
                            {isProcessingBria
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                : <><Scissors className="w-4 h-4" /> Bria Pro ($0.018)</>
                            }
                        </button>
                        <button
                            onClick={() => removeBg('pixelcut')}
                            disabled={isProcessingBirefnet || isProcessingBria || isProcessingPixelcut}
                            className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated hover:bg-accent-subtle text-text-primary hover:text-accent rounded-[8px] text-sm font-medium border border-border-default hover:border-accent/30 transition-colors disabled:opacity-40"
                        >
                            {isProcessingPixelcut
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                : <><Scissors className="w-4 h-4" /> Pixelcut</>
                            }
                        </button>
                        <button
                            onClick={() => {
                                setSourceImage(null);
                                setResultBirefnet(null);
                                setResultBria(null);
                                setResultPixelcut(null);
                            }}
                            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs text-text-tertiary hover:text-danger border border-border-default rounded-[8px] transition-colors"
                        >
                            <X className="w-3.5 h-3.5" /> Clear
                        </button>
                    </div>

                    {/* Comparison grid */}
                    <div className={cn(
                        "grid gap-4",
                        (resultBirefnet || resultBria || resultPixelcut) ? "grid-cols-1 md:grid-cols-4" : "grid-cols-1 max-w-md"
                    )}>
                        {/* Original */}
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Original</p>
                            <div className="rounded-[10px] overflow-hidden border border-border-default bg-bg-elevated">
                                <img src={sourceImage} alt="Original" className="w-full object-contain max-h-[400px]" />
                            </div>
                        </div>

                        {/* BiRefNet result */}
                        {resultBirefnet && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">BiRefNet (Free)</p>
                                <div className="rounded-[10px] overflow-hidden border border-border-default bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3C/svg%3E')]">
                                    <img src={resultBirefnet} alt="BiRefNet result" className="w-full object-contain max-h-[400px]" />
                                </div>
                                
                                <button
                                    onClick={() => downloadImage(resultBirefnet!, `removed-bg-birefnet-${Date.now()}.png`)}
                                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-bg-elevated hover:bg-bg-overlay text-text-secondary hover:text-text-primary text-xs rounded-[8px] border border-border-default transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" /> Download PNG
                                </button>
                            </div>
                        )}

                        {/* Bria result */}
                        {resultBria && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-accent uppercase tracking-wider">Bria Pro</p>
                                <div className="rounded-[10px] overflow-hidden border border-accent/20 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3C/svg%3E')]">
                                    <img src={resultBria} alt="Bria result" className="w-full object-contain max-h-[400px]" />
                                </div>

                                <button
                                    onClick={() => downloadImage(resultBria!, `removed-bg-bria-${Date.now()}.png`)}
                                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-accent-subtle hover:bg-accent text-accent hover:text-white text-xs rounded-[8px] border border-accent/30 transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" /> Download PNG
                                </button>
                            </div>
                        )}

                        {/* Pixelcut result */}
                        {resultPixelcut && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-text-tertiary uppercase tracking-wider">Pixelcut</p>
                                <div className="rounded-[10px] overflow-hidden border border-border-default bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23ccc%22/%3E%3C/svg%3E')]">
                                    <img src={resultPixelcut} alt="Pixelcut result" className="w-full object-contain max-h-[400px]" />
                                </div>
                                <p className="text-[10px] text-text-tertiary text-center">E-commerce optimized</p>
                                <button
                                    onClick={() => downloadImage(resultPixelcut!, `removed-bg-pixelcut-${Date.now()}.png`)}
                                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-bg-elevated hover:bg-bg-overlay text-text-secondary hover:text-text-primary text-xs rounded-[8px] border border-border-default transition-colors"
                                >
                                    <Download className="w-3.5 h-3.5" /> Download PNG
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
