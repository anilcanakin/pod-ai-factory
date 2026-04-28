import { Suspense } from 'react';
import { GalleryClient } from './GalleryClient';

export default function GalleryPage() {
    return (
        <Suspense>
            <GalleryClient />
        </Suspense>
    );
}
