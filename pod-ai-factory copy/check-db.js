const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkJobs() {
    console.log('--- DB Check ---');
    const images = await prisma.image.findMany({
        where: { status: 'PROCESSED' },
        include: {
            mockups: true,
            seoData: true,
            job: true
        }
    });

    console.log(`Found ${images.length} processed images.`);
    images.forEach(i => {
        console.log(`Img ID: ${i.id}`);
        console.log(`Job ID: ${i.jobId}`);
        console.log(`Workspace ID: ${i.job.workspaceId}`);
        console.log(`Mockups Count: ${i.mockups.length}`);
        console.log(`Has SEO: ${!!i.seoData}`);
        console.log('---');
    });
}
checkJobs().finally(() => prisma.$disconnect());
