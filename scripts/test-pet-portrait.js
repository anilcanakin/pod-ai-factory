'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const { generatePetPortrait } = require('../src/services/pet-portrait-composite.service');

const PERSON_PHOTO = 'C:\\Users\\Anılcan\\Desktop\\test-fotograflar\\vicky-hladynets-C8Ta0gwPbQg-unsplash.jpg';
const PET_PHOTO    = 'C:\\Users\\Anılcan\\Desktop\\test-fotograflar\\victor-g-N04FIfHhv_k-unsplash.jpg';
const OUTPUT_PATH  = 'uploads/temp/pet-portrait-test-output.png';

// "multi_photo_generative" tipi bir PhotoTemplate satırının minimal duruşu — DB'ye
// dokunmadan pipeline'ı izole test etmek için elle kurulmuş.
const FAKE_TEMPLATE = {
  printWidthPx: 3000,
  printHeightPx: 3600,
  textLayers: [], // v1 smoke test — isim/tarih overlay opsiyonel, boş bırakıldı
};

async function main() {
  const runId = Math.random().toString(36).slice(2, 8);

  const personBuf = fs.readFileSync(PERSON_PHOTO);
  const petBuf    = fs.readFileSync(PET_PHOTO);
  const personHash = crypto.createHash('sha256').update(personBuf).digest('hex').slice(0, 12);
  const petHash     = crypto.createHash('sha256').update(petBuf).digest('hex').slice(0, 12);
  console.log(`[TEST][${runId}] START t=${new Date().toISOString()}`);
  console.log(`[TEST][${runId}] person=${PERSON_PHOTO} hash=${personHash} bytes=${personBuf.length}`);
  console.log(`[TEST][${runId}] pet=${PET_PHOTO} hash=${petHash} bytes=${petBuf.length}`);

  const result = await generatePetPortrait({
    personPhotoPath: PERSON_PHOTO,
    petPhotoPath:    PET_PHOTO,
    template:        FAKE_TEMPLATE,
    variables:       {},
    workspaceId:     null, // env FAL_API_KEY fallback (secrets.service.js)
    outputPath:      OUTPUT_PATH,
  });

  const outHash = crypto.createHash('sha256').update(result.buffer).digest('hex').slice(0, 12);
  console.log(`[TEST][${runId}] Adım 1 (birleştirme) → ${result.steps.combinedUrl}`);
  console.log(`[TEST][${runId}] Adım 2 (stilizasyon) → ${result.steps.stylizedUrl}`);
  console.log(`[TEST][${runId}] Adım 3 (BG kaldırma) → ${result.steps.transparentUrl}`);
  console.log(`[TEST][${runId}] END t=${new Date().toISOString()} OK ${result.outputPath} ${result.width}x${result.height} outHash=${outHash} bytes=${result.buffer.length}`);
}

main().catch(err => {
  console.error('FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
