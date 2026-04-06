const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    datasources: {
        db: { url: process.env.DATABASE_URL }
    }
});

async function main() {
    const jobId = process.argv[2];
    if (!jobId) {
        console.error("Usage: node scripts/debug_job.js <JOB_ID>");
        process.exit(1);
    }

    console.log(`\n=== Debugging Job: ${jobId} ===\n`);

    try {
        const job = await prisma.designJob.findUnique({
            where: { id: jobId }
        });

        if (!job) {
            console.log("DesignJob: NOT FOUND");
            return;
        }

        console.log(`DesignJob Found. Status: ${job.status}`);

        const images = await prisma.image.findMany({
            where: { jobId: jobId }
        });

        console.log(`\nTotal Images linked to Job: ${images.length}`);

        const generated = images.filter(i => i.status === 'GENERATED').length;
        const rejected = images.filter(i => i.status === 'REJECTED').length;
        const completed = images.filter(i => i.status === 'COMPLETED').length;
        const emptyUrls = images.filter(i => !i.imageUrl || i.imageUrl === 'PENDING').length;

        console.log(`- GENERATED: ${generated}`);
        console.log(`- COMPLETED: ${completed}`);
        console.log(`- REJECTED: ${rejected}`);
        console.log(`- Images with Empty/PENDING URLs: ${emptyUrls}\n`);

        console.log("Image Details:");
        images.forEach((img, idx) => {
            console.log(`${idx + 1}. ID: ${img.id} | Engine: ${img.engine} | Status: ${img.status} | URL: ${img.imageUrl}`);
        });

    } catch (e) {
        console.error("Error connecting to DB:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
