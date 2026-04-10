const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * MultimodalBrainService
 * Handles video digestion using Vision AI + Audio Transcription
 */
class MultimodalBrainService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'assets', 'temp_brain');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * extractFrames
   * Extracts one frame every 10 seconds from the video
   */
  async extractFrames(videoPath, sessionId) {
    const sessionDir = path.join(this.tempDir, sessionId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .on('end', () => {
          const frames = fs.readdirSync(sessionDir).map(f => path.join(sessionDir, f));
          resolve(frames);
        })
        .on('error', (err) => reject(err))
        .screenshots({
          count: 10, // Default to 10 frames spread across the video for now
          folder: sessionDir,
          size: '1280x720'
        });
    });
  }

  /**
   * processVideo
   * Main entry point for digesting a video tutorial or meeting
   */
  async processVideo(workspaceId, videoPath, title, type = 'VIDEO_TUTORIAL') {
    const sessionId = Date.now().toString();
    console.log(`[Brain] Starting digestion for: ${title}`);

    try {
      // 1. Extract Frames
      const frames = await this.extractFrames(videoPath, sessionId);
      
      // 2. Transcribe (Placeholder for Whisper/Gemini Audio - Using Gemini Multimodal directly for simplicity)
      // Gemini 1.5 can take video or images + text. We will send images for "Eye" and text for context.
      
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const imageParts = frames.map(framePath => {
        return {
          inlineData: {
            data: Buffer.from(fs.readFileSync(framePath)).toString("base64"),
            mimeType: "image/jpeg"
          }
        };
      });

      const prompt = `
        You are an expert Etsy Shop Manager & POD Strategist. 
        I am providing you with multiple screenshots from a video tutorial or meeting titled: "${title}".
        
        TASK:
        1. Analyze the visual information (UI settings, charts, demonstrated actions).
        2. Combine it with the context of Etsy best practices for 2026.
        3. Extract actionable "IF-THEN" rules. Example: "IF a product has high impressions but low clicks, THEN change the main mockup to a lifestyle video."
        4. Identify any specific UI elements or settings mentioned.
        
        OUTPUT FORMAT (JSON):
        {
          "summary": "Short overview of the video content",
          "actionableRules": [
            { "condition": "IF...", "action": "THEN...", "rationale": "Why?" }
          ],
          "uiInsights": [
            { "element": "Production Time", "recommendation": "Set to 1-2 days based on the screen share at 12:40" }
          ],
          "strategicNotes": ["Tip 1", "Tip 2"]
        }
      `;

      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      let text = response.text();
      
      // Clean JSON if needed
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const analysis = JSON.parse(text);

      // 3. Save to CorporateMemory
      const memory = await prisma.corporateMemory.create({
        data: {
          workspaceId,
          type,
          title,
          content: analysis.summary,
          analysisResult: analysis,
          sourceUrl: videoPath, // Or the actual source URL if provided
        }
      });

      // 4. Cleanup
      fs.rmSync(path.join(this.tempDir, sessionId), { recursive: true, force: true });

      return memory;
    } catch (error) {
      console.error("[Brain] Error processing video:", error);
      throw error;
    }
  }
}

module.exports = new MultimodalBrainService();
