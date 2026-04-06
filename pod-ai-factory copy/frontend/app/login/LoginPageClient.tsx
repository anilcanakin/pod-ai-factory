'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Zap, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const schema = z.object({
    email: z.string().email('Valid email required'),
    password: z.string().min(4, 'Password required'),
});

type FormData = z.infer<typeof schema>;

export default function LoginPageClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const from = searchParams.get('from') || '/dashboard';
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);

    const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { email: 'admin@pod-factory.com', password: 'dev-token-2024' },
    });

    const onSubmit = async (data: FormData) => {
        setLoading(true);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                credentials: 'include'
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Login failed');

            // Refetch to confirm session as requested
            const meRes = await fetch('/api/auth/me', { credentials: 'include' });
            if (!meRes.ok) throw new Error('Session verification failed');

            toast.success('Signed in successfully');
            router.push(from);
            router.refresh();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-sm">
                <div className="bg-[#1e293b] border border-slate-700 rounded-2xl p-8 shadow-2xl">
                    {/* Logo */}
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-3 shadow-lg shadow-blue-600/30">
                            <Zap className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-white">POD AI Factory</h1>
                        <p className="text-sm text-slate-400 mt-1">Admin Panel</p>
                    </div>

                    {/* DEV Banner */}
                    <div className="flex items-center gap-2 px-3 py-2 mb-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <ShieldCheck className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                        <p className="text-xs text-yellow-400">
                            DEV MODE — password: <code className="bg-yellow-500/20 px-1 rounded">dev-token-2024</code>
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                            <input
                                {...register('email')}
                                type="email"
                                className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                            />
                            {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                            <div className="relative">
                                <input
                                    {...register('password')}
                                    type={showPass ? 'text' : 'password'}
                                    className="w-full bg-[#0f172a] border border-slate-700 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                            {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-medium rounded-lg transition-colors text-sm mt-2"
                        >
                            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                            {loading ? 'Signing in…' : 'Sign In'}
                        </button>
                    </form>
                </div>

                <p className="text-center text-xs text-slate-600 mt-4">
                    Auth placeholder · Not production-ready
                </p>
            </div>
        </div>
    );
}
