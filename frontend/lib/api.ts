// Central API client - all calls proxy to Express :3000 via Next.js rewrites

// If running locally, we want to hit the Next.js API route (/api) which is rewritten to the backend on :3000.
// This avoids CORS issues. In production it can pointing to a different API origin.
const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : '';

const BASE = API_URL ? `${API_URL}/api` : '/api';

async function request<T>(
    path: string,
    options?: RequestInit
): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        ...options,
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            msg = body.error || body.message || msg;
        } catch { }
        throw new Error(msg);
    }

    return res.json() as Promise<T>;
}

// ─── Status ───────────────────────────────────────────────────
export type FalStatus = 'online' | 'offline' | 'auth_error' | 'payload_error';

export interface StatusResponse {
    fal: FalStatus;
    falMessage: string | null;
    dailySpend: number;
    estimatedMonthlyCost?: number;
    dailyCap: number;
    useVision?: boolean;
    hasOpenAIKey?: boolean;
    currentJob: string | null;
    providerStatus?: Record<string, boolean>;
    workspaceId?: string | null;
}

export const apiStatus = {
    get: () => request<StatusResponse>('/status'),
};

// ─── Dashboard ────────────────────────────────────────────────
export interface WeeklyStatDay {
    date: string;
    images: number;
    approved: number;
    spend: number;
}

export interface DashboardData {
    runsToday: number;
    imagesGeneratedToday: number;
    approvedToday: number;
    spendToday: number;
    successRate: number;
    recentJobs: Array<{ id: string; originalImage: string; status: string; imageCount: number; spend: number; createdAt: string; previewUrl: string | null }>;
    topApproved: Array<{ id: string; imageUrl: string; performanceScore: number; jobId: string }>;
    weeklyStats: WeeklyStatDay[];
    avgGenerationTime: number | null;
}

export const apiDashboard = {
    get: () => request<DashboardData>('/dashboard'),
};

// ─── Vision (Legacy — kept for backward compat) ──────────────
export interface VisionData {
    style: string;
    layout: string;
    typography: string;
    icon_description: string;
    palette: string[];
}

export const apiVision = {
    analyze: (imageUrl: string) =>
        request<VisionData>('/vision/analyze', {
            method: 'POST',
            body: JSON.stringify({ imageUrl }),
        }),
};

// ─── Factory (New Pipeline) ───────────────────────────────────
export interface AIModel {
    id: string;
    name: string;
    description: string;
    speed: 'fast' | 'medium' | 'slow';
    strength: 'general' | 'speed' | 'typography' | 'vector';
}

export const apiFactory = {
    getModels: () => request<AIModel[]>('/factory/models'),
    analyze: (payload: { referenceImageIds: string[] }) =>
        request<{ prompt: string; isSynthetic: boolean; provider?: 'anthropic' | 'gemini' | 'openai' | 'synthetic' }>(
            '/factory/analyze',
            { method: 'POST', body: JSON.stringify(payload) }
        ),
    getVariations: (payload: {
        basePrompt: string;
        count: number;
        variationMode: 'subject' | 'style' | 'color';
    }) =>
        request<{ variations: string[] }>(
            '/factory/get-variations',
            { method: 'POST', body: JSON.stringify(payload) }
        ),
    generate: (payload: {
        prompts: string[];
        model: string;
        imageSize: string;
        negativePrompt?: string;
    }) =>
        request<{ jobId: string; imageCount: number; message: string }>(
            '/factory/generate',
            { method: 'POST', body: JSON.stringify(payload) }
        ),
};

// ─── Jobs ─────────────────────────────────────────────────────
export interface JobSummary {
    id: string;
    status: string;
    createdAt: string;
    imageCount: number;
    previewUrl: string | null;
}

export const apiJobs = {
    list: () => request<JobSummary[]>('/jobs'),
    getLogs: (jobId: string) =>
        request<Array<{ id: string; eventType: string; status: string; message: string; createdAt: string }>>(
            `/jobs/${jobId}/logs`
        ),
    retry: (jobId: string, step?: string) =>
        request<{ message: string }>(`/jobs/${jobId}/retry${step ? `?step=${step}` : ''}`, { method: 'POST' }),
};

// ─── Gallery ──────────────────────────────────────────────────
export interface GalleryImage {
    id: string;
    imageUrl: string;
    placeholderUrl: string | null;
    status: string;
    isApproved: boolean;
    engine: string | null;
    seed: string | null;
    cost: number;
    createdAt: string;
    rawResponse?: string | null;
}

export const apiGallery = {
    getImages: (jobId: string) => request<GalleryImage[]>(`/gallery/${jobId}`),
    getRecent: () => request<GalleryImage[]>('/gallery/recent'),
    approve: (imageId: string) => request<GalleryImage>(`/gallery/${imageId}/approve`, { method: 'POST' }),
    reject: (imageId: string) => request<GalleryImage>(`/gallery/${imageId}/reject`, { method: 'POST' }),
    regenerate: (imageId: string) => request<{ message: string }>(`/gallery/${imageId}/regenerate`, { method: 'POST' }),
};

// ─── Pipeline ─────────────────────────────────────────────────
export const apiPipeline = {
    run: (imageId: string) =>
        request<{ message: string }>('/pipeline/run', {
            method: 'POST',
            body: JSON.stringify({ imageId }),
        }),
    runJob: (jobId: string) =>
        request<{ message: string; results: Array<{ imageId: string; status: string; error?: string }> }>(`/pipeline/run-job/${jobId}`, {
            method: 'POST',
        }),
};

