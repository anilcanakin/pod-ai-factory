import { NextRequest, NextResponse } from 'next/server';

// Override the next.config.ts rewrite for this path — gives full timeout control.
// maxDuration for Vercel deployments; Node.js server relies on AbortSignal.timeout below.
export const maxDuration = 90;

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export async function POST(request: NextRequest) {
    const body = await request.text();

    const upstream = await fetch(`${BACKEND}/api/pipeline/one-click`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            cookie: request.headers.get('cookie') ?? '',
        },
        body,
        // 85 s — backend pipeline peaks around 41 s; leaves headroom without exceeding maxDuration
        signal: AbortSignal.timeout(85_000),
    });

    const data = await upstream.text();
    return new NextResponse(data, {
        status: upstream.status,
        headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
}
