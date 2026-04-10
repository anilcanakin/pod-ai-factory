const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const etsyBrowser = require('./etsy-browser.service');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * AutonomousManagerService
 * The "Brain" that manages the store based on corporate memories and live stats
 */
class AutonomousManagerService {
  /**
   * runDailyAudit
   * Performs a full scan of the store and applies knowledge-based optimizations
   */
  async runDailyAudit(workspaceId) {
    console.log(`[Agent] Starting daily store audit for workspace: ${workspaceId}`);

    try {
      // 1. Fetch Corporate Memory (the "rules" learned from videos)
      const memories = await prisma.corporateMemory.findMany({
        where: { workspaceId, isActive: true },
        select: { title: true, analysisResult: true }
      });

      // 2. Fetch Live Stats from Etsy
      const { stats, success: statsSuccess } = await etsyBrowser.getListingStats();
      if (!statsSuccess) throw new Error("Failed to fetch Etsy stats");

      // 3. Consult the AI Strategist
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `
        You are the CEO and Store Manager of a top-tier Etsy POD shop. 
        I am providing you with:
        1. STRATEGIC RULES (Learned from recent training videos/meetings).
        2. LIVE PERFORMANCE STATS (Impressions, Visits, Orders per listing).

        KNOWLEDGE BASE:
        ${JSON.stringify(memories)}

        LIVE STATS:
        ${JSON.stringify(stats)}

        TASK:
        Analyze each listing. If a listing's performance triggers a rule from the knowledge base, create an optimization action.
        Examples: 
        - If Rule says: "Change mockup if CTR is < 1%", and listing 123 has 1000 impressions but 2 visits -> Action: "UPDATE_MOCKUP".
        - If Rule says: "Increase price by $2 if it has > 5 orders in 24h" -> Action: "UPDATE_PRICE".

        OUTPUT FORMAT (JSON):
        {
          "executiveSummary": "Analysis of current shop health",
          "actions": [
            {
              "listingId": "123",
              "actionType": "UPDATE_PRICE | UPDATE_SEO | UPDATE_MOCKUP | NOTIFICATION",
              "reason": "Why?",
              "details": { "newPrice": 19.99, "newTitle": "...", "note": "..." }
            }
          ]
        }
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const plan = JSON.parse(text);

      console.log(`[Agent] Audit complete. ${plan.actions.length} actions recommended.`);

      // 4. Notification Log (Instead of auto-executing for now, for safety)
      for (const action of plan.actions) {
        await prisma.jobLog.create({
          data: {
            jobId: action.listingId, // Mocking listingId as jobId for log
            eventType: 'AGENT_RECOMMENDATION',
            status: 'PENDING',
            message: `[AI Manager] ${action.reason}`,
            data: action
          }
        });
      }

      return plan;
    } catch (error) {
      console.error("[Agent] Audit failed:", error);
      throw error;
    }
  }
}

module.exports = new AutonomousManagerService();
