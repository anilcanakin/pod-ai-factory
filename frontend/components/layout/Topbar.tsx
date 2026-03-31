'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiStatus, apiNotifications, type FalStatus } from '@/lib/api';
import { Wifi, WifiOff, AlertTriangle, ShieldAlert, Loader2, Plus, Bell, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';

const FAL_CONFIG: Record<FalStatus, { label: string; color: string; dotClass: string; Icon: React.ElementType }> = {
    online: { label: 'Fal Online', color: 'text-success', dotClass: 'bg-success animate-pulse', Icon: Wifi },
    offline: { label: 'Fal Offline', color: 'text-danger', dotClass: 'bg-danger', Icon: WifiOff },
    auth_error: { label: 'Fal Auth Error', color: 'text-warn', dotClass: 'bg-warn animate-pulse', Icon: ShieldAlert },
    payload_error: { label: 'Fal Degraded', color: 'text-warn', dotClass: 'bg-warn', Icon: AlertTriangle },
};

const TYPE_COLORS: Record<string, string> = {
    success: 'text-success',
    error: 'text-danger',
    warn: 'text-warn',
    info: 'text-accent',
};

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
}

export function Topbar() {
    const queryClient = useQueryClient();
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const [showNotifs, setShowNotifs] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);

    const { data: status, isLoading } = useQuery({
        queryKey: ['status'],
        queryFn: apiStatus.get,
        refetchInterval: 15000,
        retry: false,
    });

    const { data: notifications = [] } = useQuery({
        queryKey: ['notifications'],
        queryFn: apiNotifications.list,
        refetchInterval: showNotifs ? 5000 : 30000,
        staleTime: 5000,
    });

    const readAllMutation = useMutation({
        mutationFn: apiNotifications.readAll,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    });

    const unreadCount = notifications.filter(n => !n.read).length;

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
                setShowNotifs(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleOpenNotifs = () => {
        const next = !showNotifs;
        setShowNotifs(next);
        if (next && unreadCount > 0) {
            setTimeout(() => readAllMutation.mutate(), 1500);
        }
    };

    const falStatus = status?.fal ?? 'offline';
    const cfg = FAL_CONFIG[falStatus];
    const FalIcon = cfg.Icon;
    const spend = status?.dailySpend ?? 0;
    const cap = status?.dailyCap ?? 5;
    const spendPct = Math.min((spend / cap) * 100, 100);
    const spendColor = spendPct > 80 ? 'from-danger to-red-400' : spendPct > 50 ? 'from-warn to-orange-400' : 'from-accent to-purple-400';

    return (
        <header className="fixed top-0 left-[220px] right-0 h-14 z-10 flex items-center justify-between px-8 bg-bg-base/80 backdrop-blur-md border-b border-border-subtle">
            {/* Left */}
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

            {/* Right */}
            <div className="flex items-center gap-4">
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

                {/* Fal status pill */}
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

                {/* Notifications bell */}
                <div className="relative" ref={notifRef}>
                    <button
                        onClick={handleOpenNotifs}
                        className="relative flex items-center justify-center w-8 h-8 rounded-[8px] border border-border-default text-text-tertiary hover:text-text-primary hover:border-border-strong transition-colors"
                    >
                        <Bell className="w-4 h-4" />
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {showNotifs && (
                        <div className="absolute right-0 top-10 z-50 w-80 bg-bg-surface border border-border-default rounded-[12px] shadow-2xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
                                <span className="text-xs font-semibold text-text-primary">Activity</span>
                                {notifications.some(n => !n.read) && (
                                    <button
                                        onClick={() => readAllMutation.mutate()}
                                        className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
                                    >
                                        <CheckCheck className="w-3 h-3" /> Mark all read
                                    </button>
                                )}
                            </div>
                            <div className="max-h-80 overflow-y-auto scrollbar-thin">
                                {notifications.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-10 text-text-tertiary">
                                        <Bell className="w-6 h-6 mb-2 opacity-30" />
                                        <p className="text-xs">No activity yet</p>
                                    </div>
                                ) : (
                                    notifications.map(n => (
                                        <div
                                            key={n.id}
                                            className={cn(
                                                'flex items-start gap-3 px-4 py-3 border-b border-border-default/50 last:border-0',
                                                !n.read && 'bg-accent/5'
                                            )}
                                        >
                                            <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', !n.read ? 'bg-accent' : 'bg-transparent')} />
                                            <div className="flex-1 min-w-0">
                                                <p className={cn('text-xs leading-relaxed', TYPE_COLORS[n.type] || 'text-text-secondary')}>
                                                    {n.message}
                                                </p>
                                                <p className="text-[10px] text-text-tertiary mt-0.5">{timeAgo(n.createdAt)}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* New run */}
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
