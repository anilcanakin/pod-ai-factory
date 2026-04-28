import { Suspense } from 'react';
import { RemoveBgClient } from './RemoveBgClient';

export default function RemoveBgPage() {
    return (
        <Suspense>
            <RemoveBgClient />
        </Suspense>
    );
}
