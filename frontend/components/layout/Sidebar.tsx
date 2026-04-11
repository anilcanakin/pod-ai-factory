'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
    LayoutDashboard,
    Cpu,
    Images,
    Lightbulb,
    BarChart3,
    Download,
    Settings,
    Zap,
    Frame,
    Scissors,
    ZoomIn,
    Tag,
    Wand2,
    Keyboard,
    X,
    Sun,
    Moon,
    Store,
    Brain,
    Bot,
    ShoppingBag,
    Radar,
    TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SHORTCUT_LABELS } from '@/hooks/useKeyboardShortcuts';

const navItems = [
    { href: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/agent', label: 'AI Manager', icon: Bot },
    { href: '/dashboard/brain', label: 'AI Brain', icon: Brain },
    { href: '/dashboard/orders', label: 'Orders', icon: ShoppingBag },
    { href: '/dashboard/radar', label: 'Radar', icon: Radar },
    { href: '/dashboard/factory', label: 'Factory', icon: Cpu },
    { href: '/dashboard/gallery', label: 'Gallery', icon: Images },
    { href: '/dashboard/mockups', label: 'Mockups', icon: Frame },
    { href: '/dashboard/ideas', label: 'Ideas', icon: Lightbulb },
    { href: '/dashboard/trends', label: 'Trends', icon: TrendingUp },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dashboard/exports', label: 'Exports', icon: Download },
    { href: '/dashboard/remove-bg', label: 'Remove BG', icon: Scissors },
    { href: '/dashboard/upscale', label: 'Upscale', icon: ZoomIn },
    { href: '/dashboard/vector', label: 'Vector', icon: Wand2 },
    { href: '/dashboard/seo', label: 'SEO Generator', icon: Tag },
    { href: '/dashboard/etsy-listings', label: 'My Listings', icon: Store },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    useEffect(() => {
        const stored = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
        setTheme(stored);
        document.documentElement.classList.toggle('light', stored === 'light');
    }, []);

    const toggleTheme = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        localStorage.setItem('theme', next);
        document.documentElement.classList.toggle('light', next === 'light');
    };

    return (
        <aside className="fixed left-0 top-0 h-screen w-[220px] flex flex-col bg-bg-base border-r border-border-subtle z-20">
            {/* Logo */}
            <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border-subtle">
                <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                    <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                    <span className="text-sm font-semibold text-text-primary leading-none" style={{ fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600 }}>POD AI</span>
                    <span className="block text-[10px] text-text-tertiary leading-none mt-0.5">Factory</span>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
                {navItems.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href || pathname.startsWith(href + '/');
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={cn(
                                'flex items-center gap-3 px-3 h-9 rounded-[8px] text-[13px] font-medium transition-all duration-150 relative',
                                active
                                    ? 'bg-accent-subtle text-accent border-l-2 border-accent'
                                    : 'text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.05)]'
                            )}
                        >
                            <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-accent' : 'text-text-tertiary')} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="px-4 py-4 border-t border-border-subtle space-y-3">
                {/* Theme toggle */}
                <button
                    onClick={toggleTheme}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                    {theme === 'dark'
                        ? <Sun className="w-3.5 h-3.5 flex-shrink-0" />
                        : <Moon className="w-3.5 h-3.5 flex-shrink-0" />
                    }
                    <span className="text-[11px]">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>

                {/* Keyboard shortcuts tooltip */}
                <div className="relative">
                    <button
                        onClick={() => setShowShortcuts(v => !v)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    >
                        <Keyboard className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-[11px]">Keyboard shortcuts</span>
                    </button>
                    {showShortcuts && (
                        <div className="absolute bottom-full left-0 mb-2 w-52 bg-bg-elevated border border-border-default rounded-[10px] shadow-xl p-3 z-50">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">Shortcuts</span>
                                <button onClick={() => setShowShortcuts(false)} className="text-text-tertiary hover:text-text-secondary">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                            <div className="space-y-1.5">
                                {SHORTCUT_LABELS.map(s => (
                                    <div key={s.keys} className="flex items-center justify-between">
                                        <span className="text-[11px] text-text-secondary">{s.label}</span>
                                        <kbd className="text-[10px] bg-bg-overlay text-text-tertiary border border-border-default px-1.5 py-0.5 rounded font-mono">
                                            {s.keys}
                                        </kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-purple-400 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        AD
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">Workspace Admin</p>
                        <p className="text-[10px] text-text-tertiary truncate">
                            {process.env.NEXT_PUBLIC_APP_MODE === 'saas' ? 'Mode: SaaS' : 'Mode: Self-Hosted'}
                        </p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
