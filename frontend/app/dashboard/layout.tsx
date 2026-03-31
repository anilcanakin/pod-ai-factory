import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ShortcutsInit } from '@/components/ShortcutsInit';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-bg-base">
            <ShortcutsInit />
            <Sidebar />
            <Topbar />
            <main className="ml-[220px] pt-14 min-h-screen">
                <div className="p-8">{children}</div>
            </main>
        </div>
    );
}
