require('dotenv').config();

// ── In-memory log ring buffer (console'u override et, son 100 log'u tut) ─────
const LOG_BUFFER = [];
const LOG_MAX    = 100;
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
const _push = (level, args) => {
    const msg = args.map(a =>
        (a instanceof Error) ? a.stack || a.message :
        (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a)
    ).join(' ');
    LOG_BUFFER.push({ ts: Date.now(), level, msg });
    if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.shift();
};
console.log   = (...a) => { _origLog(...a);   _push('info',  a); };
console.warn  = (...a) => { _origWarn(...a);  _push('warn',  a); };
console.error = (...a) => { _origError(...a); _push('error', a); };

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const { PrismaClient } = require('@prisma/client');
const workspaceMiddleware = require('./config/workspace.middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Serve mockup assets publicly with CORS - MUST be before auth middleware
const path = require('path');
app.use('/assets/mockups', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static(path.join(__dirname, '../assets/mockups')));

// Serve rendered mockup outputs publicly with CORS
const outputsDir = path.join(__dirname, '../assets/outputs');
if (!require('fs').existsSync(outputsDir)) {
    require('fs').mkdirSync(outputsDir, { recursive: true });
}
app.use('/assets/outputs', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static(path.join(__dirname, '../assets/outputs')));

// Create Supabase Storage bucket on startup
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    supabase.storage.createBucket('mockup-outputs', { public: true, fileSizeLimit: 52428800 })
        .then(({ error }) => {
            if (!error || error.message?.includes('already exists')) {
                console.log('[Storage] Bucket ready: mockup-outputs');
            } else {
                console.warn('[Storage] Bucket create warning:', error.message);
            }
        }).catch(() => {});
}

// Middleware
// Backend :3000, Frontend :3001 portunda çalışır.
// CORS_ORIGIN set edilmemişse frontend'in varsayılan portuna (3001) izin ver.
// PRODUCTION: CORS_ORIGIN env değişkenine gerçek frontend URL'ini set et.
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3001';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
console.log(`[CORS] İzin verilen origin: ${ALLOWED_ORIGIN}`);
app.use(cookieParser());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(workspaceMiddleware);

// Initialize background queue workers
require('./queues/asset.worker');

// SEO Knowledge Base weekly auto-updater
require('./jobs/seo-knowledge-updater').startCron();

// Autonomous Radar: Etsy/Google Trends/Pinterest — every 12h
require('./jobs/radar-worker').startCron();

// Storage asset explicit workspace scoped protection
app.use('/assets/outputs/:filename', async (req, res, next) => {
  if (!req.workspaceId) return res.status(401).send('Unauthorized');
  try {
    const jobId = req.params.filename.split('_')[0];
    const job = await prisma.designJob.findFirst({ where: { id: jobId, workspaceId: req.workspaceId } });
    if (!job) return res.status(403).send('Forbidden');
    next();
  } catch { next(); }
});

// Serve static generated assets
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'POD AI Factory is running' });
});

// ─── Recent backend logs (ring buffer) ────────────────────────────────────────
app.get('/api/logs/recent', (req, res) => {
    const n = Math.min(parseInt(req.query.n || '20', 10), 100);
    res.set('Cache-Control', 'no-store');
    res.json({ logs: LOG_BUFFER.slice(-n) });
});

// ─── Fal health check cache (60s TTL) ─────────────────────────
let falStatusCache = { result: null, ts: 0 };

