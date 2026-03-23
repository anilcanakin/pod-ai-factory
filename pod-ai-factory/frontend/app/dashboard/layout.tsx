import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-[#0f172a]">
            <Sidebar />
            <Topbar />
            <main className="ml-56 pt-14 min-h-screen">
                <div className="p-6">{children}</div>
            </main>
        </div>
    );
}
