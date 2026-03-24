'use client';

import { useState, useRef, useEffect } from 'react';
import { apiFactory, apiJobs, apiVision, VisionData } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Play, Loader2, Copy, Search, ArrowRight,
    Eye, Cpu, Layers, Wand2, CheckCircle, Image as ImageIcon, Zap, Upload, Palette, TextSelect, Type, Check
} from 'lucide-react';
import Link from 'next/link';

const WIZARD_STEPS = [
    { num: 1, label: 'Reference' },
    { num: 2, label: 'Grammar' },
    { num: 3, label: 'Generate' }
];

const PIPELINE_STEPS = [
    { key: 'GENERATE', label: 'Generate', icon: Cpu },
];

const STEP_EVENTS: Record<string, string> = {
    VARIATIONS_CREATED: 'GENERATE',
    FACTORY_RUN_START: 'GENERATE', FACTORY_GENERATION_START: 'GENERATE'
};

type StepStatus = 'idle' | 'running' | 'success' | 'failed';

export function FactoryClient() {
    // --- Wizard State ---
    const [wizardStep, setWizardStep] = useState(1);

    // Step 1 State
    const [refImage, setRefImage] = useState('assets/references/USA250.jpg');
    const [isExtracting, setIsExtracting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Step 2 State
    const [visionData, setVisionData] = useState<VisionData | null>(null);
    const [editableGrammar, setEditableGrammar] = useState<VisionData | null>(null);
    const [iconsInput, setIconsInput] = useState('wolf, eagle, skull');

    // Generation Settings
    const [imageSize, setImageSize] = useState('square_hd');

    // Step 4 (Pipeline) State
    const [running, setRunning] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [logs, setLogs] = useState<Array<{ eventType: string; status: string; message: string; createdAt: string }>>([]);
    const [logSearch, setLogSearch] = useState('');
    const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});
    const [currentPipelineIdx, setCurrentPipelineIdx] = useState(-1);
    const logRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    // --- Helpers ---
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logs]);

    useEffect(() => {
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    const isImageUrl = refImage.startsWith('http://') || refImage.startsWith('https://') || refImage.startsWith('data:image');

    // --- Handlers ---
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
                    setRefImage(compressedBase64);
                } else {
                    setRefImage(reader.result as string);
                }
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
        }
    };
    const extractPrompt = async () => {
        if (!refImage) return toast.error('Please provide an image URL or path.');
        setIsExtracting(true);
        try {
            const data = await apiFactory.extractStyle({ referenceImageId: refImage });
            setVisionData(data.grammar);
            setEditableGrammar(data.grammar);
            setWizardStep(2);
            toast.success(data.isSynthetic ? 'Using synthetic grammar (No API Key)' : 'Vision extraction complete');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Extraction failed');
        } finally {
            setIsExtracting(false);
        }
    };

    const handleGrammarChange = (field: keyof VisionData, value: string) => {
        if (!editableGrammar) return;
        if (field === 'palette') {
            setEditableGrammar({ ...editableGrammar, palette: value.split(',').map(s => s.trim()) });
        } else {
            setEditableGrammar({ ...editableGrammar, [field]: value });
        }
    };

    const startFactoryPipeline = async () => {
        if (!refImage || !editableGrammar) return toast.error("Missing reference image or grammar");
        const iconsList = iconsInput.split(',').map(s => s.trim()).filter(Boolean);
        if (iconsList.length === 0) return toast.error("Please provide at least one variation icon");

        setWizardStep(3);
        setRunning(true);
        setLogs([]);
        setStepStatuses({ GENERATE: 'idle' });
        setCurrentPipelineIdx(0);

        try {
            const result = await apiFactory.generateVariations({
                referenceImageId: refImage,
                grammar: editableGrammar,
                iconsList,
                imageSize
            });

            setJobId(result.jobId);
            toast.success('Variations generation started!');

            // Initial logs mapping
            pollLogs(result.jobId);
        } catch (err: unknown) {
            setRunning(false);
            toast.error(err instanceof Error ? err.message : 'Pipeline failed to start');
        }
    };

    const deriveStepsFromLogs = (currentLogs: typeof logs) => {
        const statuses: Record<string, StepStatus> = {};
        let maxIdx = 0;
        currentLogs.forEach(l => {
            if (l.status === 'FAILED') statuses[PIPELINE_STEPS[currentPipelineIdx]?.key || 'GENERATE'] = 'failed';
            const mappedStep = STEP_EVENTS[l.eventType];
            if (mappedStep) {
                statuses[mappedStep] = 'success';
                const sIdx = PIPELINE_STEPS.findIndex(s => s.key === mappedStep);
                if (sIdx > maxIdx) maxIdx = sIdx;
            }
        });
        setCurrentPipelineIdx(Math.min(maxIdx + 1, PIPELINE_STEPS.length - 1));
        const current = PIPELINE_STEPS[Math.min(maxIdx + 1, PIPELINE_STEPS.length - 1)]?.key;
        if (current && !statuses[current] && running) statuses[current] = 'running';
        return statuses;
    };

    const pollLogs = (id: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            try {
                const refreshed = await apiJobs.getLogs(id);
                setLogs(refreshed);
                const derived = deriveStepsFromLogs(refreshed);
                setStepStatuses(derived);

                const hasDone = refreshed.some(l => l.eventType === 'FACTORY_RUN_DONE');
                const hasFail = refreshed.some(l => l.eventType.includes('FAILED') || l.eventType === 'FACTORY_RUN_ERROR');
                if (hasDone || hasFail) {
                    clearInterval(pollRef.current!);
                    setRunning(false);
                    if (hasDone) toast.success('Pipeline run complete!');
                    if (hasFail) toast.error('Pipeline encountered an error.');
                }
            } catch (err) {
                console.error('Polling error', err);
            }
        }, 2000);
    };

    const filteredLogs = logs.filter(l => logSearch === '' || l.eventType.toLowerCase().includes(logSearch.toLowerCase()) || l.message?.toLowerCase().includes(logSearch.toLowerCase()));

    // --- Renderers ---
    return (
        <div className="space-y-8 animate-fade-in max-w-5xl mx-auto">
            {/* Wizard Header */}
            <div>
                <h1 className="text-2xl font-bold text-text-primary mb-2">New Project</h1>
                <p className="text-sm text-text-secondary">Launch a new POD design asset pipeline from a reference image.</p>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center justify-between relative pb-6">
                <div className="absolute top-4 left-0 w-full h-0.5 bg-border-default -z-10 rounded" />
                <div
                    className="absolute top-4 left-0 h-0.5 bg-accent -z-10 rounded transition-all duration-500"
                    style={{ width: `${((wizardStep - 1) / (WIZARD_STEPS.length - 1)) * 100}%` }}
                />
                {WIZARD_STEPS.map((s) => (
                    <div key={s.num} className="flex flex-col items-center gap-2">
                        <div className={cn(
                            "w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors bg-bg-base",
                            wizardStep > s.num ? "border-accent text-accent" :
                                wizardStep === s.num ? "border-accent bg-accent-subtle text-accent" : "border-border-strong text-text-tertiary"
                        )}>
                            {wizardStep > s.num ? <CheckCircle className="w-5 h-5" /> : s.num}
                        </div>
                        <span className={cn(
                            "text-xs font-medium whitespace-nowrap",
                            wizardStep >= s.num ? "text-text-primary" : "text-text-tertiary"
                        )}>{s.label}</span>
                    </div>
                ))}
            </div>

            <div className="rounded-[10px] border border-border-default bg-bg-surface overflow-hidden">

                {/* STEP 1: REFERENCE */}
                {wizardStep === 1 && (
                    <div className="p-8 space-y-8">
                        <div className="text-center max-w-lg mx-auto space-y-2">
                            <h2 className="text-xl font-semibold text-text-primary">Upload Reference Image</h2>
                            <p className="text-sm text-text-secondary">Provide a source design to extract aesthetics and layout instructions from.</p>
                        </div>

                        <div className="max-w-xl mx-auto space-y-6">
                            {/* Dropzone */}
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                                onDrop={handleDrop}
                                className={cn(
                                    "border-2 border-dashed rounded-[10px] h-[280px] flex flex-col items-center justify-center transition-all cursor-pointer group relative overflow-hidden",
                                    isDragging ? "bg-accent-subtle border-accent" : "bg-bg-elevated/50 border-border-default hover:border-accent/50"
                                )}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                />
                                <Upload className={cn("w-10 h-10 mb-3 transition-colors", isDragging ? "text-accent" : "text-text-tertiary group-hover:text-accent")} />
                                <p className="text-sm font-medium text-text-primary">Drop your reference image</p>
                                <p className="text-xs text-text-tertiary mt-1">JPG, PNG up to 10MB</p>
                            </div>

                            {/* Image URL input + preview */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-text-secondary">Image URL or Local Path</label>
                                <input
                                    value={refImage}
                                    onChange={e => setRefImage(e.target.value)}
                                    className="w-full bg-bg-elevated border border-border-default rounded-[10px] px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder-text-tertiary"
                                    placeholder="https://example.com/shirt.jpg"
                                />
                                {(isImageUrl || refImage.includes('/')) && (
                                    <div className="mt-4 flex items-start gap-6">
                                        <div className="w-[200px] h-[200px] rounded-xl overflow-hidden border border-border-default bg-bg-elevated flex-shrink-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={refImage} alt="Preview" className="w-full h-full object-cover" onError={e => e.currentTarget.style.display = 'none'} />
                                        </div>
                                        <div className="flex flex-col gap-3 pt-4">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium bg-success-subtle text-success border border-[rgba(34,197,94,0.20)]">
                                                <CheckCircle className="w-3.5 h-3.5" /> Image Ready
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button
                                    onClick={extractPrompt}
                                    disabled={!refImage || isExtracting}
                                    className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-[10px] font-medium transition-colors disabled:opacity-50"
                                    style={{ fontWeight: 500 }}
                                >
                                    {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Extract Style <ArrowRight className="w-5 h-5" /></>}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 2: GRAMMAR & VARIANTS */}
                {wizardStep === 2 && editableGrammar && (
                    <div className="p-8 space-y-8">
                        <div className="flex items-center justify-between border-b border-border-subtle pb-4">
                            <div>
                                <h2 className="text-xl font-semibold text-text-primary">Design Grammar & Style Cloning</h2>
                                <p className="text-sm text-text-secondary">Edit the extracted grammar and specify new subjects (icons) for cloning.</p>
                            </div>
                            <button onClick={() => setWizardStep(1)} className="text-sm text-text-secondary hover:text-text-primary transition-colors">← Edit Image</button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Editor Form */}
                            <div className="space-y-6">
                                <div className="bg-bg-elevated rounded-[10px] p-6 border border-border-default space-y-4">
                                    <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><TextSelect className="w-4 h-4 text-accent" /> Editable Grammar</h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1 block">Style</label>
                                            <input value={editableGrammar.style} onChange={e => handleGrammarChange('style', e.target.value)} className="w-full bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:border-accent outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1 block">Layout</label>
                                            <input value={editableGrammar.layout} onChange={e => handleGrammarChange('layout', e.target.value)} className="w-full bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:border-accent outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1 block">Typography</label>
                                            <input value={editableGrammar.typography} onChange={e => handleGrammarChange('typography', e.target.value)} className="w-full bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:border-accent outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1 block">Color Palette (comma separated)</label>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-1">
                                                    {editableGrammar.palette.map((color, i) => (
                                                        <div key={i} className="w-5 h-5 rounded-full border border-border-default" style={{ backgroundColor: color }} />
                                                    ))}
                                                </div>
                                                <input value={editableGrammar.palette.join(', ')} onChange={e => handleGrammarChange('palette', e.target.value)} className="flex-1 bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:border-accent outline-none" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Variations & Submit */}
                            <div className="space-y-6">
                                <div className="bg-bg-elevated rounded-[10px] p-6 border border-border-default space-y-4">
                                    <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><Layers className="w-4 h-4 text-accent" /> Variation Icons</h3>
                                    <p className="text-xs text-text-secondary">Enter comma-separated icon subjects to swap into the design grammar.</p>
                                    <textarea
                                        value={iconsInput}
                                        onChange={e => setIconsInput(e.target.value)}
                                        className="w-full h-32 bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:border-accent outline-none resize-none"
                                        placeholder="wolf, eagle, bear, skull"
                                    />
                                </div>

                                <div className="bg-bg-elevated rounded-[10px] p-6 border border-border-default space-y-4">
                                    <div>
                                        <label className="text-sm text-text-secondary block mb-2">Image Size</label>
                                        <select value={imageSize} onChange={e => setImageSize(e.target.value)} className="w-full bg-bg-base border border-border-default rounded-[8px] px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent">
                                            <option value="square_hd">Square HD (1024x1024)</option>
                                            <option value="portrait_4_3">Portrait 4:3 (768x1024)</option>
                                            <option value="landscape_4_3">Landscape 4:3 (1024x768)</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={startFactoryPipeline}
                                        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-[10px] font-bold transition-all"
                                    >
                                        <Zap className="w-5 h-5" /> Generate →
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 3: PROGRESS & LOGS */}
                {wizardStep === 3 && (
                    <div className="flex flex-col">
                        <div className="p-8 border-b border-border-subtle">
                            {/* Job status pill */}
                            <div className="flex items-center gap-3 mb-6">
                                {running ? (
                                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-warn-subtle text-warn border border-[rgba(245,158,11,0.20)] animate-pulse">
                                        <Loader2 className="w-4 h-4 animate-spin" /> Pipeline Running
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-success-subtle text-success border border-[rgba(34,197,94,0.20)]">
                                        <CheckCircle className="w-4 h-4" /> Pipeline Complete
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center justify-between relative max-w-2xl mx-auto">
                                <div className="absolute top-1/2 left-0 w-full h-1 bg-border-default -z-10 -translate-y-1/2 rounded" />
                                {PIPELINE_STEPS.map((step, idx) => {
                                    const st = stepStatuses[step.key] || 'idle';
                                    const isDone = st === 'success';
                                    const isRunning = st === 'running';
                                    const isFailed = st === 'failed';
                                    return (
                                        <div key={idx} className="flex flex-col items-center gap-2">
                                            <div className={cn(
                                                "w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all duration-500",
                                                isDone ? "bg-success border-[rgba(34,197,94,0.30)] text-white" :
                                                    isRunning ? "bg-accent border-accent-border text-white animate-pulse" :
                                                        isFailed ? "bg-danger border-[rgba(239,68,68,0.30)] text-white" :
                                                            "bg-bg-elevated border-border-strong text-text-tertiary"
                                            )}>
                                                <step.icon className="w-5 h-5" />
                                            </div>
                                            <span className={cn(
                                                "text-xs font-semibold uppercase tracking-wider",
                                                (isDone || isRunning) ? "text-text-primary" : isFailed ? "text-danger" : "text-text-tertiary"
                                            )}>{step.label}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Logs Console */}
                        <div className="bg-bg-base p-4 flex flex-col h-[400px]">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm text-text-tertiary" style={{ fontFamily: "'Geist Mono', monospace" }}>Terminal Log</h3>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                        <input
                                            value={logSearch} onChange={e => setLogSearch(e.target.value)}
                                            placeholder="Filter logs..."
                                            className="bg-bg-surface border border-border-default rounded-[8px] px-8 py-1 text-xs text-text-secondary w-48 focus:outline-none focus:border-accent"
                                        />
                                    </div>
                                    <button onClick={() => {
                                        navigator.clipboard.writeText(filteredLogs.map(l => `[${l.createdAt}] ${l.eventType} [${l.status}] ${l.message || ''}`).join('\n'));
                                        toast.success('Logs copied');
                                    }} className="p-1.5 hover:bg-bg-elevated rounded text-text-tertiary transition-colors" title="Copy Logs">
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div ref={logRef} className="flex-1 overflow-y-auto space-y-1.5 text-xs p-2 bg-bg-base rounded-[8px] border border-border-subtle" style={{ fontFamily: "'Geist Mono', monospace", fontSize: '12px' }}>
                                {filteredLogs.length === 0 ? (
                                    <p className="text-text-tertiary italic">Awaiting logs...</p>
                                ) : (
                                    filteredLogs.map((l, i) => (
                                        <div key={i} className="flex gap-3">
                                            <span className="text-text-tertiary shrink-0">[{new Date(l.createdAt).toLocaleTimeString()}]</span>
                                            <span className="font-semibold w-32 shrink-0 text-accent">{l.eventType}</span>
                                            <span className={cn(
                                                l.status === 'ERROR' || l.status === 'FAILED' ? "text-danger" :
                                                    l.status === 'SUCCESS' ? "text-success" : "text-text-primary"
                                            )}>{l.message}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* CTA when done */}
                        {!running && jobId && (
                            <div className="p-6 bg-bg-surface border-t border-border-subtle flex justify-end gap-3">
                                <Link
                                    href={`/dashboard/gallery?jobId=${jobId}`}
                                    className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-2.5 rounded-[10px] font-medium transition-colors"
                                >
                                    View in Gallery <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
