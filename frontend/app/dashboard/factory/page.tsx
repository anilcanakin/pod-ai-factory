import { Suspense } from 'react';
import { FactoryClient } from './FactoryClient';

export default function FactoryWizardPage() {
    return (
        <Suspense>
            <FactoryClient />
        </Suspense>
    );
}
