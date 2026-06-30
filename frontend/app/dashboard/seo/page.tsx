import { Suspense } from 'react';
import { SEOClient } from './SEOClient';

export default function SEOPage() {
    return (
        <Suspense>
            <SEOClient />
        </Suspense>
    );
}
