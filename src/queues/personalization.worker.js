'use strict';

/**
 * personalization.worker.js
 *
 * Processes photo personalization composite jobs.
 * Retry strategy: BullMQ-only (3 attempts, exponential backoff).
 * Status machine:
 *   PENDING → COMPOSITING → COMPOSITED  (success)
 *   PENDING → COMPOSITING               (BullMQ retries on transient error)
 *   PENDING → COMPOSITING → FAILED      (all retries exhausted)
 *   PENDING → FAILED                    (config error — no retry)
 */

const { Worker } = require('bullmq');
const redisConnection  = require('../config/redis');
const prisma           = require('../lib/prisma');
const { compositePhoto, validateTemplateConfig } = require('../services/composite-engine.service');

const worker = new Worker('personalization-composite', async (job) => {
  const { orderId, workspaceId } = job.data;

  // 1. Fetch order with template
  const order = await prisma.personalizationOrder.findUnique({
    where:   { id: orderId },
    include: { template: true },
  });
  if (!order) throw new Error(`Order not found: ${orderId}`);

  const template = order.template;

  // 2. Validate template config — fail fast, no retry on config errors
  try {
    validateTemplateConfig(template);
  } catch (configErr) {
    console.error(`[PersonalizationWorker] Config error on order ${orderId}: ${configErr.message}`);
    await prisma.personalizationOrder.update({
      where: { id: orderId },
      data:  { status: 'FAILED', rejectionReason: `Template config error: ${configErr.message}` },
    });
    return;  // do NOT rethrow — prevents BullMQ from retrying a config error
  }

  // 3. Fetch MockupTemplate if configured
  let mockupTemplate = null;
  if (template.mockupConfig?.mockupTemplateId) {
    mockupTemplate = await prisma.mockupTemplate.findUnique({
      where: { id: template.mockupConfig.mockupTemplateId },
    });
  }

  // 4. Mark COMPOSITING
  await prisma.personalizationOrder.update({
    where: { id: orderId },
    data:  { status: 'COMPOSITING' },
  });

  console.log(`[PersonalizationWorker] ▶ orderId:${orderId} | template:${template.name}`);

  // 5. Run composite engine (errors rethrow → BullMQ retries)
  const { printFileUrl, mockupUrl, warnings } = await compositePhoto({
    orderId,
    template,
    mockupTemplate,
    customerPhoto: order.customerPhotoUrl,
    variables:     order.variables,
    workspaceId,
  });

  // 6. Persist results
  await prisma.personalizationOrder.update({
    where: { id: orderId },
    data: {
      status:       'COMPOSITED',
      printFileUrl,
      mockupUrl,
      warnings:     warnings.length ? warnings : null,
    },
  });

  console.log(`[PersonalizationWorker] ✔ orderId:${orderId} → COMPOSITED | warnings:${warnings.join(',') || 'none'}`);
}, {
  connection:    redisConnection,
  concurrency:   1,
  lockDuration:  120_000,
  lockRenewTime: 60_000,
});

// Set FAILED after all BullMQ retries exhausted
worker.on('failed', async (job, err) => {
  if (!job) return;
  const isLastAttempt = job.attemptsMade >= (job.opts?.attempts ?? 3);
  if (isLastAttempt) {
    try {
      await prisma.personalizationOrder.update({
        where: { id: job.data.orderId },
        data:  { status: 'FAILED' },
      });
      console.error(`[PersonalizationWorker] ✗ orderId:${job.data.orderId} → FAILED after ${job.attemptsMade} attempts`);
    } catch (_) {}
  }
});

worker.on('error', (err) => {
  console.error('[PersonalizationWorker] Worker error:', err.message);
});

console.log('[PersonalizationWorker] ✔ Listening → personalization-composite (concurrency:1)');

module.exports = worker;
