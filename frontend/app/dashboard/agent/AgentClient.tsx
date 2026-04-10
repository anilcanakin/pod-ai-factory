'use client';

import { useState } from 'react';
import { 
    Bot, 
    Zap, 
    Search, 
    CheckCircle2, 
    AlertTriangle, 
    TrendingUp, 
    DollarSign, 
    Tag, 
    ImageIcon,
    Loader2,
    Play,
    ShieldCheck
} from 'lucide-react';
import { apiAgent, AuditPlan } from '@/lib/api';
import { toast } from 'sonner';

export function AgentClient() {
    const [running, setRunning] = useState(false);
    const [plan, setPlan] = useState<AuditPlan | null>(null);
    const [executingId, setExecutingId] = useState<string | null>(null);

    const runAudit = async () => {
        setRunning(true);
        const toastId = toast.loading('AI Manager is scanning the store and consulting knowledge...');
        try {
            const result = await apiAgent.runAudit();
            setPlan(result);
            toast.success('Audit complete! Recommendations generated.', { id: toastId });
        } catch (err) {
            toast.error('Audit failed: ' + (err as Error).message, { id: toastId });
        } finally {
            setRunning(false);
        }
    };

    const handleApplyAction = async (action: any) => {
        setExecutingId(action.listingId);
        const toastId = toast.loading(`Applying ${action.actionType.replace('_', ' ')} via AI Browser Agent...`);
        try {
            await apiAgent.applyAction(action);
            toast.success('Action successfully executed on Etsy!', { id: toastId });
            // Remove from list
            if (plan) {
                setPlan({
                    ...plan,
                    actions: plan.actions.filter(a => a !== action)
                });
            }
        } catch (err) {
            toast.error('Execution failed: ' + (err as Error).message, { id: toastId });
        } finally {
            setExecutingId(null);
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8 pb-20">
            {/* Hero Section */}
            <div className="relative p-10 rounded-[32px] bg-bg-elevated border border-border-subtle overflow-hidden">
                <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-accent/5 to-transparent pointer-events-none" />
                <div className="relative z-10 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
                            <Bot className="w-6 h-6 text-accent" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Autonomous Store Manager</h1>
                            <p className="text-text-tertiary text-sm italic">"I manage your shop so you can focus on building your brand."</p>
                        </div>
                    </div>
                    
                    <p className="max-w-xl text-text-secondary leading-relaxed">
                        The AI Manager uses your **Multimodal Corporate Brain** (the lessons you've shared) and combines them with **Live Etsy Performance Statistics** to identify high-impact optimizations for price, SEO, and visual appeal.
                    </p>

                    <button
                        onClick={runAudit}
                        disabled={running}
                        className="h-12 px-8 rounded-full bg-accent text-white font-bold flex items-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100"
                    >
                        {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                        {running ? 'Audit in Progress...' : 'Run Store Audit'}
                    </button>
                </div>
            </div>

            {plan ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {/* Executive Summary */}
                    <div className="p-6 rounded-2xl bg-accent/5 border border-accent/20 flex items-start gap-4">
                        <ShieldCheck className="w-6 h-6 text-accent shrink-0 mt-1" />
                        <div>
                            <h2 className="text-sm font-bold uppercase tracking-widest text-accent mb-2">Executive Summary</h2>
                            <p className="text-text-primary leading-relaxed">{plan.executiveSummary}</p>
                        </div>
                    </div>

                    {/* Recommendations Grid */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-text-tertiary">Optimization Tasks ({plan.actions.length})</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {plan.actions.map((action, i) => (
                                <div key={i} className="group p-5 rounded-2xl bg-bg-elevated border border-border-subtle hover:border-accent/40 transition-all flex flex-col justify-between">
                                    <div className="space-y-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className={`p-2 rounded-lg ${
                                                    action.actionType === 'UPDATE_PRICE' ? 'bg-green-500/10 text-green-500' :
                                                    action.actionType === 'UPDATE_SEO' ? 'bg-blue-500/10 text-blue-500' :
                                                    action.actionType === 'UPDATE_MOCKUP' ? 'bg-purple-500/10 text-purple-500' :
                                                    'bg-amber-500/10 text-amber-500'
                                                }`}>
                                                    {action.actionType === 'UPDATE_PRICE' && <DollarSign className="w-4 h-4" />}
                                                    {action.actionType === 'UPDATE_SEO' && <Tag className="w-4 h-4" />}
                                                    {action.actionType === 'UPDATE_MOCKUP' && <ImageIcon className="w-4 h-4" />}
                                                    {action.actionType === 'NOTIFICATION' && <AlertTriangle className="w-4 h-4" />}
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
                                                    {action.actionType.replace('_', ' ')}
                                                </span>
                                            </div>
                                            <span className="text-[10px] bg-bg-base px-2 py-0.5 rounded text-text-tertiary font-mono">
                                                ID: {action.listingId}
                                            </span>
                                        </div>

                                        <p className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                                            {action.reason}
                                        </p>

                                        {/* Action Details */}
                                        <div className="p-3 rounded-xl bg-bg-base/50 border border-border-subtle/30 space-y-2">
                                            {Object.entries(action.details).map(([key, val]) => (
                                                <div key={key} className="flex items-center justify-between text-[11px]">
                                                    <span className="text-text-tertiary capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                                                    <span className="text-text-secondary font-medium">{String(val)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="mt-6 flex gap-2">
                                        <button className="flex-1 h-9 rounded-lg bg-bg-overlay border border-border-subtle text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-bg-base transition-all">
                                            Ignore
                                        </button>
                                        <button 
                                            onClick={() => handleApplyAction(action)}
                                            disabled={executingId === action.listingId}
                                            className="flex-1 h-9 rounded-lg bg-accent text-white text-xs font-bold hover:scale-[1.02] transition-all disabled:opacity-50"
                                        >
                                            {executingId === action.listingId ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Apply Fix'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center space-y-4">
                    <Search className="w-12 h-12 text-text-tertiary opacity-10" />
                    <div className="space-y-1">
                        <p className="text-text-secondary font-medium italic">"Waiting for your command to analyze the shop..."</p>
                        <p className="text-[11px] text-text-tertiary">Run an audit to sync with your Corporate Brain. </p>
                    </div>
                </div>
            )}

            {/* AI Capabilities list */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-10">
                <div className="p-6 rounded-2xl bg-bg-elevated border border-border-subtle space-y-3">
                    <TrendingUp className="w-6 h-6 text-green-500" />
                    <h4 className="text-sm font-bold">Dynamic Pricing</h4>
                    <p className="text-xs text-text-tertiary leading-relaxed">Adjusts prices based on sales velocity and your training-defined margins.</p>
                </div>
                <div className="p-6 rounded-2xl bg-bg-elevated border border-border-subtle space-y-3">
                    <Zap className="w-6 h-6 text-amber-500" />
                    <h4 className="text-sm font-bold">Conversion SEO</h4>
                    <p className="text-xs text-text-tertiary leading-relaxed">Fixes low-click listings by applying high-performing keywords from your training source.</p>
                </div>
                <div className="p-6 rounded-2xl bg-bg-elevated border border-border-subtle space-y-3">
                    <CheckCircle2 className="w-6 h-6 text-accent" />
                    <h4 className="text-sm font-bold">Automatic Quality Control</h4>
                    <p className="text-xs text-text-tertiary leading-relaxed">Identifies poor mockups and suggests replacements using AI Vision checks.</p>
                </div>
            </div>
        </div>
    );
}
