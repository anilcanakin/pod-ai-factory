'use client';

import { useQuery } from '@tanstack/react-query';
import { apiStatus, type FalStatus } from '@/lib/api';
import { Wifi, WifiOff, AlertTriangle, ShieldAlert, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';

const FAL_CONFIG: Record<FalStatus, { label: string; color: string; dotClass: string; Icon: React.ElementType }> = {
    online: { label: 'Fal Online', color: 'text-green-400', dotClass: 'bg-green-400 animate-pulse', Icon: Wifi },
    offline: { label: 'Fal Offline', color: 'text-red-400', dotClass: 'bg-red-400', Icon: WifiOff },
    auth_error: { label: 'Fal Auth Error', color: 'text-orange-400', dotClass: 'bg-orange-400 animate-pulse', Icon: ShieldAlert },
    payload_error: { label: 'Fal Degraded', color: 'text-yellow-400', dotClass: 'bg-yellow-400', Icon: AlertTriangle },
};

export function Topbar() {
    const [tooltipVisible, setTooltipVisible] = useState(false);

    const { data: status, isLoading } = useQuery({
        queryKey: ['status'],
        queryFn: apiStatus.get,
        refetchInterval: 15000,
        retry: false,
    });

    const falStatus = status?.fal ?? 'offline';
    const cfg = FAL_CONFIG[falStatus];
    const FalIcon = cfg.Icon;
    const spend = status?.dailySpend ?? 0;
    const cap = status?.dailyCap ?? 5;
    const spendPct = Math.min((spend / cap) * 100, 100);
    const spendColor = spendPct > 80 ? 'from-red-500 to-red-400' : spendPct > 50 ? 'from-yellow-500 to-orange-400' : 'from-blue-500 to-cyan-400';

    return (
        <header className="fixed top-0 left-56 right-0 h-14 z-10 flex items-center justify-between px-6 bg-[#0d1526]/80 backdrop-blur-md border-b border-slate-800">
            {/* Left: env banner + current job */}
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-yellow-500/30 text-yellow-500 bg-yellow-500/10">
                    DEV
                </span>
                {status?.currentJob && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Job running…</span>
                    </div>
                )}
            </div>

            {/* Right: indicators */}
            <div className="flex items-center gap-5">
                {/* Daily spend bar */}
                <div className="hidden sm:flex flex-col items-end gap-0.5">
                    <span className="text-[10px] text-slate-500">Daily spend</span>
                    <div className="flex items-center gap-1.5">
                        <div className="w-20 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                            <div
                                className={cn('h-full bg-gradient-to-r transition-all duration-700', spendColor)}
                                style={{ width: `${spendPct}%` }}
                            />
                        </div>
                        <span className={cn('text-xs font-medium tabular-nums', spendPct > 80 ? 'text-red-400' : 'text-slate-300')}>
                            ${spend.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-slate-600">/ ${cap.toFixed(2)}</span>
                    </div>
                </div>

                {/* Fal status pill with tooltip */}
                <div
                    className="relative"
                    onMouseEnter={() => setTooltipVisible(true)}
                    onMouseLeave={() => setTooltipVisible(false)}
                >
                    <div className="flex items-center gap-1.5 cursor-default">
                        {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                        ) : (
                            <FalIcon className={cn('w-3.5 h-3.5', cfg.color)} />
                        )}
                        <span className={cn('text-xs font-medium', isLoading ? 'text-slate-500' : cfg.color)}>
                            {isLoading ? 'Checking…' : cfg.label}
                        </span>
                        <div className={cn('w-1.5 h-1.5 rounded-full', isLoading ? 'bg-slate-600' : cfg.dotClass)} />
                    </div>

                    {/* Tooltip with error message */}
                    {tooltipVisible && status?.falMessage && (
                        <div className="absolute right-0 top-7 z-50 w-64 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300">
                            <div className="font-semibold text-orange-400 mb-1">Last error</div>
                            <div className="text-slate-400 break-words font-mono">{status.falMessage}</div>
                        </div>
                    )}
                    {tooltipVisible && !status?.falMessage && status && (
                        <div className="absolute right-0 top-7 z-50 w-48 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300">
                            <div className={cn('font-semibold', cfg.color)}>{cfg.label}</div>
                            <div className="text-slate-500 mt-0.5">Health check: 30s cache</div>
                        </div>
                    )}
                </div>

                {/* Quick new run */}
                <Link
                    href="/dashboard/factory"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                    New Run
                </Link>
            </div>
        </header>
    );
}
