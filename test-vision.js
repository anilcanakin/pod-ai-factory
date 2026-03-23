require('dotenv').config();
const { visionService } = require('./src/services/vision.service');

async function run() {
    try {
        console.log("Starting Vision Extraction Test...");

        // A placeholder URL for a vintage t-shirt design (or any valid image URL)
        // For testing the schema, we just need the Vision API to process this.
        const testImageUrl = "https://images.unsplash.com/photo-1529374255404-311a2a4f1fd9?auto=format&fit=crop&q=80&w=500";

        console.log("Analyzing image:", testImageUrl);
        const result = await visionService.analyzeImage(testImageUrl);

        console.log("\n--- EXTRACTED DESIGN GRAMMAR (JSON) ---");
        console.log(JSON.stringify(result.parsedVisionJson, null, 2));
        console.log("---------------------------------------\n");

        process.exit(0);
    } catch (err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}

run();
