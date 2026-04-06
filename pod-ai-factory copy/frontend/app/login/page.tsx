import { Suspense } from 'react';
import LoginPageClient from './LoginPageClient';

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
        }>
            <LoginPageClient />
        </Suspense>
    );
}
