'use client';

import { useState, useEffect } from 'react';

interface Plan {
    id: string;
    name: string;
    limit: number;
    priceMonthly: number;
    features: string[];
}

interface Usage {
    planName: string;
    planLimit: number;
    monthlyUsage: number;
    remaining: number;
    isOverLimit: boolean;
}

export default function BillingPage() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch('/api/billing/plans', { credentials: 'include' }).then(r => r.json()),
            fetch('/api/billing/usage', { credentials: 'include' }).then(r => r.json())
        ]).then(([plansData, usageData]) => {
            setPlans(plansData);
            setUsage(usageData);
            setLoading(false);
        });
    }, []);

    const handleCheckout = async (planName: string) => {
        const res = await fetch('/api/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ planName })
        });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
    };

    const handlePortal = async () => {
        const res = await fetch('/api/billing/portal', { credentials: 'include' });
        const data = await res.json();
        if (data.url) window.location.href = data.url;
    };

    if (loading) return <div style={{ padding: 32, color: '#888' }}>Loading billing...</div>;

    const usagePercent = usage ? Math.min(100, (usage.monthlyUsage / usage.planLimit) * 100) : 0;

    return (
        <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>💳 Billing & Plans</h1>
            <p style={{ color: '#888', marginBottom: 32 }}>
                Manage your subscription and monitor usage
            </p>

            {/* Current Usage */}
            {usage && (
                <div style={{
                    background: '#1a1a2e', borderRadius: 12, padding: 24, marginBottom: 32,
                    border: usage.isOverLimit ? '1px solid #ef4444' : '1px solid #333'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                            <h2 style={{ fontSize: 18, color: '#fff', marginBottom: 4 }}>
                                Current Plan: <span style={{ color: '#8b5cf6' }}>
                                    {usage.planName.charAt(0).toUpperCase() + usage.planName.slice(1)}
                                </span>
                            </h2>
                            <p style={{ color: '#888', fontSize: 14 }}>
                                {usage.monthlyUsage} / {usage.planLimit === 999999 ? '∞' : usage.planLimit} designs used this month
                            </p>
                        </div>
                        <button
                            onClick={handlePortal}
                            style={{
                                padding: '10px 20px', borderRadius: 8, border: '1px solid #444',
                                background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 13
                            }}
                        >
                            ⚙️ Manage Subscription
                        </button>
                    </div>

                    {/* Usage bar */}
                    <div style={{
                        width: '100%', height: 12, borderRadius: 6,
                        background: '#111', overflow: 'hidden'
                    }}>
                        <div style={{
                            width: `${usagePercent}%`, height: '100%', borderRadius: 6,
                            background: usage.isOverLimit
                                ? '#ef4444'
                                : usagePercent > 80
                                    ? '#f97316'
                                    : 'linear-gradient(90deg, #22c55e, #16a34a)',
                            transition: 'width 0.5s ease'
                        }} />
                    </div>

                    {usage.isOverLimit && (
                        <p style={{ color: '#ef4444', fontSize: 14, marginTop: 8 }}>
                            ⚠️ Plan limit reached! Upgrade to continue generating designs.
                        </p>
                    )}
                </div>
            )}

            {/* Plans Grid */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20
            }}>
                {plans.map(plan => {
                    const isCurrent = usage?.planName === plan.id;
                    const isPopular = plan.id === 'pro';

                    return (
                        <div key={plan.id} style={{
                            background: '#111', borderRadius: 16, padding: 28,
                            border: isPopular ? '2px solid #8b5cf6' : '1px solid #222',
                            position: 'relative',
                            transform: isPopular ? 'scale(1.03)' : 'none'
                        }}>
                            {isPopular && (
                                <div style={{
                                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                                    background: '#8b5cf6', color: '#fff', padding: '4px 16px',
                                    borderRadius: 20, fontSize: 12, fontWeight: 600
                                }}>
                                    MOST POPULAR
                                </div>
                            )}

                            <h3 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                                {plan.name}
                            </h3>
                            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
                                ${plan.priceMonthly}
                                <span style={{ fontSize: 14, color: '#666', fontWeight: 400 }}>/month</span>
                            </div>
                            <div style={{ fontSize: 14, color: '#888', marginBottom: 20 }}>
                                {plan.limit === 999999 ? 'Unlimited' : plan.limit} designs / month
                            </div>

                            <ul style={{ listStyle: 'none', padding: 0, marginBottom: 24 }}>
                                {plan.features.map((f, i) => (
                                    <li key={i} style={{
                                        padding: '6px 0', color: '#bbb', fontSize: 14,
                                        borderBottom: '1px solid #1a1a1a'
                                    }}>
                                        ✅ {f}
                                    </li>
                                ))}
                            </ul>

                            <button
                                onClick={() => handleCheckout(plan.id)}
                                disabled={isCurrent}
                                style={{
                                    width: '100%', padding: '14px', borderRadius: 8, border: 'none',
                                    background: isCurrent ? '#333' : isPopular
                                        ? 'linear-gradient(135deg, #8b5cf6, #6366f1)'
                                        : '#222',
                                    color: isCurrent ? '#666' : '#fff',
                                    fontWeight: 600, cursor: isCurrent ? 'default' : 'pointer',
                                    fontSize: 15, transition: 'all 0.2s'
                                }}
                            >
                                {isCurrent ? '✓ Current Plan' : 'Upgrade'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
