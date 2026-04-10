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
        credentials: 'include',
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
    saveMockup: (imageUrl: string, designImageId?: string) => request<GalleryImage>('/gallery/save-mockup', {
        method: 'POST',
        body: JSON.stringify({ imageUrl, designImageId }),
    }),
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
        fetch(`${BASE}/ideas/generate`, { method: 'POST', credentials: 'include', body: formData }).then(async (res) => {
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
    generateBulk: (niche: string) =>
        request<{ message: string; ideas: Idea[] }>('/ideas/generate-bulk', {
            method: 'POST',
            body: JSON.stringify({ niche }),
        }),
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
        fetch(`${BASE}/analytics/import`, { method: 'POST', credentials: 'include', body: formData }).then(async (res) => {
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
    printAreas?: Array<{ id: string; label: string; x: number; y: number; width: number; height: number }>;
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
    darkImagePath?: string | null;
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
        fetch(`${BASE}/mockups/templates`, { method: 'POST', credentials: 'include', body: formData }).then(async (res) => {
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
    render: (imageId: string, templateId: string, placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }, areaDesigns?: Record<string, { imageId: string; imageUrl: string }>) =>
        request<MockupRecord>('/mockups/render', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateId, placement, areaDesigns }),
        }),
    renderBatch: (imageId: string, templateIds: string[], placement?: { scale: number; offsetX: number; offsetY: number; rotation: number }) =>
        request<{ message: string; results: { templateId: string; templateName: string; status: string; url?: string; error?: string }[] }>('/mockups/render-batch', {
            method: 'POST',
            body: JSON.stringify({ imageId, templateIds, placement }),
        }),
    renderVideo: (mockupImageUrl: string, motionType: 'subtle' | 'rotate' | 'wave' | 'zoom' = 'subtle', duration: number = 5) =>
        request<{ videoUrl: string; duration: string; motionType: string }>('/mockups/templates/render-video', {
            method: 'POST',
            body: JSON.stringify({ mockupImageUrl, motionType, duration }),
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
        request<{ url: string; model: string; savedImageId?: string }>('/tools/remove-bg', {
            method: 'POST',
            body: JSON.stringify({ imageUrl, model })
        }),
    upscale: (imageUrl: string, scale: number = 4) =>
        request<{ url: string; scale: string; model: string; savedImageId?: string }>('/tools/upscale', {
            method: 'POST',
            body: JSON.stringify({ imageUrl, scale })
        }),
    vectorize: (imageUrl: string) =>
        request<{ url: string; model: string }>('/tools/vectorize', {
            method: 'POST',
            body: JSON.stringify({ imageUrl })
        }),
};

// ─── Notifications ─────────────────────────────────────────────
export interface Notification {
    id: string;
    type: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    read: boolean;
}

export const apiNotifications = {
    list: () => request<Notification[]>('/notifications'),
    log: (type: string, message: string, metadata?: Record<string, unknown>) =>
        request<Notification>('/notifications/log', {
            method: 'POST',
            body: JSON.stringify({ type, message, metadata }),
        }),
    readAll: () => request<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
};

// ─── AI Corporate Brain (Multimodal RAG) ─────────────────────
export interface CorporateMemory {
    id: string;
    type: string;
    title: string;
    content: string;
    sourceUrl?: string | null;
    analysisResult: {
        // Legacy Gemini format
        summary?: string;
        actionableRules?: Array<{ condition: string; action: string; rationale: string }>;
        uiInsights?: Array<{ element: string; recommendation: string }>;
        strategicNotes?: string[];
        // Enhanced Claude format
        synthesis?: string;
        transcript?: string;
        frameCount?: number;
        videoType?: string;
        sourceType?: string;
        source?: string;
        seoUpdated?: boolean;
    } | null;
    createdAt: string;
}

export interface VideoAnalysis {
    transcript: string;
    frameCount: number;
    synthesis: string;
    videoType: string;
    memory: CorporateMemory;
    seoUpdated: boolean;
}

export interface KnowledgeGroup {
    entries: CorporateMemory[];
    grouped: { video: CorporateMemory[]; text: CorporateMemory[]; auto: CorporateMemory[] };
    total: number;
}

export const apiBrain = {
    list: () => request<CorporateMemory[]>('/brain'),
    getKnowledge: () => request<KnowledgeGroup>('/brain/knowledge'),
    ingestVideo: (formData: FormData) =>
        fetch(`${BASE}/brain/ingest-video`, { method: 'POST', credentials: 'include', body: formData }).then(async (res) => {
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return res.json() as Promise<CorporateMemory>;
        }),
    analyzeVideo: (formData: FormData, onProgress?: (pct: number) => void): Promise<VideoAnalysis> =>
        new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${BASE}/brain/analyze-video`);
            xhr.withCredentials = true;
            if (onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
                };
            }
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid response')); }
                } else {
                    try {
                        const body = JSON.parse(xhr.responseText);
                        reject(new Error(body.error || `HTTP ${xhr.status}`));
                    } catch { reject(new Error(`HTTP ${xhr.status}`)); }
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(formData);
        }),
    addText: (title: string, content: string, source: string) =>
        request<CorporateMemory & { seoUpdated: boolean }>('/brain/add-text', {
            method: 'POST',
            body: JSON.stringify({ title, content, source })
        }),
    delete: (id: string) => request<{ success: boolean }>(`/brain/${id}`, { method: 'DELETE' }),
};

// ─── AI Autonomous Manager (Store Agent) ───────────────────
export interface AgentAction {
    listingId: string;
    actionType: 'UPDATE_PRICE' | 'UPDATE_SEO' | 'UPDATE_MOCKUP' | 'NOTIFICATION';
    reason: string;
    details: Record<string, unknown>;
}

export interface AuditPlan {
    executiveSummary: string;
    actions: AgentAction[];
}

export const apiAgent = {
    runAudit: () => request<AuditPlan>('/agent/audit', { method: 'POST' }),
    applyAction: (action: AgentAction) => request<{ success: boolean }>('/agent/execute-action', {
        method: 'POST',
        body: JSON.stringify(action)
    }),
};

// ─── Etsy Operations (Browser Agent) ─────────────────────────
export interface PinterestPin {
    imageUrl: string;
    title: string;
    description: string;
    link?: string;
}

export const apiEtsy = {
    pinToPinterest: (pin: PinterestPin) => request<{ success: boolean }>('/etsy-browser/pin-pinterest', {
        method: 'POST',
        body: JSON.stringify(pin)
    }),
    dispatch: (designId: string) => request<{ success: boolean; message: string }>('/etsy-browser/dispatch', {
        method: 'POST',
        body: JSON.stringify({ designId })
    }),
};

// ─── Order Fulfillment (POD Production) ───────────────────
export interface OrderItem {
    id: string;
    customer: string;
    product: string;
    sku: string;
    designUrl: string;
    status: 'AWAITING_FULFILLMENT' | 'IN_PRODUCTION' | 'SHIPPED';
}

export const apiFulfillment = {
    listOrders: () => request<OrderItem[]>('/fulfillment/orders'),
    submitOrder: (orderId: string) => request<{ success: boolean; orderId: string }>('/fulfillment/create', {
        method: 'POST',
        body: JSON.stringify({ externalOrderId: orderId })
    }),
};

// ─── Competitor Radar ──────────────────────────────────────
export interface CompetitorDesign {
    title: string;
    price: string;
    url: string;
}

export const apiRadar = {
    scan: (shopUrl: string) => request<{ success: boolean; designs: CompetitorDesign[] }>('/radar/scan', {
        method: 'POST',
        body: JSON.stringify({ shopUrl })
    }),
};
