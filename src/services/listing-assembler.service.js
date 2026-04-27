const prisma = require('../lib/prisma');
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
  async assembleAndDispatch(imageId) {
    console.log(`[Assembler] Assembling image ${imageId} for dispatch...`);

    try {
      // 1. Fetch the design image and its parent job
      const image = await prisma.image.findUnique({
        where: { id: imageId },
        include: { job: true }
      });

      if (!image) throw new Error('Image not found');

      // 2. Fetch SEO content for this image
      const seoContent = await prisma.sEOData.findFirst({
        where: { imageId: image.id }
      });

      if (!seoContent) throw new Error('SEO not generated for this design — run SEO first');

      // 3. Fetch mockup images for this job
      const mockups = await prisma.image.findMany({
        where: { jobId: image.jobId, engine: 'mockup' },
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      // Use mockup as primary image if available, otherwise use the design image itself
      const primaryImageUrl = mockups.length > 0 ? mockups[0].imageUrl : image.imageUrl;
      const additionalImageUrls = mockups.slice(1).map(m => m.imageUrl);

      // 4. Prepare payload
      const draftPayload = {
        title: seoContent.title,
        description: seoContent.description,
        tags: seoContent.tags,
        price: 24.99, // Default price — can be made dynamic
        imageUrls: [primaryImageUrl, ...additionalImageUrls].filter(Boolean)
      };

      // 5. Send to Browser Agent
      const result = await etsyBrowser.createEtsyDraft(draftPayload);

      return result;
    } catch (error) {
      console.error('[Assembler] Dispatch failed:', error.message);
      throw error;
    }
  }
}

module.exports = new ListingAssemblerService();
