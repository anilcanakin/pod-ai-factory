'use strict';

require('dotenv').config();
const fs = require('fs');
const { transformPhotoWithAI } = require('../src/services/photo-composite.service');

async function main() {
  const photoBuffer = fs.readFileSync('uploads/temp/cat.jpg');
  const outBuf = await transformPhotoWithAI(photoBuffer, null, true); // useRealBgRemove=true, hiçbir duotone/posterize yok
  fs.writeFileSync('uploads/temp/output-ai-raw.png', outBuf);
  console.log('OK uploads/temp/output-ai-raw.png', outBuf.length, 'bytes');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
