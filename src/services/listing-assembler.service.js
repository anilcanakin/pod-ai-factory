const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const etsyBrowser = require('./etsy-browser.service');

/**
 * ListingAssemblerService
 * The "Final Assembly" line that packages everything for Etsy
 */
class ListingAssemblerService {
  /**
   * assembleAndDispatch
   * Collects all assets for a design and sends it to Etsy as a draft
   */
  async assembleAndDispatch(designId, workspaceId) {
    console.log(`[Assembler] Assembling design ${designId} for dispatch...`);

    try {
      // 1. Fetch Design and SEO
      const design = await prisma.design.findUnique({
        where: { id: designId },
        include: { ListingSEO: true }
      });

      if (!design) throw new Error("Design not found");
      if (!design.ListingSEO) throw new Error("SEO not generated for this design");

      // 2. Fetch Best Mockup
      const mockups = await prisma.generation.findMany({
        where: { jobId: designId, type: 'MOCKUP' },
        orderBy: { createdAt: 'desc' }
      });

      if (mockups.length === 0) throw new Error("No mockups found for this design");

      // 3. Prepare Payload
      const draftPayload = {
        title: design.ListingSEO.title,
        description: design.ListingSEO.description,
        tags: design.ListingSEO.tags, // This is already an array in our schema
        price: 24.99, // Default price, could be made dynamic
        imageUrls: [mockups[0].imageUrl] // Primary image is the latest mockup
      };

      // 4. Send to Browser Agent
      const result = await etsyBrowser.createEtsyDraft(draftPayload);

      return result;
    } catch (error) {
      console.error("[Assembler] Dispatch failed:", error.message);
      throw error;
    }
  }
}

module.exports = new ListingAssemblerService();
