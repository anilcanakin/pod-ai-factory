'use client';

import React from 'react';

import { useQuery, useMutation } from '@tanstack/react-query';
import { apiStatus } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
    Shield, Wifi, WifiOff, ShieldAlert, AlertTriangle,
    Key, Cpu, Server, Globe, ExternalLink, RefreshCw, LineChart
} from 'lucide-react';

type FalStatus = 'online' | 'offline' | 'auth_error' | 'payload_error';

const FAL_BADGE: Record<FalStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
    online: { label: 'Online', color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/20', Icon: Wifi },
    offline: { label: 'Offline', color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/20', Icon: WifiOff },
    auth_error: { label: 'Auth Error', color: 'text-orange-400', bg: 'bg-orange-400/10 border-orange-400/20', Icon: ShieldAlert },
    payload_error: { label: 'Degraded', color: 'text-yellow-400', bg: 'bg-yellow-400/10 border-yellow-400/20', Icon: AlertTriangle },
};

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between py-2.5 border-b border-slate-800 last:border-0">
            <span className="text-sm text-slate-400">{label}</span>
            <span className={cn('text-sm font-medium text-slate-200', mono && 'font-mono text-xs bg-slate-800 px-2 py-0.5 rounded')}>
                {value}
            </span>
        </div>
    );
}

