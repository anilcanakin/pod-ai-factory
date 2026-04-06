'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Group, Transformer, Rect } from 'react-konva';
import { MockupTemplate } from '@/lib/api';
import { X, Check } from 'lucide-react';
import Konva from 'konva';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

interface Placement {
    scale: number;
    offsetX: number;
    offsetY: number;
    rotation: number;
}

interface EditorProps {
    template: MockupTemplate;
    designUrl: string;
    onSave: (placement: Placement) => void;
    onCancel: () => void;
}

const resolveUrl = (p: string) => {
    if (!p) return '';
    if (p.startsWith('http://localhost:3000')) return p.replace('http://localhost:3000', '');
    if (p.startsWith('http')) return p;
    return p.startsWith('/') ? p : `/${p}`;
};

export default function DesignPlacementEditor({ template, designUrl, onSave, onCancel }: EditorProps) {
    const config = template.configJson || {};
    const printArea = config.printArea || { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    const transform = config.transform || {};

    // UI Layout state
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Image objects
    const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
    const [designImg, setDesignImg] = useState<HTMLImageElement | null>(null);
    const [maskImg, setMaskImg] = useState<HTMLImageElement | null>(null);
    const [loadError, setLoadError] = useState(false);

    // Konva Refs
    const designNodeRef = useRef<Konva.Image>(null);
    const trRef = useRef<Konva.Transformer>(null);

    // Initial load
    useEffect(() => {
        // Load local assets WITHOUT crossOrigin (backend serves them with CORS headers)
        const loadLocal = (src: string, setter: (img: HTMLImageElement) => void) => {
            const img = new Image();
            img.onload = () => {
                console.log('[DesignPlacementEditor] LOCAL loaded:', img.src, img.width, img.height);
                setter(img);
            };
            img.onerror = (e) => console.error('Failed to load local:', src, e);
            img.src = src.startsWith('http') ? src : `http://localhost:3000/${src.startsWith('/') ? src.slice(1) : src}`;
        };

        // Load external assets WITH crossOrigin (fal.media etc)
        const loadExternal = (src: string, setter: (img: HTMLImageElement) => void) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                console.log('[DesignPlacementEditor] EXTERNAL loaded:', img.src, img.width, img.height);
                setter(img);
            };
            img.onerror = (e) => console.error('Failed to load external:', src, e);
            img.src = src;
        };

        const isExternal = (src: string) => src.startsWith('https://') && !src.includes('localhost');

        if (template.baseImagePath) {
            const url = resolveUrl(template.baseImagePath);
            isExternal(url) ? loadExternal(url, setBaseImg) : loadLocal(url, setBaseImg);
        }
        if (designUrl) {
            const url = resolveUrl(designUrl);
            isExternal(url) ? loadExternal(url, setDesignImg) : loadLocal(url, setDesignImg);
        }
        if (template.maskImagePath) {
            const url = resolveUrl(template.maskImagePath);
            isExternal(url) ? loadExternal(url, setMaskImg) : loadLocal(url, setMaskImg);
        }
    }, [template, designUrl]);

    // Responsive container
    useEffect(() => {
        const updateSize = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                if (rect.width > 0) {
                    setContainerSize({ width: rect.width, height: rect.height });
                }
            }
        };

        // Try immediately
        updateSize();

        // Also try after a short delay (DOM may not be ready)
        const timer = setTimeout(updateSize, 100);
        const timer2 = setTimeout(updateSize, 500);

        window.addEventListener('resize', updateSize);
        return () => {
            window.removeEventListener('resize', updateSize);
            clearTimeout(timer);
            clearTimeout(timer2);
        };
    }, []);

    // Attach transformer
    useEffect(() => {
        if (designImg && trRef.current && designNodeRef.current) {
            trRef.current.nodes([designNodeRef.current]);
            trRef.current.getLayer()?.batchDraw();
        }
    }, [designImg]);

    if (loadError) {
        return (
            <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center">
                <div className="text-white text-center">
                    <p className="text-red-400 mb-2">Failed to load template image</p>
                    <button onClick={onCancel} className="px-4 py-2 bg-blue-600 rounded">Close</button>
                </div>
            </div>
        );
    }

    console.log('[DesignPlacementEditor] Render check:', {
        hasBase: !!baseImg,
        hasDesign: !!designImg,
        containerWidth: containerSize.width
    });

    if (!baseImg || !designImg) {
        return (
            <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center">
                <div className="text-white flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Loading assets...
                </div>
            </div>
        );
    }

    if (!designUrl || !designImg) {
        return (
            <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center">
                <div className="text-center text-slate-400">
                    <p className="text-lg font-medium text-white mb-2">No design selected</p>
                    <p className="text-sm">Pick a design from the gallery first, then open the editor.</p>
                    <button onClick={onCancel} className="mt-6 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    // Calculations to fit base image into the container correctly
    const scaleToFitX = (containerSize.width || 800) / baseImg.width;
    const scaleToFitY = (containerSize.height || 600) / baseImg.height;
    const stageScale = Math.min(scaleToFitX, scaleToFitY) * 0.95; // 95% to leave some padding

    const stageWidth = baseImg.width * stageScale;
    const stageHeight = baseImg.height * stageScale;

    // Print Area Pixel Dimensions based on natural baseImg size
    const paX = printArea.x * baseImg.width;
    const paY = printArea.y * baseImg.height;
    const paW = printArea.width * baseImg.width;
    const paH = printArea.height * baseImg.height;

    // Initial Design Scaling matching mockup-render.service step 3
    const designScaleToFitX = paW / designImg.width;
    const designScaleToFitY = paH / designImg.height;
    const initialDesignScale = Math.min(designScaleToFitX, designScaleToFitY);

    const initialDesignW = designImg.width * initialDesignScale;
    const initialDesignH = designImg.height * initialDesignScale;

    // Center it in the print area by default
    const initialDesignX = paX + (paW - initialDesignW) / 2;
    const initialDesignY = paY + (paH - initialDesignH) / 2;

    const handleSave = () => {
        const node = designNodeRef.current;
        if (!node) return;

        // Current properties from Konva (these are relative to the Stage/Layer which is unscaled)
        const scaleX = node.scaleX() || 1;
        const currentX = node.x();
        const currentY = node.y();

        // Backend expects:
        // scale: multiplier over the "contain" matched width
        // offsetX: normalized percentage offset from absolute center of Print Area
        // offsetY: "

        // 1. Scale relative to the initial contained size
        const finalScale = scaleX; // Because we initialized it at scale=1, taking up initialDesignW

        // 2. Offsets. 
        // The backend calculates left/top as:
        // Math.round((paW - finalW) / 2 + (offsetX * paW));
        // So offsetX = (currentLeft - defaultLeft) / paW
        // Wait, node.x() and node.y() are the top-left of the bounding box if rotation is 0...
        // but if rotated, x and y are the origin which we set to center.

        // It's much easier to work with centers:
        const currentCenterX = currentX; // Since offset={x: width/2, y: height/2}
        const currentCenterY = currentY;

        const defaultCenterX = paX + paW / 2;
        const defaultCenterY = paY + paH / 2;

        const offsetX = (currentCenterX - defaultCenterX) / paW;
        const offsetY = (currentCenterY - defaultCenterY) / paH;

        const rotation = node.rotation();

        onSave({
            scale: finalScale,
            offsetX,
            offsetY,
            rotation
        });
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col font-sans">
            {/* Header */}
            <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0f172a]">
                <div className="flex flex-col">
                    <h2 className="text-white font-semibold flex items-center gap-2">
                        Design Placement
                    </h2>
                    <span className="text-slate-400 text-xs">Drag and resize your design inside the print area</span>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:bg-white/5 transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-5 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 font-medium flex items-center gap-2 shadow-lg shadow-blue-500/20">
                        <Check className="w-4 h-4" /> Save Placement
                    </button>
                </div>
            </div>

            {/* Canvas Container */}
            <div className="flex-1 relative flex items-center justify-center p-8" ref={containerRef}>
                <div
                    className="relative shadow-2xl bg-black rounded overflow-hidden ring-1 ring-white/10"
                    style={{ width: stageWidth, height: stageHeight }}
                >
                    <Stage
                        width={baseImg.width}
                        height={baseImg.height}
                        style={{ transform: `scale(${stageScale})`, transformOrigin: 'top left' }}
                    >
                        <Layer>
                            {/* Base Image */}
                            <KonvaImage image={baseImg} x={0} y={0} width={baseImg.width} height={baseImg.height} />

                            {/* Print Area Clip Group */}
                            <Group
                                clipX={paX}
                                clipY={paY}
                                clipWidth={paW}
                                clipHeight={paH}
                            >
                                {/* Base Print Area Guide (Optional slight tint) */}
                                <Rect
                                    x={paX} y={paY} width={paW} height={paH}
                                    fill="rgba(59, 130, 246, 0.05)"
                                />

                                {/* The Design */}
                                <KonvaImage
                                    ref={designNodeRef}
                                    image={designImg}
                                    draggable
                                    // To make rotation around the center natural, we set origin to center
                                    x={initialDesignX + initialDesignW / 2}
                                    y={initialDesignY + initialDesignH / 2}
                                    offsetX={initialDesignW / 2}
                                    offsetY={initialDesignH / 2}
                                    width={initialDesignW}
                                    height={initialDesignH}
                                    globalCompositeOperation={transform.blendMode === 'multiply' ? 'multiply' : 'source-over'}
                                    opacity={transform.opacity ?? 1}
                                />

                                {/* Mask Overlay (inside the clip area) */}
                                {maskImg && (
                                    <KonvaImage
                                        image={maskImg}
                                        x={paX} y={paY} width={paW} height={paH}
                                        globalCompositeOperation="destination-in"
                                    />
                                )}
                            </Group>

                            {/* Print Area Bounds Indicator (dashed line above everything) */}
                            <Rect
                                x={paX} y={paY} width={paW} height={paH}
                                stroke="rgba(255, 255, 255, 0.5)"
                                strokeWidth={2 / stageScale} // keep line visually thin regardless of zoom
                                dash={[5 / stageScale, 5 / stageScale]}
                                listening={false} // pass through clicks
                            />

                            {/* Transformer for sizing and rotation */}
                            <Transformer
                                ref={trRef}
                                boundBoxFunc={(oldBox, newBox) => {
                                    // limit scaling to avoid 0 size
                                    if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) {
                                        return oldBox;
                                    }
                                    return newBox;
                                }}
                                // Make controls easier to grab on zoom out
                                anchorSize={12 / stageScale}
                                borderStrokeWidth={1 / stageScale}
                                padding={5 / stageScale}
                                rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
                            />
                        </Layer>
                    </Stage>
                </div>
            </div>
        </div>
    );
}
