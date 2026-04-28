import { Suspense } from 'react';
import { MockupsClient } from './MockupsClient';

export default function MockupsPage() {
    return (
        <Suspense>
            <MockupsClient />
        </Suspense>
    );
}