async function checkFalHealth() {
  const now = Date.now();
  if (falStatusCache.result && (now - falStatusCache.ts) < 60000) {
    return falStatusCache.result;
  }

  const falKey = process.env.FAL_API_KEY || process.env.FAL_KEY || '';
  if (!falKey || falKey === 'xxxxx' || falKey === 'your_fal_key' || falKey.length < 10) {
    const r = { status: 'offline', message: 'FAL_API_KEY not configured' };
    falStatusCache = { result: r, ts: now };
    return r;
  }

  try {
    // Lightweight auth probe: GET a non-existent request from the queue endpoint.
    // → 404 means key is valid (request not found but auth passed) → online
    // → 401/403 means key is invalid → auth_error
    // → network error → offline
    // Bu yöntem hiç görüntü üretmez, para harcamaz, ~200ms sürer.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      'https://queue.fal.run/fal-ai/flux/dev/requests/health-probe-' + Date.now(),
      {
        method: 'GET',
        headers: { 'Authorization': `Key ${falKey}` },
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (resp.status === 401 || resp.status === 403) {
      // Açık auth hatası — key geçersiz
      const body = await resp.json().catch(() => ({}));
      const r = { status: 'auth_error', message: body.message || body.error || `HTTP ${resp.status}` };
      falStatusCache = { result: r, ts: now };
      return r;
    } else if (resp.status < 500) {
      // 200, 404, 405, 422 vb. — FAL sunucusu yanıt verdi, key geçti → online
      const r = { status: 'online', message: null };
      falStatusCache = { result: r, ts: now };
      return r;
    } else {
      // 5xx — FAL sunucu hatası
      const body = await resp.json().catch(() => ({}));
      const r = { status: 'offline', message: body.message || body.error || `HTTP ${resp.status}` };
      falStatusCache = { result: r, ts: now };
      return r;
    }
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const r = {
      status: 'offline',
      message: isTimeout ? 'FAL bağlantısı zaman aşımına uğradı (8s)' : err.message
    };
    falStatusCache = { result: r, ts: now };
    return r;
  }
}

// GET /api/status — real Fal health check + daily spend + estimated monthly spend
app.get('/api/status', async (req, res) => {
  try {
    const workspaceId = req.workspaceId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // workspaceId null ise spend sorgularını atla
    const spendWhere = workspaceId
      ? { job: { workspaceId }, createdAt: { gte: startOfDay } }
      : { createdAt: { gte: startOfDay } };
    const monthSpendWhere = workspaceId
      ? { job: { workspaceId }, createdAt: { gte: startOfMonth } }
      : { createdAt: { gte: startOfMonth } };

    const [falHealth, spendResult, monthSpendResult] = await Promise.all([
      checkFalHealth(),
      prisma.image.aggregate({ where: spendWhere, _sum: { cost: true } })
        .catch(() => ({ _sum: { cost: 0 } })),
      prisma.image.aggregate({ where: monthSpendWhere, _sum: { cost: true } })
        .catch(() => ({ _sum: { cost: 0 } }))
    ]);

    const dailySpend = parseFloat(spendResult._sum.cost || 0);
    const monthSpend = parseFloat(monthSpendResult._sum.cost || 0);
    const currentDay = Math.max(1, new Date().getDate());
    const estimatedMonthlyCost = (monthSpend / currentDay) * 30;

    res.json({
      fal: falHealth.status,
      falMessage: falHealth.message,
      dailySpend,
      estimatedMonthlyCost,
      dailyCap: parseFloat(process.env.DAILY_BUDGET_CAP || '5.00'),
      useVision: process.env.USE_VISION === 'true',
      hasOpenAIKey: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 5 && process.env.OPENAI_API_KEY !== 'your_openai_api_key',
      currentJob: null,
      workspaceId: workspaceId || null
    });
  } catch (err) {
    console.error('[/api/status] Hata:', err.message);
    // 500 yerine degraded response dön — frontend çökmez
    res.json({
      fal: 'offline',
      falMessage: `Status endpoint hatası: ${err.message}`,
      dailySpend: 0,
      estimatedMonthlyCost: 0,
      dailyCap: parseFloat(process.env.DAILY_BUDGET_CAP || '5.00'),
      useVision: false,
      hasOpenAIKey: false,
      currentJob: null,
      workspaceId: null
    });
  }
});

// GET /api/dashboard — overview stats for frontend
app.get('/api/dashboard', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const startOf24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Weekly range: last 7 days
    const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      runsToday,
      imagesGeneratedToday,
      approvedToday,
      spendToday,
      recentJobs,
      topApproved,
      avgTimeLogs,
      weeklyImages
    ] = await Promise.all([
      // Runs (jobs) created today
      prisma.designJob.count({ where: { createdAt: { gte: startOfDay } } }),

      // Images generated in last 24h
      prisma.image.count({
        where: { createdAt: { gte: startOf24h }, status: { in: ['COMPLETED', 'APPROVED'] } }
      }),

      // Images approved today
      prisma.image.count({
        where: { createdAt: { gte: startOfDay }, isApproved: true }
      }),

      // Spend today
      prisma.image.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _sum: { cost: true }
      }).catch(() => ({ _sum: { cost: 0 } })),

      // Recent jobs (Projects)
      prisma.designJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          _count: { select: { images: true } },
          images: {
            select: { cost: true, imageUrl: true },
            orderBy: { createdAt: 'desc' }
          }
        }
      }),

      // Top 3 approved images by performanceScore
      prisma.image.findMany({
        where: { isApproved: true, imageUrl: { not: 'PENDING' } },
        orderBy: { performanceScore: 'desc' },
        take: 3,
        select: { id: true, imageUrl: true, performanceScore: true, jobId: true }
      }),

      // Average generation time — COMPLETED jobs in last 24h (updatedAt - createdAt)
      prisma.designJob.findMany({
        where: { status: 'COMPLETED', updatedAt: { gte: startOf24h } },
        select: { createdAt: true, updatedAt: true }
      }),

      // Weekly images per day (last 7 days)
      prisma.image.findMany({
        where: { createdAt: { gte: startOfWeek } },
        select: { createdAt: true, isApproved: true, cost: true },
      })
    ]);

    // Calculate success rate from jobs
    const totalJobs = await prisma.designJob.count();
    const completedJobs = await prisma.designJob.count({ where: { status: 'COMPLETED' } });
    const successRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

    // Aggregate weekly images by day
    const dayMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: key, images: 0, approved: 0, spend: 0 };
    }
    for (const img of weeklyImages) {
      const key = img.createdAt.toISOString().slice(0, 10);
      if (dayMap[key]) {
        dayMap[key].images++;
        if (img.isApproved) dayMap[key].approved++;
        dayMap[key].spend = parseFloat((dayMap[key].spend + parseFloat(img.cost || 0)).toFixed(4));
      }
    }
    const weeklyStats = Object.values(dayMap);

    res.json({
      runsToday,
      imagesGeneratedToday,
      approvedToday,
      spendToday: parseFloat(spendToday._sum.cost || 0),
      successRate,
      recentJobs: recentJobs.map(j => {
        const spend = j.images.reduce((sum, img) => sum + parseFloat(img.cost || 0), 0);
        const previewUrl = j.images.find(img =>
            img.imageUrl &&
            img.imageUrl !== 'PENDING'
        )?.imageUrl || null;
        return {
          id: j.id,
          originalImage: j.originalImage,
          status: j.status,
          imageCount: j._count.images,
          spend,
          createdAt: j.createdAt,
          previewUrl
        };
      }),
      topApproved,
      weeklyStats,
      avgGenerationTime: avgTimeLogs.length > 0
        ? Math.round(
            avgTimeLogs.reduce((sum, j) => sum + (new Date(j.updatedAt) - new Date(j.createdAt)), 0)
            / avgTimeLogs.length / 1000
          )
        : null, // seconds; null when no completed jobs in last 24h
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/vision', require('./routes/vision.routes'));
app.use('/api/prompt', require('./routes/prompt.routes'));
app.use('/api/generate', require('./routes/generation.routes'));
app.use('/api/gallery', require('./routes/gallery.routes'));
app.use('/api/tools', require('./routes/tool.routes'));
app.use('/api/seo', require('./routes/seo.routes'));
app.use('/api/seo-knowledge', require('./routes/seo-knowledge.routes'));
app.use('/api/export', require('./routes/export.routes'));
app.use('/api/pipeline', require('./routes/pipeline.routes'));
const jobsRoutes = require('./routes/jobs.routes');
app.use('/api/jobs', jobsRoutes);
app.use('/api/factory', require('./routes/factory.routes'));
app.use('/api/ideas', require('./routes/idea.routes'));
app.use('/api/analytics', require('./routes/analytics.routes'));
app.use('/api/packs', require('./routes/product-pack.routes'));
app.use('/api/billing', require('./routes/billing.routes'));
app.use('/api/mockups/templates', require('./routes/mockup-template.routes'));
app.use('/api/mockups', require('./routes/mockup.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/etsy-browser', require('./routes/etsy-browser.routes'));
app.use('/api/brain', require('./routes/brain.routes'));
app.use('/api/trends', require('./routes/trends.routes'));
app.use('/api/agent', require('./routes/agent.routes'));
app.use('/api/radar', require('./routes/radar.routes'));
app.use('/api/apify', require('./routes/apify.routes'));
app.use('/api/wpi',   require('./routes/wpi.routes'));
app.use('/api/scout', require('./routes/scout.routes'));
app.use('/api/fulfillment', require('./routes/fulfillment.routes'));
app.use('/api/knowledge', require('./routes/knowledge.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
app.use('/api/hq', require('./routes/hq.routes'));
app.use('/api/finance', require('./routes/finance.routes'));
app.use('/api/batch',  require('./routes/batch.routes'));
app.use('/api/styles', require('./routes/style.routes'));


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  // Auto-initialize daily tasks for the AI Agent
  try {
    const taskService = require('./services/task.service');
    await taskService.initializeDailyTasks();
  } catch (err) {
    console.error('[TaskService] Initialization error:', err.message);
  }

  // BullMQ Worker'larını backend ile birlikte başlat.
  try {
    require('./queues/asset.worker');
    require('./queues/mockup.worker');
    require('./queues/knowledge.worker');
    require('./queues/batch.worker');
    console.log('[Workers] Asset, Mockup, Knowledge ve Batch başlatıldı.');
  } catch (err) {
    console.error('[Workers] Worker başlatma hatama:', err.message);
  }
});

// Büyük dosyalar ve uzun işlemler (Video processing vb) için timeout'u artır (10 dk)
server.timeout = 600000;
server.keepAliveTimeout = 610000;
server.headersTimeout = 620000;


