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
        COMPLETED: "text-green-400 bg-green-400/10 border-green-400/20",
        APPROVED: "text-green-400 bg-green-400/10 border-green-400/20",
        REJECTED: "text-red-400 bg-red-400/10 border-red-400/20",
        PENDING: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
        PROCESSING: "text-blue-400 bg-blue-400/10 border-blue-400/20",
        FAILED: "text-red-400 bg-red-400/10 border-red-400/20",
        SUCCESS: "text-green-400 bg-green-400/10 border-green-400/20",
        WINNER: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
        LOW_SCORE: "text-red-400 bg-red-400/10 border-red-400/20",
    };
    return map[status] ?? "text-slate-400 bg-slate-400/10 border-slate-400/20";
}

export function truncateId(id: string, length = 8): string {
    return id?.substring(0, length) ?? "—";
}
