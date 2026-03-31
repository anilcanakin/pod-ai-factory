import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SHORTCUTS: Record<string, string> = {
    'ctrl+shift+f': '/dashboard/factory',
    'ctrl+shift+g': '/dashboard/gallery',
    'ctrl+shift+s': '/dashboard/seo',
    'ctrl+shift+m': '/dashboard/mockups',
};

export function useKeyboardShortcuts() {
    const router = useRouter();

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName.toLowerCase();
            if (['input', 'textarea', 'select'].includes(tag)) return;

            const key = [
                e.ctrlKey && 'ctrl',
                e.shiftKey && 'shift',
                e.key.toLowerCase(),
            ].filter(Boolean).join('+');

            const route = SHORTCUTS[key];
            if (route) {
                e.preventDefault();
                router.push(route);
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [router]);
}

export const SHORTCUT_LABELS = [
    { keys: 'Ctrl+Shift+F', label: 'Factory' },
    { keys: 'Ctrl+Shift+G', label: 'Gallery' },
    { keys: 'Ctrl+Shift+S', label: 'SEO' },
    { keys: 'Ctrl+Shift+M', label: 'Mockups' },
];
