import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
    }).format(value);
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

export function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getStatusColor(status: string): string {
    const map: Record<string, string> = {
        COMPLETED: "text-success bg-success-subtle border-[rgba(34,197,94,0.20)]",
        APPROVED: "text-accent bg-accent-subtle border-accent-border",
        REJECTED: "text-danger bg-danger-subtle border-[rgba(239,68,68,0.20)]",
        PENDING: "text-warn bg-warn-subtle border-[rgba(245,158,11,0.20)]",
        PROCESSING: "text-accent bg-accent-subtle border-accent-border",
        FAILED: "text-danger bg-danger-subtle border-[rgba(239,68,68,0.20)]",
        SUCCESS: "text-success bg-success-subtle border-[rgba(34,197,94,0.20)]",
        WINNER: "text-warn bg-warn-subtle border-[rgba(245,158,11,0.20)]",
        LOW_SCORE: "text-danger bg-danger-subtle border-[rgba(239,68,68,0.20)]",
    };
    return map[status] ?? "text-text-secondary bg-[rgba(255,255,255,0.05)] border-border-default";
}

export function truncateId(id: string, length = 8): string {
    return id?.substring(0, length) ?? "—";
}
