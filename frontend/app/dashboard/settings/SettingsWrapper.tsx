'use client';

import dynamic from 'next/dynamic';

const SettingsClient = dynamic(
    () => import('./SettingsClient').then(m => ({ default: m.SettingsClient })),
    { ssr: false }
);

export default function SettingsWrapper() {
    return <SettingsClient />;
}
