'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const { generateFuryTourPoster } = require('../src/services/photo-composite.service');

async function main() {
  const runId = Math.random().toString(36).slice(2, 8);
  const catBuf = fs.readFileSync('uploads/temp/cat.jpg');
  const catHash = crypto.createHash('sha256').update(catBuf).digest('hex').slice(0, 12);
  console.log(`[TEST][${runId}] START t=${new Date().toISOString()} cat.jpg hash=${catHash} bytes=${catBuf.length}`);

  const result = await generateFuryTourPoster({
    customerPhotoPath: 'uploads/temp/cat.jpg',
    petName: 'WHISKERS',
    templateConfig: {
      baseArtworkUrl: 'assets/uploads/photo-templates/pet-fury-shell.png',
      // measured black-box bbox in pet-fury-shell.png (592x1136): x9..583,y7..1134 pure-black scan was noise;
      // row/col >85%-dark scan gave px [29,562]x[170,772] → ratios below
      photoSlot: { x: 0.049, y: 0.1496, width: 0.9003, height: 0.5299, fit: 'cover' },
    },
    useAI: true,
    fabricBlend: true,
    outputPath: 'uploads/temp/output-test-boxfix.png',
  });
  const outHash = crypto.createHash('sha256').update(result.buffer).digest('hex').slice(0, 12);
  console.log(`[TEST][${runId}] END t=${new Date().toISOString()} OK ${result.outputPath} ${result.width}x${result.height} outHash=${outHash} bytes=${result.buffer.length}`);
}

main().catch(err => {
  console.error('FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
