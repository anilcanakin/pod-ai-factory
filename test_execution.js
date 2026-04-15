const generationService = require('./src/services/generation.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        // Just resolve the model id or call a small part
        console.log('Resolved model:', generationService.resolveModelId('quality'));
        
        // Let's try to simulate the loop
        const result = await generationService.runGeneration('non-existent-id');
        console.log('Result:', result);
    } catch (err) {
        console.error('ERROR during execution:', err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
