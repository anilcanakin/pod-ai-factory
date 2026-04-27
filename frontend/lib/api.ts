// Central API client
// Local dev: .env.local'de NEXT_PUBLIC_API_BASE_URL boş → relative '/api' kullanılır → next.config.ts rewrites backend'e proxy eder (CORS yok).
// Production: NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com → absolute URL, cross-origin, backend CORS_ORIGIN ayarı gerekir.
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
export interface MarketScoring {
    score: number;
    scoreLabel: 'Excellent' | 'Good' | 'Moderate' | 'Challenging' | 'Poor';
    strengths: string[];
    risks: string[];
    recommendation: string;
}

export interface MarketIntel {
    keyword: string;
    resultCount: number | null;
    averagePrice: number | null;
    competitionLevel: string;
    estimatedMonthly: number | null;
    trendTerms: string[];
    pinterestTrends: string[];
    strategy: string;
    isFallback: boolean;
}

export interface IdeaMarketData {
    intel: MarketIntel;
    scoring: MarketScoring;
    validatedAt: string;
    keyword: string;
}

export interface Idea {
    id: string;
    niche: string;
    mainKeyword: string;
    hook: string;
    styleEnum: string;
    status: string;
    trademarkRisk?: boolean;
    marketScore?: number | null;
    marketData?: IdeaMarketData | null;
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
    sendToFactory: (id: string, modelTier?: 'fast' | 'quality' | 'text' | 'vector') =>
        request<{ jobId: string }>(`/ideas/${id}/factory`, {
            method: 'POST',
            body: JSON.stringify({ modelTier }),
        }),
    generateBulk: (niche: string) =>
        request<{ message: string; ideas: Idea[] }>('/ideas/generate-bulk', {
            method: 'POST',
            body: JSON.stringify({ niche }),
        }),
    validate: (id: string) =>
        request<{ idea: Idea; scoring: MarketScoring; intel: MarketIntel }>(`/ideas/${id}/validate`, {
            method: 'POST',
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
export interface MarketData {
    resultCount: number | null;
    averagePrice: number | null;
    competitionLevel: 'Düşük' | 'Orta' | 'Yüksek' | 'Çok Yüksek' | 'Bilinmiyor';
    estimatedMonthly: number | null;
    trendTerms?: string[];
    pinterestTrends?: string[];
}

export interface EtsySEO {
    title: string;
    description: string;
    tags: string[];
    charCount: number;
    topKeywords?: string[];
    etsySuggestions?: string[];
    dataSource?: string;
    marketData?: MarketData | null;
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
    category: string;
    tags: string[];
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
        displayTitle?: string;
        videoPublishedAt?: string;
        videoId?: string;
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
    addText: (title: string, content: string, source: string, category?: string) =>
        request<CorporateMemory & { seoUpdated: boolean }>('/brain/add-text', {
            method: 'POST',
            body: JSON.stringify({ title, content, source, category })
        }),
    delete: (id: string) => request<{ success: boolean }>(`/brain/${id}`, { method: 'DELETE' }),
    strategicAudit: () =>
        request<{ success: boolean; count: number; rulesAnalyzed: number; cards: ActionCard[] }>(
            '/brain/strategic-audit', { method: 'POST' }
        ),
    getActionCards: () =>
        request<ActionCard[]>('/brain/action-cards'),
    produceActionCard: (id: string) =>
        request<{ success: boolean; nicheName: string; ideasCreated: number; ideaIds: string[] }>(
            `/brain/action-cards/${id}/produce`, { method: 'POST' }
        ),
    brainstorm: (options?: { count?: number; focusNiche?: string; season?: string; excludeNiches?: string[] }) =>
        request<BrainstormResult>('/brain/brainstorm', {
            method: 'POST',
            body: JSON.stringify(options || {}),
        }),
    updateIdea: (id: string) =>
        request<{ success: boolean; updatedData: Partial<BrainstormIdea> }>(`/brain/brainstorm/update/${id}`, { method: 'POST' }),
};

export interface BrainstormIdea {
    title:          string;
    niche:          string;
    productType:    string;
    designBrief:    string;
    targetAudience: string;
    keyTags:        string[];
    estimatedScore: number;
    reasoning:      string;
    basedOnRules:   { id: string; title: string }[];
}

export interface BrainstormResult {
    ideas:       BrainstormIdea[];
    rulesUsed:   number;
    totalRules:  number;
    generatedAt: string;
}

export interface ActionCard {
    id:              string;
    title:           string;
    content:         string;
    category:        string;
    createdAt:       string;
    analysisResult?: {
        status:           'READY_TO_PRODUCE' | 'IN_PRODUCTION' | 'DONE';
        nicheName:        string;
        nicheScore:       number;
        reason:           string;
        matchedRuleCount: number;
        slogans:          string[];
        visualPrompts:    string[];
        rulesAnalyzed:    number;
        generatedAt:      string;
        sentAt?:          string;
        ideaIds?:         string[];
    };
}

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

    // ── Agentic Pipeline (agent.service.js) ──────────────────────────────────
    runPipeline: (forceRepackage = false) =>
        request<{ success: boolean; packagesCreated: number; message: string }>('/agent/pipeline', {
            method: 'POST',
            body:   JSON.stringify({ forceRepackage }),
        }),
    triggerFullScan: () =>
        request<{ success: boolean; message: string }>('/agent/full-scan', { method: 'POST' }),
    getPackages: (limit = 10) =>
        request<{ success: boolean; packages: AgentPackage[]; count: number }>(`/agent/packages?limit=${limit}`),
    preparePackage: (cardId: string) =>
        request<PrepareResult & { success: boolean }>(`/agent/packages/${cardId}/prepare`, { method: 'POST' }),
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

// ─── WPI — Winning Product Intelligence ───────────────────

export interface WpiProduct {
    listingId: string;
    title: string;
    price: number;
    currency: string;
    imageUrl: string;
    listingUrl: string;
    sales: number;
    rating: number | null;
    shopName: string;
}

export interface WpiTrendData {
    salesCount: number;
    salesDelta: number;
    trendPeriod: '48h' | 'BASELINE' | 'HOT_NOW' | 'INSTANT' | 'all-time';
    isTrending: boolean;
    isBaseline: boolean;
    isHotNow?: boolean;
    trendScore: number;
}

export interface WpiBrainComparison {
    confidence: number;
    reasoning: string;
    designSuggestion: string;
    designPrompt?: string;
    competitiveEdge: string;
    niche: string;
    targetKeywords: string[];
    colorPalette: string;
    differentiationAngle?: string;
}

export interface WpiActionCard {
    headline: string;
    actionType: 'IMMEDIATE_ACTION' | 'TREND_ACTION';
    competitorAnalysis: string;
    designSuggestion: string;
    designPrompt?: string;
    action: string;
    collection: string | null;
    event: string | null;
    colorPalette: string | null;
    targetKeywords: string[];
    competitiveEdge: string | null;
    differentiationAngle: string | null;
    confidence: number;
    priority: 'IMMEDIATE' | 'HIGH' | 'NORMAL';
    instantSignals: string[];
    autoSendToFactory: boolean;
    hotNow?: boolean;
}

export type WpiProductCategory = 'POD_APPAREL' | 'HOME_DECOR' | 'DIGITAL_DOWNLOAD' | 'ACCESSORIES' | 'NON_POD';

export interface WpiCard {
    id: string;
    title: string;
    createdAt: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    keyword: string;
    product: WpiProduct & {
        isBestSeller?: boolean;
        inCartCount?: number;
        isPopularNow?: boolean;
        category?: WpiProductCategory;
    };
    trendData: WpiTrendData;
    brainComparison: WpiBrainComparison;
    actionCard: WpiActionCard;
}

export interface WpiScanSummary {
    scanId: string;
    scannedAt: string;
    keywordsScanned: number;
    totalProducts: number;
    totalTrending: number;
    totalWinners: number;
    totalImmediate: number;
    errors: number;
}

export interface WpiKeywordResult {
    keyword: string;
    productsScraped: number;
    trendingCount: number;
    winnersFound: number;
    isBaseline: boolean;
    actionCards: WpiCard[];
    error: string | null;
}

export interface WpiScanResult {
    success: boolean;
    scanId: string;
    summary: WpiScanSummary;
    byKeyword: Record<string, WpiKeywordResult>;
    actionCards: WpiCard[];
}

export interface WpiCollection {
    name: string;
    event: string;
    keywords: string[];
}

export type WpiKeywordStatus = 'queued' | 'running' | 'done' | 'timeout' | 'error';

export interface WpiScanProgress {
    total: number;
    done: number;
    currentKeyword: string;
    phase?: 'scraping' | 'filtering' | 'ai_analysis' | 'saving' | 'done';
    aiDone?: number;
    aiTotal?: number;
    keywordStatuses?: Record<string, WpiKeywordStatus>;
}

export interface WpiScanStartResponse {
    success: boolean;
    scanId: string;
    status: 'running';
    total: number;
}

export interface WpiScanPollResponse {
    success: boolean;
    status: 'running' | 'done' | 'error';
    progress?: WpiScanProgress;
    result?: WpiScanResult;
    error?: string;
}

export const apiWpi = {
    startScan: (keywords: string[], opts?: { saveWinners?: boolean; maxPerKeyword?: number }) =>
        request<WpiScanStartResponse>('/wpi/scan', {
            method: 'POST',
            body: JSON.stringify({ keywords, ...opts }),
        }),

    pollScan: (scanId: string) =>
        request<WpiScanPollResponse>(`/wpi/scan/${scanId}`),

    listActionCards: (status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL' = 'PENDING', limit = 20) =>
        request<{ success: boolean; count: number; cards: WpiCard[] }>(
            `/wpi/action-cards?status=${status}&limit=${limit}`
        ),

    approve: (id: string, sendToFactory = false) =>
        request<{ success: boolean; cardId: string; jobId: string | null }>(
            `/wpi/action-cards/${id}/approve`,
            { method: 'POST', body: JSON.stringify({ sendToFactory }) }
        ),

    reject: (id: string, reason = '') =>
        request<{ success: boolean; cardId: string }>(
            `/wpi/action-cards/${id}/reject`,
            { method: 'POST', body: JSON.stringify({ reason }) }
        ),

    collections: () =>
        request<{ success: boolean; collections: WpiCollection[] }>('/wpi/collections'),

    config: () =>
        request<{ success: boolean; config: { brainConfidenceMin: number; collectionsCount: number; actor: string } }>(
            '/wpi/config'
        ),

    factoryQueue: () =>
        request<{
            success: boolean;
            count: number;
            jobs: Array<{
                id: string;
                createdAt: string;
                keyword: string;
                niche: string;
                designPrompt: string;
                colorPalette: string;
                previewUrl: string | null;
            }>;
        }>('/wpi/factory-queue'),

    optimizeSeo: (cardId: string) =>
        request<{ success: boolean; seoPackage: WpiSeoPackage }>(
            `/wpi/action-cards/${cardId}/seo-optimize`,
            { method: 'POST' }
        ),

    radarDiscoveries: (hours = 24) =>
        request<{
            success: boolean;
            count: number;
            discoveries: RadarDiscovery[];
            lastRunAt: string | null;
            nextRunAt: string | null;
        }>(`/wpi/radar-discoveries?hours=${hours}`),

    radarTrigger: () =>
        request<{ success: boolean; message: string }>(
            '/wpi/radar-trigger', { method: 'POST' }
        ),
};

export interface RadarDiscovery {
    id: string;
    niche: string;
    discoveryScore: number;
    reasoning: string;
    suggestedKeywords: string[];
    productRecommendation: string;
    urgency: 'high' | 'medium' | 'low';
    source: 'etsy' | 'google_trends' | 'pinterest';
    discoveredAt: string;
    isCritical: boolean;
}

export interface WpiSeoPackage {
    title: string;
    tags: string[];
    description: string;
    keywordDensityMap: Array<{ kw: string; count: number }>;
}

export interface ScoutNiche {
    niche: string;
    keyword: string;
    reasoning: string;
    confidence: number;
    source?: string;
    createdAt?: string;
    id?: string;
}

export const apiScout = {
    suggest: (workspaceId?: string) =>
        request<{ success: boolean; suggestions: ScoutNiche[]; trendsUsed: number }>(
            '/scout/suggest', { method: 'POST', body: JSON.stringify({ workspaceId }) }
        ),

    list: () =>
        request<{ success: boolean; suggestions: ScoutNiche[] }>('/scout/suggestions'),
};

// ─── Knowledge (Academy Brain) ────────────────────────────────
export interface KnowledgeEntry {
    id: string;
    title: string;
    content: string;
    category: string;
    type: string;
    createdAt: string;
}

export interface ChannelVideo {
    videoId:     string;
    title:       string;
    url:         string;
    viewCount:   number | null;
    uploadDate:  string | null;
    duration:    number | null;
    thumbnail:   string;
    channelName: string | null;
}

export const apiKnowledge = {
    extractChannel: (url: string, maxResults?: number) =>
        request<{ success: boolean; videos: ChannelVideo[]; channelName: string | null; totalCount: number }>(
            '/knowledge/channel-extract',
            { method: 'POST', body: JSON.stringify({ url, maxResults: maxResults ?? 50 }) }
        ),

    queueCleanup: (opts?: { jobIds?: string[]; cleanFailed?: boolean; cleanCompleted?: boolean }) =>
        request<{ success: boolean; removed: string[]; errors: {id: string; error: string}[]; failedCleaned: number; completedCleaned: number }>(
            '/knowledge/queue-cleanup',
            { method: 'POST', body: JSON.stringify(opts ?? { cleanFailed: true }) }
        ),

    ingestText: (title: string, content: string, category: string) =>
        request<{ success: boolean; saved: number; chunks: string[] }>('/knowledge/ingest-text', {
            method: 'POST',
            body: JSON.stringify({ title, content, category }),
        }),
    search: (query: string, topK?: number, category?: string) =>
        request<{ success: boolean; count: number; results: Array<KnowledgeEntry & { score: number }> }>('/knowledge/search', {
            method: 'POST',
            body: JSON.stringify({ query, topK, category }),
        }),
    entries: (category?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        return request<{ success: boolean; count: number; entries: KnowledgeEntry[] }>(
            `/knowledge/entries${qs ? `?${qs}` : ''}`
        );
    },
    delete: (id: string) =>
        request<{ success: boolean }>(`/knowledge/entries/${id}`, { method: 'DELETE' }),

    submitYoutubeBulk: (urls: Array<string | { url: string; title?: string; category?: string }>) =>
        request<{ success: boolean; jobs: IngestJob[] }>('/knowledge/youtube-bulk', {
            method: 'POST',
            body: JSON.stringify({ urls }),
        }),

    getIngestJobs: () =>
        request<{ success: boolean; jobs: IngestJob[] }>('/knowledge/ingest-jobs'),

    getJobStatus: (jobId: string) =>
        request<{ jobId: string; state: string; progress: number; name: string; failedReason: string | null }>(
            `/knowledge/status/${jobId}`
        ),

    retryFailed: (opts?: { jobIds?: string[]; fromId?: number; toId?: number }) =>
        request<{ success: boolean; retried: number; jobs: Array<{ oldJobId: string; newJobId: string; url: string }> }>(
            '/knowledge/retry-failed',
            { method: 'POST', body: JSON.stringify(opts || {}) }
        ),

    getQueueStats: () => request<QueueStats>('/knowledge/queue-stats'),

    ingest: (body: { source: 'youtube' | 'social' | 'radar'; urls: Array<string | { url: string; title?: string }>; platform?: string; originalName?: string }) =>
        request<{ success: boolean; jobs: IngestJob[] }>('/knowledge/ingest', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    uploadFile: (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '') + '/api';
        return fetch(`${base}/knowledge/upload`, { method: 'POST', credentials: 'include', body: formData })
            .then(async r => {
                if (!r.ok) { const t = await r.text(); throw new Error(t); }
                return r.json() as Promise<{ message: string; jobId: string; file: string }>;
            });
    },
};

export interface IngestJob {
    jobId: string;
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | string;
    progress: number;
    url: string;
    title: string;
    category: string;
    failedReason: string | null;
    timestamp?: number;
    sourceType?: string;
    platform?: string | null;
}

export interface QueueStats {
    total:     number;
    indexed:   number;
    inQueue:   number;
    failed:    number;
    completed: number;
    active:    number;
    waiting:   number;
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
    ts:    number;
    level: 'info' | 'warn' | 'error';
    msg:   string;
}

export const apiLogs = {
    getRecent: (n = 20) =>
        request<{ logs: LogEntry[] }>(`/logs/recent?n=${n}`),
};

// ─── Batch Factory ────────────────────────────────────────────────────────────

export interface BatchRule {
    id:              string;
    title:           string;
    content:         string;
    category:        string;
    createdAt:       string;
    analysisResult?: Record<string, unknown>;
}

export interface BatchImage {
    id:       string;
    status:   string;
    imageUrl: string | null;
    slogan:   string;
    seed:     string | null;
}

export interface StylePresetColor {
    name: string;
    hex:  string;
}

export interface StylePreset {
    id:                string;
    label:             string;
    emoji:             string;
    promptFragment:    string;
    colorPalette:      StylePresetColor[];
    preferredModelKey: FinalRenderModelKey;
    styleGuide:        string;
}

export interface LockedDNA {
    sourceTitle:    string;
    modelKey:       FinalRenderModelKey;
    stylePresetId?: string;
    seed?:          number;
    designBrief:    string;
    referenceImageUrl?: string;
    profileId?:     string;
}

export interface BatchStatus {
    batchJobId: string;
    status:     string;
    niche:      string;
    total:      number;
    completed:  number;
    failed:     number;
    pending:    number;
    progress:   number;
    totalCost:  number;
    images:     BatchImage[];
}

export type FinalRenderModelKey = 'PREMIUM_GOOGLE' | 'PREMIUM_OPENAI' | 'PREMIUM_SD';

export const FINAL_RENDER_MODELS: Record<FinalRenderModelKey, { label: string; desc: string; cost: number; color: string }> = {
    PREMIUM_GOOGLE: { label: 'Nano Banana 2',       desc: 'Sanatsal & stabil',           cost: 0.060, color: 'text-yellow-400'  },
    PREMIUM_OPENAI: { label: 'GPT Image 2',          desc: 'Semantik & detaylı',          cost: 0.080, color: 'text-emerald-400' },
    PREMIUM_SD:     { label: 'Stable Diffusion v3',  desc: 'Vektörel & grafik kontrolü',  cost: 0.040, color: 'text-blue-400'    },
};

export const apiBatch = {
    getRules: () =>
        request<{ success: boolean; rules: BatchRule[] }>('/batch/rules'),

    startFromRule: (body: {
        ruleId?: string; ruleTitle?: string; ruleContent?: string;
        count?: number; engine?: string; style?: string;
    }) =>
        request<{ success: boolean; batchJobId: string; queueJobId: string; imageCount: number; projectedCost: number }>(
            '/batch/from-rule', { method: 'POST', body: JSON.stringify(body) }
        ),

    generate: (body: { niche: string; count?: number; engine?: string; style?: string }) =>
        request<{ success: boolean; batchJobId: string; queueJobId: string; imageCount: number; projectedCost: number; niche: string; engine: string }>(
            '/batch/generate', { method: 'POST', body: JSON.stringify(body) }
        ),

    draft: (body: {
        niche?: string; designBrief: string; productType?: string; ideaTitle?: string;
        seed?: number; referenceImageUrl?: string; stylePresetId?: string; styleProfileId?: string;
    }) =>
        request<{ success: boolean; batchJobId: string; queueJobId: string; imageCount: number; niche: string }>(
            '/batch/draft', { method: 'POST', body: JSON.stringify(body) }
        ),

    finalRender: (body: {
        draftImageId?: string; modelKey: FinalRenderModelKey; designBrief: string;
        niche?: string; variantLabel?: string; seed?: number; stylePresetId?: string; styleProfileId?: string;
    }) =>
        request<{ success: boolean; batchJobId: string; queueJobId: string; imageCount: number; projectedCost: number; modelKey: string; modelLabel: string }>(
            '/batch/final-render', { method: 'POST', body: JSON.stringify(body) }
        ),

    getStatus: (batchJobId: string) =>
        request<{ success: boolean } & BatchStatus>(`/batch/status/${batchJobId}`),

    getStyles: () =>
        request<{ success: boolean; presets: StylePreset[] }>('/batch/styles'),
};

// ─── Style Profiles ───────────────────────────────────────────────────────────

export interface StyleProfile {
    id:               string;
    workspaceId:      string;
    name:             string;
    emoji:            string;
    baseModel:        string;
    promptPrefix:     string | null;
    promptSuffix:     string | null;
    negativePrompt:   string | null;
    referenceImageUrl: string | null;
    colorPalette:     StylePresetColor[] | null;
    sourcePresetId:   string | null;
    sourceSeed:       string | null;
    isDefault:        boolean;
    createdAt:        string;
}

export const apiStyles = {
    list: () =>
        request<{ success: boolean; profiles: StyleProfile[] }>('/styles'),

    create: (body: {
        name: string; emoji?: string; baseModel?: string;
        promptPrefix?: string; promptSuffix?: string; negativePrompt?: string;
        referenceImageUrl?: string; colorPalette?: StylePresetColor[];
    }) =>
        request<{ success: boolean; profile: StyleProfile }>(
            '/styles', { method: 'POST', body: JSON.stringify(body) }
        ),

    update: (id: string, body: Partial<{
        name: string; emoji: string; baseModel: string;
        promptPrefix: string; promptSuffix: string; negativePrompt: string;
        referenceImageUrl: string; colorPalette: StylePresetColor[];
    }>) =>
        request<{ success: boolean; profile: StyleProfile }>(
            `/styles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }
        ),

    delete: (id: string) =>
        request<{ success: boolean }>(`/styles/${id}`, { method: 'DELETE' }),

    setDefault: (id: string) =>
        request<{ success: boolean; profile: StyleProfile }>(
            `/styles/${id}/set-default`, { method: 'POST' }
        ),

    fromLockedDNA: (body: LockedDNA) =>
        request<{ success: boolean; profile: StyleProfile }>(
            '/styles/from-locked-dna', { method: 'POST', body: JSON.stringify(body) }
        ),
};

// ─── Finance ──────────────────────────────────────────────────────────────────

export interface FinancialSummary {
    totalIncome:   number;
    totalExpenses: number;
    netProfit:     number;
    burnRate24h:   number;
    byProvider:    Array<{ provider: string; total: number }>;
    aiHistory:     Array<{ day: string; expense: number; income: number }>;
    roi: {
        avgCostPerImage: number;
        listingPrice:    number;
        roiMultiple:     number | null;
        approvedCount:   number;
    };
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface AgentPackage {
    id:               string;
    title:            string;
    keyword:          string;
    confidence:       number;
    priority:         'IMMEDIATE' | 'HIGH' | 'NORMAL';
    hotNow:           boolean;
    designSuggestion: string;
    competitiveEdge:  string;
    colorPalette:     string;
    targetKeywords:   string[];
    designPrompt:     string;
    collection:       string | null;
    event:            string | null;
    seoPackage: {
        title:       string;
        description: string;
        tags:        string[];
    };
    product: {
        title:      string;
        price:      number;
        sales:      number;
        imageUrl:   string | null;
        listingUrl: string | null;
        shopName:   string;
    };
    packagedAt: string | null;
    createdAt:  string;
}

export interface PrepareResult {
    imageUrl:     string;
    designPrompt: string;
    keyword:      string;
    seo: {
        title:       string;
        description: string;
        tags:        string[];
    };
    card: {
        id:             string;
        title:          string;
        confidence:     number;
        colorPalette:   string;
        targetKeywords: string[];
    };
}

export interface NicheROIItem {
    niche:            string;
    jobCount:         number;
    imageCount:       number;
    totalCost:        number;
    approvedCount:    number;
    estimatedRevenue: number;
    roi:              number | null;
}

export const apiFinance = {
    getSummary: () =>
        request<FinancialSummary>('/finance/summary'),

    recordIncome: (amount: number, description: string, imageId?: string) =>
        request<{ success: boolean }>('/finance/income', {
            method: 'POST',
            body: JSON.stringify({ amount, description, imageId }),
        }),

    getNicheROI: () =>
        request<{ niches: NicheROIItem[]; listingPrice: number }>('/finance/niche-roi'),
};


// ─── Pinterest / Apify Visual Intelligence ──────────────────────────────────

export interface PinterestTrend {
    title:         string;
    imageUrl:      string;
    pinUrl:        string;
    description:   string;
    repins:        number;
    visionInsight: string | null;
    designPrompt:  string | null;
}

export const apiApify = {
    pinterestTrends: (keyword: string, maxResults?: number, save?: boolean) =>
        request<{ success: boolean; count: number; savedToKnowledge?: number; trends: PinterestTrend[] }>(
            '/apify/pinterest-trends',
            {
                method: 'POST',
                body: JSON.stringify({ keyword, maxResults: maxResults ?? 12, save: save ?? false }),
            }
        ),
};
