const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// DailyTask modeli veritabanında yoksa (henüz migrate edilmediyse) sessizce atla
function isDailyTaskReady() {
    return typeof prisma.dailyTask !== 'undefined';
}

/**
 * TaskService - Manages daily autonomous goals for the AI Agent.
 */
class TaskService {
    /**
     * Initializes daily tasks for the current day.
     * Should be called at 00:00 or at system startup.
     */
    async initializeDailyTasks() {
        if (!isDailyTaskReady()) {
            console.warn('[TaskService] DailyTask tablosu henüz oluşturulmamış. Migration çalıştır: npx prisma migrate dev --name add_daily_task');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const defaultTasks = [
            { taskType: 'GENERATION', targetCount: 10 },
            { taskType: 'MOCKUP',     targetCount: 10 },
            { taskType: 'SEO',        targetCount: 10 }
        ];

        console.log(`[TaskService] Initializing daily tasks for ${today.toDateString()}...`);

        for (const task of defaultTasks) {
            try {
                await prisma.dailyTask.upsert({
                    where: {
                        date_taskType: {
                            date: today,
                            taskType: task.taskType
                        }
                    },
                    update: {}, // Don't reset if already exists
                    create: {
                        date: today,
                        taskType: task.taskType,
                        targetCount: task.targetCount,
                        currentCount: 0,
                        isCompleted: false
                    }
                });
            } catch (err) {
                console.error(`[TaskService] Upsert hatası (${task.taskType}):`, err.message);
            }
        }
    }

    /**
     * Increments the progress of a specific task type for today.
     * Automatically masks as completed if target is reached.
     */
    async incrementTask(taskType) {
        if (!isDailyTaskReady()) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        try {
            const task = await prisma.dailyTask.findUnique({
                where: {
                    date_taskType: {
                        date: today,
                        taskType: taskType
                    }
                }
            });

            if (!task) {
                console.warn(`[TaskService] No active task found for ${taskType} today.`);
                return;
            }

            const newCount = task.currentCount + 1;
            const completed = newCount >= task.targetCount;

            await prisma.dailyTask.update({
                where: { id: task.id },
                data: {
                    currentCount: newCount,
                    isCompleted: completed
                }
            });

            if (completed && !task.isCompleted) {
                console.log(`[TaskService] 🎯 Task COMPLETED: ${taskType} goal reached!`);
            }
        } catch (err) {
            console.error(`[TaskService] Error incrementing ${taskType}:`, err.message);
        }
    }

    /**
     * Retrieves all tasks for today.
     */
    async getTodayTasks() {
        if (!isDailyTaskReady()) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return await prisma.dailyTask.findMany({
            where: { date: today }
        });
    }
}

module.exports = new TaskService();
