'use client';

import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
    label: string;
    value: string | number;
    icon: LucideIcon;
    trend?: number;
    loading?: boolean;
    color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
    suffix?: string;
}

const colorMap = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    yellow: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
};

export function StatCard({ label, value, icon: Icon, trend, loading, color = 'blue', suffix }: StatCardProps) {
    if (loading) {
        return (
            <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 animate-pulse">
                <div className="flex justify-between items-start mb-4">
                    <div className="w-16 h-3 bg-slate-700 rounded" />
                    <div className="w-9 h-9 bg-slate-700 rounded-lg" />
                </div>
                <div className="w-24 h-7 bg-slate-700 rounded mb-1" />
                <div className="w-12 h-2.5 bg-slate-700 rounded" />
            </div>
        );
    }

    return (
        <div className="bg-[#1e293b] border border-slate-700 rounded-xl p-5 card-hover group">
            <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
                <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center', colorMap[color])}>
                    <Icon className="w-4 h-4" />
                </div>
            </div>
            <p className="text-2xl font-bold text-white tabular-nums">
                {value}{suffix && <span className="text-base font-normal text-slate-400 ml-1">{suffix}</span>}
            </p>
            {trend !== undefined && (
                <div className={cn('flex items-center gap-1 mt-1.5 text-xs font-medium', trend >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(trend)}% vs yesterday
                </div>
            )}
        </div>
    );
}
