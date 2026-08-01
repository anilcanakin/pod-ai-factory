'use strict';
const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const http    = require('http');
const sharp   = require('sharp');
const express = require('express');

// ── Mock DB + storage BEFORE requiring the router ──────────────────────────────
// personalization.routes.js requires these via require('../lib/prisma') /
// require('../services/storage.service') — same absolute paths resolve from any
// caller, so pre-seeding require.cache here intercepts them without touching the
// real Postgres instance or writing files under assets/uploads/.
const PRISMA_PATH  = require.resolve('../src/lib/prisma');
const STORAGE_PATH = require.resolve('../src/services/storage.service');

const TEST_WORKSPACE_ID = 'test-ws';
let template;
const ordersDb = new Map();
let orderIdCounter = 0;

const mockPrisma = {
  photoTemplate: {
    findFirst: async ({ where }) => {
      if (where.id === template.id
        && where.workspaceId === TEST_WORKSPACE_ID
        && where.active === true) {
        return template;
      }
      return null;
    },
  },
  personalizationOrder: {
    create: async ({ data }) => {
      const id = `test-order-${++orderIdCounter}`;
      const record = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      ordersDb.set(id, record);
      return record;
    },
    update: async ({ where, data }) => {
      const existing = ordersDb.get(where.id) || {};
      const updated = { ...existing, ...data };
      ordersDb.set(where.id, updated);
      return updated;
    },
  },
};

const mockStorage = {
  uploadToStorage: async (_localPath, storagePath) => `assets/uploads/${storagePath}`,
};

require.cache[PRISMA_PATH]  = { id: PRISMA_PATH,  filename: PRISMA_PATH,  loaded: true, exports: mockPrisma };
require.cache[STORAGE_PATH] = { id: STORAGE_PATH, filename: STORAGE_PATH, loaded: true, exports: mockStorage };

const personalizationRoutes = require('../src/routes/personalization.routes');

let server, baseUrl, baseArtworkPath;

before(async () => {
  const buf = await sharp({
    create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  baseArtworkPath = path.join(os.tmpdir(), `test-personalization-base-${Date.now()}.png`);
  fs.writeFileSync(baseArtworkPath, buf);

  template = {
    id:             'tmpl-fixture-1',
    workspaceId:    TEST_WORKSPACE_ID,
    templateType:   'text_only',
    active:         true,
    baseArtworkUrl: baseArtworkPath,
    printWidthPx:   600,
    printHeightPx:  400,
    mockupConfig:   { inkTintable: false },
    textLayers: [
      { key: 'name', font: 'Montserrat-Bold', size: 60, x: 300, y: 220, color: '#1d1d1b', align: 'center' },
    ],
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.workspaceId = TEST_WORKSPACE_ID; next(); });
  app.use('/api/personalization', personalizationRoutes);

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  if (baseArtworkPath && fs.existsSync(baseArtworkPath)) fs.unlinkSync(baseArtworkPath);
});

describe('POST /api/personalization/text-orders', () => {
  test('valid template + variables → order reaches COMPOSITED', async () => {
    const res = await fetch(`${baseUrl}/api/personalization/text-orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ templateId: template.id, variables: JSON.stringify({ name: 'Emma' }) }),
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.order.status, 'COMPOSITED');
    assert.ok(body.order.printFileUrl, 'printFileUrl should be set');
  });

  test('missing templateId → 400', async () => {
    const res = await fetch(`${baseUrl}/api/personalization/text-orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /templateId required/);
  });

  test('nonexistent templateId → 404', async () => {
    const res = await fetch(`${baseUrl}/api/personalization/text-orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ templateId: 'does-not-exist' }),
    });
    const body = await res.json();
    assert.equal(res.status, 404);
    assert.match(body.error, /PhotoTemplate not found/);
  });
});
