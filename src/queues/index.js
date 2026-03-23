const { Queue } = require('bullmq');
const connection = require('../config/redis');

// Queue Definitions
const visionQueue = new Queue('vision-analysis', { connection });
const variationQueue = new Queue('prompt-variation', { connection });
const generationQueue = new Queue('image-generation', { connection });
const assetQueue = new Queue('asset-processing', { connection });
const mockupQueue = new Queue('mockup-generation', { connection });

module.exports = {
    visionQueue,
    variationQueue,
    generationQueue,
    assetQueue,
    mockupQueue
};
