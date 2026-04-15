try {
    const generationService = require('./src/services/generation.service');
    console.log('GenerationService loaded');
    const ideaRoutes = require('./src/routes/idea.routes');
    console.log('IdeaRoutes loaded');
    const assetWorker = require('./src/queues/asset.worker');
    console.log('AssetWorker loaded');
} catch (err) {
    console.error('LOAD ERROR:', err);
}
