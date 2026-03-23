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
    { num: 2, label: 'Grammar & Variants' },
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
                <h1 className="text-2xl font-bold text-white mb-2">New Project</h1>
                <p className="text-sm text-slate-400">Launch a new POD design asset pipeline from a reference image.</p>
            </div>

            {/* Stepper Dots */}
            <div className="flex items-center justify-between relative pb-4">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -z-10 -translate-y-1/2 rounded" />
                <div
                    className="absolute top-1/2 left-0 h-0.5 bg-blue-500 -z-10 -translate-y-1/2 rounded transition-all duration-500"
                    style={{ width: `${((wizardStep - 1) / (WIZARD_STEPS.length - 1)) * 100}%` }}
                />
                {WIZARD_STEPS.map((s, idx) => (
                    <div key={s.num} className="flex flex-col items-center gap-2">
                        <div className={cn(
                            "w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors bg-slate-900",
                            wizardStep > s.num ? "border-blue-500 text-blue-500" :
                                wizardStep === s.num ? "border-blue-500 bg-blue-500/10 text-blue-400" : "border-slate-700 text-slate-500"
                        )}>
                            {wizardStep > s.num ? <CheckCircle className="w-5 h-5" /> : s.num}
                        </div>
                        <span className={cn(
                            "text-xs font-medium absolute -bottom-6 whitespace-nowrap",
                            wizardStep >= s.num ? "text-slate-200" : "text-slate-500"
                        )}>{s.label}</span>
                    </div>
                ))}
            </div>

            <div className="mt-8 rounded-2xl border border-slate-700 bg-[#1e293b] overflow-hidden shadow-xl">

                {/* STEP 1: REFERENCE */}
                {wizardStep === 1 && (
                    <div className="p-8 space-y-8 animate-in slide-in-from-right-8 duration-300">
                        <div className="text-center max-w-lg mx-auto space-y-2">
                            <h2 className="text-xl font-semibold text-white">Upload Reference Image</h2>
                            <p className="text-sm text-slate-400">Provide a source design to extract aesthetics and layout instructions from.</p>
                        </div>

                        <div className="max-w-xl mx-auto space-y-6">
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                                onDrop={handleDrop}
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group relative overflow-hidden",
                                    isDragging ? "bg-blue-500/10 border-blue-500" : "bg-slate-800/50 border-slate-700 hover:border-blue-500/50"
                                )}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                />
                                <Upload className={cn("w-10 h-10 mb-3 transition-colors", isDragging ? "text-blue-500" : "text-slate-500 group-hover:text-blue-400")} />
                                <p className="text-sm font-medium text-slate-300">Drag & drop image here or <span className="text-blue-400">browse</span></p>
                                <p className="text-xs text-slate-500 mt-1">Accepts JPG, PNG max 10MB</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-300">Image URL or Local Path</label>
                                <input
                                    value={refImage}
                                    onChange={e => setRefImage(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    placeholder="https://example.com/shirt.jpg"
                                />
                                {(isImageUrl || refImage.includes('/')) && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <div className="mt-4 aspect-video relative rounded-lg overflow-hidden border border-slate-700 bg-slate-800 w-full sm:w-2/3 mx-auto flex items-center justify-center">
                                        <img src={refImage} alt="Preview" className="w-full h-full object-contain" onError={e => e.currentTarget.style.display = 'none'} />
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button
                                    onClick={extractPrompt}
                                    disabled={!refImage || isExtracting}
                                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
                                >
                                    {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Extract Prompt <ArrowRight className="w-5 h-5" /></>}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 2: GRAMMAR & VARIANTS */}
                {wizardStep === 2 && editableGrammar && (
                    <div className="p-8 space-y-8 animate-in slide-in-from-right-8 duration-300">
                        <div className="flex items-center justify-between border-b border-slate-700 pb-4">
                            <div>
                                <h2 className="text-xl font-semibold text-white">Design Grammar & Style Cloning</h2>
                                <p className="text-sm text-slate-400">Edit the extracted grammar and specify new subjects (icons) for cloning.</p>
                            </div>
                            <button onClick={() => setWizardStep(1)} className="text-sm text-slate-400 hover:text-white">← Edit Image</button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Editor Form */}
                            <div className="space-y-6">
                                <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><TextSelect className="w-4 h-4 text-blue-400" /> Editable Grammar</h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Style</label>
                                            <input value={editableGrammar.style} onChange={e => handleGrammarChange('style', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Layout</label>
                                            <input value={editableGrammar.layout} onChange={e => handleGrammarChange('layout', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Typography</label>
                                            <input value={editableGrammar.typography} onChange={e => handleGrammarChange('typography', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-slate-400 uppercase tracking-wider mb-1 block">Color Palette (comma separated)</label>
                                            <input value={editableGrammar.palette.join(', ')} onChange={e => handleGrammarChange('palette', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Variations & Submit */}
                            <div className="space-y-6">
                                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800 space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><Layers className="w-4 h-4 text-emerald-400" /> Variation Icons</h3>
                                    <p className="text-xs text-slate-400">Enter comma-separated icon subjects to swap into the design grammar.</p>
                                    <textarea
                                        value={iconsInput}
                                        onChange={e => setIconsInput(e.target.value)}
                                        className="w-full h-32 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-blue-500 outline-none resize-none"
                                        placeholder="wolf, eagle, bear, skull"
                                    />
                                </div>

                                <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800 space-y-4">
                                    <div>
                                        <label className="text-sm text-slate-300 block mb-2">Image Size</label>
                                        <select value={imageSize} onChange={e => setImageSize(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
                                            <option value="square_hd">Square HD (1024x1024)</option>
                                            <option value="portrait_4_3">Portrait 4:3 (768x1024)</option>
                                            <option value="landscape_4_3">Landscape 4:3 (1024x768)</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={startFactoryPipeline}
                                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg font-bold transition-all shadow-lg shadow-emerald-900/20"
                                    >
                                        <Zap className="w-5 h-5" /> Generate Variations
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 3: PROGRESS & LOGS */}
                {wizardStep === 3 && (
                    <div className="animate-in slide-in-from-right-8 duration-300 flex flex-col">
                        <div className="p-8 border-b border-slate-700 bg-slate-800/50">
                            <h2 className="text-xl font-semibold text-white mb-6 flex items-center gap-3">
                                {running ? <Loader2 className="w-6 h-6 animate-spin text-blue-400" /> : <CheckCircle className="w-6 h-6 text-emerald-400" />}
                                {running ? 'Pipeline is running...' : 'Pipeline complete!'}
                            </h2>

                            <div className="flex items-center justify-between relative max-w-2xl mx-auto">
                                <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-700 -z-10 -translate-y-1/2 rounded" />
                                {PIPELINE_STEPS.map((step, idx) => {
                                    const st = stepStatuses[step.key] || 'idle';
                                    const isDone = st === 'success';
                                    const isRunning = st === 'running';
                                    const isFailed = st === 'failed';
                                    return (
                                        <div key={idx} className="flex flex-col items-center gap-2">
                                            <div className={cn(
                                                "w-12 h-12 rounded-full flex items-center justify-center border-4 transition-all duration-500 shadow-xl",
                                                isDone ? "bg-emerald-500 border-emerald-900 text-white shadow-emerald-900/50" :
                                                    isRunning ? "bg-blue-500 border-blue-900 text-white shadow-blue-900/50 animate-pulse" :
                                                        isFailed ? "bg-red-500 border-red-900 text-white" :
                                                            "bg-slate-800 border-slate-700 text-slate-500"
                                            )}>
                                                <step.icon className="w-5 h-5" />
                                            </div>
                                            <span className={cn(
                                                "text-xs font-semibold uppercase tracking-wider",
                                                (isDone || isRunning) ? "text-slate-200" : isFailed ? "text-red-400" : "text-slate-600"
                                            )}>{step.label}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Logs Console */}
                        <div className="bg-[#0f172a] p-4 flex flex-col h-[400px]">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-mono text-slate-400">Terminal Log</h3>
                                <div className="flex items-center gap-2">
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                        <input
                                            value={logSearch} onChange={e => setLogSearch(e.target.value)}
                                            placeholder="Filter logs..."
                                            className="bg-slate-900 border border-slate-800 rounded px-8 py-1 text-xs text-slate-300 w-48 focus:outline-none focus:border-slate-600"
                                        />
                                    </div>
                                    <button onClick={() => {
                                        navigator.clipboard.writeText(filteredLogs.map(l => `[${l.createdAt}] ${l.eventType} [${l.status}] ${l.message || ''}`).join('\n'));
                                        toast.success('Logs copied');
                                    }} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 transition-colors" title="Copy Logs">
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div ref={logRef} className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs p-2 bg-black/40 rounded border border-slate-800/50">
                                {filteredLogs.length === 0 ? (
                                    <p className="text-slate-600 italic">Awaiting logs...</p>
                                ) : (
                                    filteredLogs.map((l, i) => (
                                        <div key={i} className={cn(
                                            "flex gap-3",
                                            l.status === 'ERROR' || l.status === 'FAILED' ? "text-red-400" :
                                                l.status === 'SUCCESS' ? "text-emerald-400" : "text-slate-300"
                                        )}>
                                            <span className="text-slate-600 shrink-0">[{new Date(l.createdAt).toLocaleTimeString()}]</span>
                                            <span className="font-semibold w-32 shrink-0">{l.eventType}</span>
                                            <span className="text-slate-500">{l.message}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* CTA when done */}
                        {!running && jobId && (
                            <div className="p-6 bg-slate-800 border-t border-slate-700 flex justify-end gap-3">
                                <Link
                                    href={`/dashboard/gallery?jobId=${jobId}`}
                                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
                                >
                                    Proceed to Gallery <ArrowRight className="w-4 h-4" />
                                </Link>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
