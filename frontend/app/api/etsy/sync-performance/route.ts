import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export async function POST(req: NextRequest) {
    const cookie = req.headers.get('cookie') || '';
    const upstream = await fetch(`${BACKEND}/api/etsy/sync-performance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
}
