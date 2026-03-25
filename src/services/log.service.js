const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class LogService {
    async logEvent(jobId, eventType, status, message = null, data = null) {
        try {
            await prisma.jobLog.create({
                data: {
                    jobId,
                    eventType,
                    status,
                    message,
                    data: data ? data : undefined
                }
            });
            console.log(`[Job ${jobId}] ${eventType} -> ${status}: ${message || ''}`);
        } catch (err) {
            console.error('Failed to write log for job', jobId, err);
        }
    }

    async getLogs(jobId) {
        return prisma.jobLog.findMany({
            where: { jobId },
            orderBy: { createdAt: 'asc' } // chronological
        });
    }
}

module.exports = new LogService();