// ─── Export ───────────────────────────────────────────────────
export const apiExport = {
    csvUrl: (jobId: string) => `${BASE}/export/job/${jobId}/csv`,
    bundleUrl: (jobId: string) => `${BASE}/export/job/${jobId}/bundle`,
};

// ─── Ideas ────────────────────────────────────────────────────
export interface Idea {
    id: string;
    niche: string;
    mainKeyword: string;
    hook: string;
    styleEnum: string;
    status: string;
    trademarkRisk?: boolean;
}

export const apiIdeas = {
    list: () => request<Idea[]>('/ideas'),
    generate: (formData: FormData) =>
        fetch(`${BASE}/ideas/generate`, { method: 'POST', body: formData }).then(async (res) => {
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return res.json();
        }),
    updateStatus: (id: string, status: string) =>
        request<Idea>(`/ideas/${id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status }),
        }),
    sendToFactory: (id: string) =>
        request<{ jobId: string }>(`/ideas/${id}/factory`, { method: 'POST' }),
};

// ─── Analytics ────────────────────────────────────────────────
export interface PerformanceRecord {
    id: string;
    imageId: string;
    sku: string;
    impressions: number;
    visits: number;
    favorites: number;
    orders: number;
    score: number;
    flag: string;
    imageUrl: string | null;
    imageStatus: string;
}

export const apiAnalytics = {
    getPerformance: () => request<PerformanceRecord[]>('/analytics/performance'),
    import: (formData: FormData) =>
        fetch(`${BASE}/analytics/import`, { method: 'POST', body: formData }).then(async (res) => {
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return res.json();
        }),
};

// ─── Mockups — Standard v1 ────────────────────────────────────
export interface MockupPrintArea {
    x: number; y: number; width: number; height: number;
}
export interface MockupTransform {
    rotation: number; opacity: number; blendMode: string;
}
export interface MockupRender {
    renderMode: string;
    displacementMapPath?: string | null;
    perspective?: unknown | null;
}
export interface MockupMeta {
    view: string; background: string; color: string; hasHumanModel: boolean;
}
export interface MockupConfig {
    printArea: MockupPrintArea;
    transform: MockupTransform;
    render: MockupRender;
    meta: MockupMeta;
}

export interface MockupTemplate {
    id: string;
    workspaceId: string;
    name: string;
    category: string;
    baseImagePath: string;
    maskImagePath: string | null;
    shadowImagePath: string | null;
    configJson: MockupConfig;
    createdAt: string;
    updatedAt: string;
}

export interface MockupRecord {
    id: string;
    imageId: string;
    templateId: string;
    mockupUrl: string;
    createdAt: string;
}

export const apiMockups = {
    // Templates
    listTemplates: (category?: string) =>
        request<{ templates: MockupTemplate[]; total: number }>(`/mockups/templates${category ? `?category=${category}` : ''}`),
    getTemplate: (id: string) => request<MockupTemplate>(`/mockups/templates/${id}`),
    getPresets: () => request<{ categories: string[]; presets: Record<string, { printArea: MockupPrintArea }> }>('/mockups/templates/presets'),
    uploadTemplate: (formData: FormData) =>
        fetch(`${BASE}/mockups/templates`, { method: 'POST', body: formData }).then(async (res) => {
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return res.json() as Promise<MockupTemplate>;
        }),
    updateTemplate: (id: string, data: { name?: string; category?: string; configJson?: Partial<MockupConfig> }) =>
        request<MockupTemplate>(`/mockups/templates/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
    deleteTemplate: (id: string) =>
        request<{ message: string }>(`/mockups/templates/${id}`, { method: 'DELETE' }),

    // Render
    render: (imageId: string, templateId: string, placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }) =>
        request<MockupRecord>('/mockups/render', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateId, placement }),
        }),
    renderBatch: (imageId: string, templateIds: string[], placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }) =>
        request<{ message: string; results: { templateId: string; templateName: string; status: string; url?: string; error?: string }[] }>('/mockups/render-batch', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateIds, placement }),
        }),
};

// ─── SEO Generator ────────────────────────────────────────────
export interface EtsySEO {
    title: string;
    description: string;
    tags: string[];
    charCount: number;
    topKeywords?: string[];
    etsySuggestions?: string[];
    dataSource?: string;
}

export const apiSeo = {
    generate: (imageUrl: string, keyword?: string) =>
        request<EtsySEO>('/seo/generate', {
            method: 'POST',
            body: JSON.stringify({ imageUrl, keyword })
        }),
};

// ─── Tools (BG Removal & Upscale) ─────────────────────────────
export const apiTools = {
    removeBg: (imageUrl: string, model: 'birefnet' | 'bria' | 'pixelcut' = 'birefnet') =>
        request<{ url: string; model: string }>('/tools/remove-bg', {
            method: 'POST',
            body: JSON.stringify({ imageUrl, model })
        }),
    upscale: (imageUrl: string, scale: number = 4) =>
        request<{ url: string; scale: string; model: string }>('/tools/upscale', {
            method: 'POST',
            body: JSON.stringify({ imageUrl, scale })
        }),
};
