import { Suspense } from 'react';
import { ToolsClient } from './ToolsClient';

export default function ToolsPage() {
    return (
        <Suspense>
            <ToolsClient />
        </Suspense>
    );
}
