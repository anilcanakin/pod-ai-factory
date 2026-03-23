const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobs() {
    const job = await prisma.designJob.findFirst({ orderBy: { createdAt: 'desc' }, include: { images: true } });
    if (!job) return console.log('No recent job');

    console.log(`Job ID: ${job.id}`);
    console.log(`Job Status: ${job.status}`);

    if (job.images.length > 0) {
        console.log(`Image Status: ${job.images[0].status}`);
        console.log(`Image Engine: ${job.images[0].engine}`);
    } else {
        console.log('No images generated for this job yet.');
    }

    const logs = await prisma.jobLog.findMany({
        where: { jobId: job.id },
        orderBy: { createdAt: 'asc' }
    });

    console.log('\n--- JOB LOGS ---');
    logs.forEach(l => {
        console.log(`[${l.eventType}] ${l.status} - ${l.message}`);
    });
}

checkJobs().catch(console.error).finally(() => prisma.$disconnect());
