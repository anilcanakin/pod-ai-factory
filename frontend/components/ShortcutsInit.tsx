'use client';

import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export function ShortcutsInit() {
    useKeyboardShortcuts();
    return null;
}
