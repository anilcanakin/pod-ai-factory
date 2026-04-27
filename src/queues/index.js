const { Queue } = require('bullmq');
const connection = require('../config/redis');

// Tamamlanan / başarısız joblar için otomatik temizlik:
//   removeOnComplete → son 100 job sakla, 24 saatten eski olanları sil
//   removeOnFail     → son 200 job sakla, 48 saatten eski olanları sil
// Bu ayarlar Redis'te biriken stale job key sayısını dramatik şekilde azaltır.
const defaultJobOptions = {
    removeOnComplete: { count: 100, age: 86_400   },   // 24h
    removeOnFail:     { count: 200, age: 172_800  },   // 48h
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
};

const queueOpts = { connection, defaultJobOptions };

const visionQueue    = new Queue('vision-analysis',   queueOpts);
const variationQueue = new Queue('prompt-variation',  queueOpts);
const generationQueue= new Queue('image-generation',  queueOpts);
const assetQueue     = new Queue('asset-processing',  queueOpts);
const mockupQueue    = new Queue('mockup-generation', queueOpts);
const batchQueue      = new Queue('batch-generation',  queueOpts);
const batchSetupQueue = new Queue('batch-setup',       queueOpts);

module.exports = {
    visionQueue,
    variationQueue,
    generationQueue,
    assetQueue,
    mockupQueue,
    batchQueue,
    batchSetupQueue,
    defaultJobOptions,
};
