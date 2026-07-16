'use strict';

/**
 * Seed: creates the "Pet of Fury" PhotoTemplate (birthday occasion, pet niche).
 * Thumbnail (baseArtworkUrl) is generated with the real photo-composite pipeline
 * against a placeholder circle photo, so the template grid shows an accurate preview.
 *
 * Usage: node scripts/seed-pet-fury-template.js
 *
 * Safe to re-run — checks for existing template before creating.
 */

require('dotenv').config();
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const prisma = require('../src/lib/prisma');
const { generateFuryTourPoster, OUTPUT_W, OUTPUT_H } = require('../src/services/photo-composite.service');

const SLOT = { x: 750, y: 900, width: 3000, height: 3000, fit: 'cover' };

async function main() {
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    console.error('No workspace found. Start the app and log in first.');
    process.exit(1);
  }
  console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

  const existing = await prisma.photoTemplate.findFirst({
    where: { workspaceId: workspace.id, name: 'Pet of Fury Tour Poster' },
  });
  if (existing) {
    console.log(`Template already exists: ${existing.id}`);
    console.log('Seed complete (no-op).');
    return;
  }

  // Placeholder circle "photo" — the real composite pipeline turns any photo into
  // a grayscale/duotone stencil, so a flat placeholder is enough for the thumbnail.
  const placeholderPath = path.join(require('os').tmpdir(), 'pet-fury-placeholder.png');
  await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
          <circle cx="400" cy="320" r="180" fill="#dddddd"/>
          <circle cx="400" cy="640" r="260" fill="#dddddd"/>
        </svg>`
      ),
      blend: 'over',
    }])
    .png()
    .toFile(placeholderPath);

  const { buffer } = await generateFuryTourPoster({
    customerPhotoPath: placeholderPath,
    petName: 'YOUR PET',
    templateConfig: { photoSlot: SLOT },
  });
  fs.unlinkSync(placeholderPath);

  const artworkDir = path.join(__dirname, '../assets/uploads/photo-templates');
  if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });
  const artworkPath = path.join(artworkDir, 'pet-fury-base.png');
  fs.writeFileSync(artworkPath, buffer);
  const baseArtworkUrl = 'assets/uploads/photo-templates/pet-fury-base.png';
  console.log(`Base artwork saved → ${baseArtworkUrl}`);

  const template = await prisma.photoTemplate.create({
    data: {
      workspaceId:   workspace.id,
      name:          'Pet of Fury Tour Poster',
      occasion:      'birthday',
      baseArtworkUrl,
      photoSlot: SLOT,
      textLayers: [
        {
          key: 'petName', x: OUTPUT_W / 2, y: Math.round(SLOT.y * 0.6),
          font: 'Montserrat-Bold', size: 64,
          color: '#FFFFFF', align: 'center',
          maxWidth: 3000, transform: 'uppercase',
        },
      ],
      printWidthPx:  OUTPUT_W,
      printHeightPx: OUTPUT_H,
      mockupConfig:  { tintColor: '#C8A97A' },
      active: true,
    },
  });

  console.log(`✅ Pet of Fury template created: ${template.id}`);
  console.log(`   Occasion: ${template.occasion}`);
  console.log(`   printSize: ${OUTPUT_W}×${OUTPUT_H}px`);
}

main()
  .catch(err => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
