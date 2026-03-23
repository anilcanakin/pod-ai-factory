'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
    { href: '/dashboard/overview', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/factory', label: 'Factory', icon: Cpu },
    { href: '/dashboard/gallery', label: 'Gallery', icon: Images },
    { href: '/dashboard/mockups', label: 'Mockups', icon: Frame },
    { href: '/dashboard/ideas', label: 'Ideas', icon: Lightbulb },
    { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/dashboard/exports', label: 'Exports', icon: Download },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="fixed left-0 top-0 h-screen w-56 flex flex-col bg-[#0d1526] border-r border-slate-800 z-20">
            {/* Logo */}
            <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                    <span className="text-sm font-semibold text-white leading-none">POD AI</span>
                    <span className="block text-[10px] text-slate-500 leading-none mt-0.5">Factory</span>
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
                                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                                active
                                    ? 'bg-blue-600/15 text-blue-400 border border-blue-600/20'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                            )}
                        >
                            <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-blue-400' : 'text-slate-500')} />
                            {label}
                        </Link>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="px-4 py-4 border-t border-slate-800">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        AD
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-300 truncate">Workspace Admin</p>
                        <p className="text-[10px] text-slate-500 truncate">
                            {process.env.NEXT_PUBLIC_APP_MODE === 'saas' ? 'Mode: SaaS' : 'Mode: Self-Hosted'}
                        </p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
