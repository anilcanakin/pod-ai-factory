'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ConfirmModalProps {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
    open: boolean;
}

export function ConfirmModal({
    title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    variant = 'default', onConfirm, onCancel, open
}: ConfirmModalProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) setTimeout(() => confirmRef.current?.focus(), 50);
    }, [open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
            <div className="relative bg-[#1e293b] border border-slate-700 rounded-xl p-6 w-full max-w-sm shadow-2xl animate-fade-in">
                <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
                <p className="text-sm text-slate-400 mb-6">{message}</p>
                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={onConfirm}
                        className={cn(
                            'flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
                            variant === 'danger'
                                ? 'bg-red-600 hover:bg-red-500'
                                : 'bg-blue-600 hover:bg-blue-500'
                        )}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
