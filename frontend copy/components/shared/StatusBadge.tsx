'use client';

import { cn, getStatusColor } from '@/lib/utils';

interface BadgeProps {
    status: string;
    className?: string;
}

export function StatusBadge({ status, className }: BadgeProps) {
    const labels: Record<string, string> = {
        COMPLETED: 'Completed',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
        PENDING: 'Pending',
        PROCESSING: 'Processing',
        FAILED: 'Failed',
        SUCCESS: 'Success',
        WINNER: '🏆 Winner',
        LOW_SCORE: '💀 Low Score',
    };

    return (
        <span
            className={cn(
                'inline-flex items-center px-2 py-0.5 rounded-[6px] text-[10px] font-semibold uppercase tracking-[0.05em] border',
                getStatusColor(status),
                className
            )}
        >
            {labels[status] ?? status}
        </span>
    );
}
