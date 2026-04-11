require('dotenv').config();
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
app.use(cors({ origin: 'http://localhost:3001', credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(workspaceMiddleware);

// Initialize background queue workers
require('./queues/asset.worker');

// SEO Knowledge Base weekly auto-updater
require('./jobs/seo-knowledge-updater').startCron();

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

// ─── Fal health check cache (30s TTL) ─────────────────────────
let falStatusCache = { result: null, ts: 0 };

async function checkFalHealth() {
  const now = Date.now();
  if (falStatusCache.result && (now - falStatusCache.ts) < 30000) {
    return falStatusCache.result;
  }

  const falKey = process.env.FAL_API_KEY || process.env.FAL_KEY || '';
  if (!falKey || falKey === 'xxxxx' || falKey === 'your_fal_key' || falKey.length < 10) {
    const r = { status: 'offline', message: 'FAL_API_KEY not configured' };
    falStatusCache = { result: r, ts: now };
    return r;
  }

  try {
    // Lightweight probe: send a minimal prompt with num_images=1 but tiny payload
    // This validates auth + connectivity without generating a real image cost
    // We use a 5s timeout to avoid blocking the response
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch('https://fal.run/fal-ai/flux/dev', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: 'test', image_size: 'square_hd', num_images: 1 }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (resp.status === 200) {
      const r = { status: 'online', message: null };
      falStatusCache = { result: r, ts: now };
      return r;
    } else if (resp.status === 401 || resp.status === 403) {
      const body = await resp.json().catch(() => ({}));
      const r = { status: 'auth_error', message: body.message || body.error || `HTTP ${resp.status}` };
      falStatusCache = { result: r, ts: now };
      return r;
    } else if (resp.status === 422) {
      // 422 means auth passed but payload issue — key works
      const r = { status: 'online', message: null };
      falStatusCache = { result: r, ts: now };
      return r;
    } else {
      const body = await resp.json().catch(() => ({}));
      const r = { status: 'payload_error', message: body.message || body.error || `HTTP ${resp.status}` };
      falStatusCache = { result: r, ts: now };
      return r;
    }
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    const r = { status: 'offline', message: isTimeout ? 'Connection timeout (5s)' : err.message };
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

    const [falHealth, spendResult, monthSpendResult] = await Promise.all([
      checkFalHealth(),
      prisma.image.aggregate({
        where: { job: { workspaceId }, createdAt: { gte: startOfDay } },
        _sum: { cost: true }
      }).catch(() => ({ _sum: { cost: 0 } })),
      prisma.image.aggregate({
        where: { job: { workspaceId }, createdAt: { gte: startOfMonth } },
        _sum: { cost: true }
      }).catch(() => ({ _sum: { cost: 0 } }))
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
      currentJob: null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

      // Average generation time (from logs)
      prisma.jobLog.findMany({
        where: { eventType: 'GENERATION_DONE', createdAt: { gte: startOf24h } },
        select: { data: true }
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
      avgGenerationTime: null // placeholder — needs timestamp tracking to compute
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
app.use('/api/fulfillment', require('./routes/fulfillment.routes'));


app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

