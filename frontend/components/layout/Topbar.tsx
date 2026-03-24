'use client';

import { useQuery } from '@tanstack/react-query';
import { apiStatus, type FalStatus } from '@/lib/api';
import { Wifi, WifiOff, AlertTriangle, ShieldAlert, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';

const FAL_CONFIG: Record<FalStatus, { label: string; color: string; dotClass: string; Icon: React.ElementType }> = {
    online: { label: 'Fal Online', color: 'text-success', dotClass: 'bg-success animate-pulse', Icon: Wifi },
    offline: { label: 'Fal Offline', color: 'text-danger', dotClass: 'bg-danger', Icon: WifiOff },
    auth_error: { label: 'Fal Auth Error', color: 'text-warn', dotClass: 'bg-warn animate-pulse', Icon: ShieldAlert },
    payload_error: { label: 'Fal Degraded', color: 'text-warn', dotClass: 'bg-warn', Icon: AlertTriangle },
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
    const spendColor = spendPct > 80 ? 'from-danger to-red-400' : spendPct > 50 ? 'from-warn to-orange-400' : 'from-accent to-purple-400';

    return (
        <header className="fixed top-0 left-[220px] right-0 h-14 z-10 flex items-center justify-between px-8 bg-bg-base/80 backdrop-blur-md border-b border-border-subtle">
            {/* Left: env banner + current job */}
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-warn/30 text-warn bg-warn-subtle">
                    DEV
                </span>
                {status?.currentJob && (
                    <div className="flex items-center gap-1.5 text-xs text-accent">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Job running…</span>
                    </div>
                )}
            </div>

            {/* Right: indicators */}
            <div className="flex items-center gap-5">
                {/* Daily spend bar */}
                <div className="hidden sm:flex flex-col items-end gap-0.5">
                    <span className="text-[10px] text-text-tertiary">Daily spend</span>
                    <div className="flex items-center gap-1.5">
                        <div className="w-20 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                            <div
                                className={cn('h-full bg-gradient-to-r transition-all duration-700', spendColor)}
                                style={{ width: `${spendPct}%` }}
                            />
                        </div>
                        <span className={cn('text-xs font-medium tabular-nums', spendPct > 80 ? 'text-danger' : 'text-text-primary')}>
                            ${spend.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-text-tertiary">/ ${cap.toFixed(2)}</span>
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
                            <Loader2 className="w-3.5 h-3.5 text-text-tertiary animate-spin" />
                        ) : (
                            <FalIcon className={cn('w-3.5 h-3.5', cfg.color)} />
                        )}
                        <span className={cn('text-xs font-medium', isLoading ? 'text-text-tertiary' : cfg.color)}>
                            {isLoading ? 'Checking…' : cfg.label}
                        </span>
                        <div className={cn('w-1.5 h-1.5 rounded-full', isLoading ? 'bg-text-tertiary' : cfg.dotClass)} />
                    </div>

                    {/* Tooltip with error message */}
                    {tooltipVisible && status?.falMessage && (
                        <div className="absolute right-0 top-7 z-50 w-64 px-3 py-2 bg-bg-surface border border-border-default rounded-[10px] shadow-xl text-xs text-text-secondary">
                            <div className="font-semibold text-warn mb-1">Last error</div>
                            <div className="text-text-tertiary break-words font-mono">{status.falMessage}</div>
                        </div>
                    )}
                    {tooltipVisible && !status?.falMessage && status && (
                        <div className="absolute right-0 top-7 z-50 w-48 px-3 py-2 bg-bg-surface border border-border-default rounded-[10px] shadow-xl text-xs text-text-secondary">
                            <div className={cn('font-semibold', cfg.color)}>{cfg.label}</div>
                            <div className="text-text-tertiary mt-0.5">Health check: 30s cache</div>
                        </div>
                    )}
                </div>

                {/* Quick new run */}
                <Link
                    href="/dashboard/factory"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-[8px] transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" />
                    New Run
                </Link>
            </div>
        </header>
    );
}