export function SettingsClient() {
    const { data: status, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['status'],
        queryFn: apiStatus.get,
        refetchInterval: 30000,
    });

    const [editingKey, setEditingKey] = React.useState<string | null>(null);
    const [keyValue, setKeyValue] = React.useState('');
    const [saving, setSaving] = React.useState(false);

    const handleSaveKey = async (provider: string) => {
        if (!keyValue.trim()) return;
        setSaving(true);
        try {
            const res = await fetch('/api/settings/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, keyValue })
            });
            if (!res.ok) throw new Error(await res.text());
            toast.success(`${provider} API key saved for this workspace`);
            setEditingKey(null);
            setKeyValue('');
            refetch();
        } catch (err: any) {
            toast.error(err.message || 'Failed to save key');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteKey = async (provider: string) => {
        try {
            const res = await fetch(`/api/settings/keys/${provider}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(await res.text());
            toast.success(`${provider} API key removed`);
            refetch();
        } catch (err: any) {
            toast.error(err.message || 'Failed to remove key');
        }
    };

    const falStatus = (status?.fal ?? 'offline') as FalStatus;
    const cfg = FAL_BADGE[falStatus];
    const FalIcon = cfg.Icon;

    const handleSignOut = () => {
        document.cookie = 'pod-auth-token=; Max-Age=0; path=/';
        window.location.href = '/login';
    };

    return (
        <div className="space-y-7 animate-fade-in max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-white">Settings</h1>
                <p className="text-sm text-slate-400 mt-0.5">Configuration and environment information</p>
            </div>

            {/* Provider Status Card */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-400" /> Provider Status
                    </h2>
                    <button
                        onClick={() => refetch()}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
                        disabled={isFetching}
                    >
                        <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
                        {isFetching ? 'Checking…' : 'Re-check'}
                    </button>
                </div>
                <div className="p-5">
                    {/* Fal status */}
                    <div className={cn('flex items-center gap-3 p-4 rounded-xl border', cfg.bg)}>
                        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', cfg.bg)}>
                            <FalIcon className={cn('w-5 h-5', cfg.color)} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">Fal.ai / Flux</span>
                                <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', cfg.color, cfg.bg)}>
                                    {isLoading ? 'Checking…' : cfg.label}
                                </span>
                            </div>
                            {status?.falMessage ? (
                                <p className="text-xs text-slate-500 mt-0.5 font-mono">{status.falMessage}</p>
                            ) : (
                                <p className="text-xs text-slate-500 mt-0.5">Model: {process.env.NEXT_PUBLIC_FAL_MODEL || 'fal-ai/flux/dev'}</p>
                            )}
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                        Health check runs every 30s (cached). Set <code className="bg-slate-800 px-1 py-0.5 rounded text-[10px]">FAL_API_KEY</code> in your <code className="bg-slate-800 px-1 py-0.5 rounded text-[10px]">.env</code> file.
                    </p>
                </div>
            </div>

            {/* Usage & Billing */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden mt-7">
                <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <LineChart className="w-4 h-4 text-emerald-400" /> Usage & Billing
                    </h2>
                </div>
                <div className="p-5 flex gap-4">
                    <div className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                        <div className="text-xs text-slate-400 mb-1">Estimated Monthly Cost</div>
                        <div className="text-2xl font-bold text-emerald-400">
                            ${(status?.estimatedMonthlyCost ?? 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-500 mt-2">Based on this month's run rate</div>
                    </div>
                    <div className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                        <div className="text-xs text-slate-400 mb-1">Daily Spend (Today)</div>
                        <div className="text-2xl font-bold text-slate-200">
                            ${(status?.dailySpend ?? 0).toFixed(2)}
                            <span className="text-sm text-slate-500 font-normal"> / ${(status?.dailyCap ?? 5).toFixed(2)}</span>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-1.5 mt-3 overflow-hidden">
                            <div
                                className={cn("h-1.5 rounded-full transition-all", (status?.dailySpend ?? 0) / (status?.dailyCap ?? 5) > 0.8 ? 'bg-red-500' : 'bg-blue-500')}
                                style={{ width: `${Math.min(100, ((status?.dailySpend ?? 0) / (status?.dailyCap ?? 5)) * 100)}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* FAL API Key Status */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden mt-7">
                <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Key className="w-4 h-4 text-yellow-400" /> API Keys
                    </h2>
                </div>
                <div className="p-5 space-y-3">
                    {/* FAL API Key Row */}
                    <div className="flex flex-col gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-200">FAL_API_KEY</div>
                                <div className="text-xs text-slate-500 mt-0.5">Required for image generation</div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className={cn('flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border',
                                    falStatus === 'online' ? 'text-green-400 bg-green-400/10 border-green-400/20' :
                                        falStatus === 'auth_error' ? 'text-orange-400 bg-orange-400/10 border-orange-400/20' :
                                            'text-slate-400 bg-slate-700 border-slate-600'
                                )}>
                                    <div className={cn('w-1.5 h-1.5 rounded-full',
                                        falStatus === 'online' ? 'bg-green-400' :
                                            falStatus === 'auth_error' ? 'bg-orange-400' : 'bg-slate-500'
                                    )} />
                                    {falStatus === 'online' ? 'Configured' : falStatus === 'auth_error' ? 'Invalid Key' : 'Not Configured (or Fallback)'}
                                </div>
                                <button
                                    onClick={() => editingKey === 'fal' ? setEditingKey(null) : setEditingKey('fal')}
                                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    {editingKey === 'fal' ? 'Cancel' : 'Set Workspace Key'}
                                </button>
                            </div>
                        </div>
                        {editingKey === 'fal' && (
                            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-700/50">
                                <input
                                    type="password"
                                    value={keyValue}
                                    onChange={e => setKeyValue(e.target.value)}
                                    placeholder="sk-..."
                                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
                                />
                                <button
                                    onClick={() => handleSaveKey('fal')}
                                    disabled={saving || !keyValue.trim()}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                    {saving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* OPENAI API Key Row */}
                    <div className="flex flex-col gap-2 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-200">OPENAI_API_KEY</div>
                                <div className="text-xs text-slate-500 mt-0.5">Optional — required if USE_VISION=true</div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <span className={cn('flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border',
                                    status?.providerStatus?.openai ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-slate-400 bg-slate-700 border-slate-600'
                                )}>
                                    <div className={cn('w-1.5 h-1.5 rounded-full', status?.providerStatus?.openai ? 'bg-green-400' : 'bg-slate-500')} />
                                    {status?.providerStatus?.openai ? 'Configured' : 'Not Configured'}
                                </span>
                                <button
                                    onClick={() => editingKey === 'openai' ? setEditingKey(null) : setEditingKey('openai')}
                                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    {editingKey === 'openai' ? 'Cancel' : 'Set Workspace Key'}
                                </button>
                            </div>
                        </div>
                        {editingKey === 'openai' && (
                            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-700/50">
                                <input
                                    type="password"
                                    value={keyValue}
                                    onChange={e => setKeyValue(e.target.value)}
                                    placeholder="sk-..."
                                    className="flex-1 bg-[#0f172a] border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 font-mono"
                                />
                                <button
                                    onClick={() => handleSaveKey('openai')}
                                    disabled={saving || !keyValue.trim()}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                    {saving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-slate-500 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                        🔒 API keys are never exposed to the browser. Configure them in your <code className="bg-slate-700 px-1 rounded">.env</code> file on the server.
                        Get your Fal key at <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5">fal.ai/dashboard/keys <ExternalLink className="w-3 h-3" /></a>
                    </p>
                </div>
            </div>

            {/* Environment Info */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Server className="w-4 h-4 text-slate-400" /> Environment
                    </h2>
                </div>
                <div className="px-5 py-2">
                    <InfoRow label="Environment" value={<span className="text-xs bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded font-mono">DEV</span>} />
                    <InfoRow label="Backend" value="Express :3000" />
                    <InfoRow label="Frontend" value="Next.js :3001" />
                    <InfoRow label="Image Provider" value="Fal / Flux Dev" />
                    <div className="flex items-start justify-between py-2.5 border-b border-slate-800 last:border-0">
                        <span className="text-sm text-slate-400 mt-1">Vision Analysis API</span>
                        <div className="flex flex-col items-end text-right">
                            {status?.useVision && status?.hasOpenAIKey ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium">
                                    <Shield className="w-3.5 h-3.5" /> Enabled (OpenAI)
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400 text-xs font-medium">
                                    <ShieldAlert className="w-3.5 h-3.5" /> Bypassed (Synthetic Fallback)
                                </span>
                            )}
                            {(!status?.useVision || !status?.hasOpenAIKey) && (
                                <div className="text-[10px] text-slate-500 mt-1.5 max-w-[220px] leading-tight">
                                    To enable real Vision, set <code className="text-slate-400 bg-slate-800 px-1 rounded">USE_VISION=true</code> and provide an <code className="text-slate-400 bg-slate-800 px-1 rounded">OPENAI_API_KEY</code>.
                                </div>
                            )}
                        </div>
                    </div>
                    <InfoRow label="Auth Mode" value="Placeholder (cookie-based)" />
                    <InfoRow
                        label="Daily Spend"
                        value={<span className={cn(status?.dailySpend && status.dailySpend > 0 ? 'text-yellow-400' : 'text-slate-400')}>
                            ${(status?.dailySpend ?? 0).toFixed(2)} / ${(status?.dailyCap ?? 5).toFixed(2)}
                        </span>}
                    />
                </div>
            </div>

            {/* Tech Stack */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-purple-400" /> Tech Stack
                    </h2>
                </div>
                <div className="px-5 py-2">
                    <InfoRow label="Frontend" value="Next.js 16 + Tailwind v4 + shadcn/ui" />
                    <InfoRow label="State Management" value="TanStack Query v5" />
                    <InfoRow label="Backend" value="Express.js + Prisma + PostgreSQL" />
                    <InfoRow label="Queue" value="BullMQ + Redis" />
                    <InfoRow label="Image AI" value="fal.ai / Flux Dev" />
                    <InfoRow label="Vision AI" value="OpenAI GPT-4o (optional)" />
                </div>
            </div>

            {/* Auth */}
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-blue-400" /> Authentication
                    </h2>
                </div>
                <div className="p-5 space-y-3">
                    <div className="text-xs text-slate-400 bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                        <strong className="text-blue-400">DEV placeholder:</strong> Auth uses cookie <code className="bg-slate-800 px-1 rounded">pod-auth-token</code> with value <code className="bg-slate-800 px-1 rounded">dev-token-2024</code>. Replace with NextAuth.js or Clerk before production.
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="text-sm text-red-400 hover:text-red-300 border border-red-400/20 hover:border-red-400/40 px-4 py-2 rounded-lg transition-colors"
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
    );
}
