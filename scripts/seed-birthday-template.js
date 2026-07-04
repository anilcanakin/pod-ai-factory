'use strict';

/**
 * Seed: creates the birthday PhotoTemplate with a Sharp-generated base artwork.
 * No Fal.ai required.
 *
 * Usage: node scripts/seed-birthday-template.js
 *
 * Safe to re-run — checks for existing template before creating.
 */

require('dotenv').config();
const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');
const prisma = require('../src/lib/prisma');

const ASSETS_ROOT = path.join(__dirname, '../assets');
const PRINT_W = 1200, PRINT_H = 1440;
const SLOT_X = 300, SLOT_Y = 180, SLOT_SIZE = 600;

async function main() {
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    console.error('No workspace found. Start the app and log in first.');
    process.exit(1);
  }
  console.log(`Using workspace: ${workspace.name} (${workspace.id})`);

  const existing = await prisma.photoTemplate.findFirst({
    where: { workspaceId: workspace.id, name: 'Vintage Birthday Photo Shirt' },
  });
  if (existing) {
    console.log(`Template already exists: ${existing.id}`);
    console.log('Seed complete (no-op).');
    return;
  }

  // Generate base artwork: golden background + dark ring around photo slot
  const baseBuffer = await sharp({
    create: { width: PRINT_W, height: PRINT_H, channels: 3, background: { r: 212, g: 175, b: 55 } },
  })
  .composite([{
    input: Buffer.from(
      `<svg width="${PRINT_W}" height="${PRINT_H}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${SLOT_X + SLOT_SIZE / 2}" cy="${SLOT_Y + SLOT_SIZE / 2}"
                r="${SLOT_SIZE / 2 + 20}" fill="none" stroke="#8B6914" stroke-width="12"/>
      </svg>`
    ),
    blend: 'over',
  }])
  .png()
  .toBuffer();

  const artworkDir = path.join(ASSETS_ROOT, 'uploads', 'photo-templates');
  if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true });

  const artworkPath = path.join(artworkDir, 'birthday-vintage-base.png');
  fs.writeFileSync(artworkPath, baseBuffer);
  const baseArtworkUrl = 'assets/uploads/photo-templates/birthday-vintage-base.png';
  console.log(`Base artwork saved → ${baseArtworkUrl}`);

  const template = await prisma.photoTemplate.create({
    data: {
      workspaceId:   workspace.id,
      name:          'Vintage Birthday Photo Shirt',
      occasion:      'birthday',
      baseArtworkUrl,
      photoSlot: {
        x: SLOT_X, y: SLOT_Y,
        width: SLOT_SIZE, height: SLOT_SIZE,
        fit: 'cover', align: 'center',
        borderRadius: 300,
        rotation: 0,
      },
      textLayers: [
        {
          key: 'name', x: 600, y: 880,
          font: 'Montserrat-Bold', size: 64,
          color: '#FFFFFF', align: 'center',
          maxWidth: 700, transform: 'uppercase',
        },
        {
          key: 'year', x: 600, y: 960,
          font: 'Montserrat-Regular', size: 48,
          color: '#FFD700', align: 'center',
          maxWidth: 500, transform: null,
        },
      ],
      printWidthPx:  PRINT_W,
      printHeightPx: PRINT_H,
      mockupConfig:  { mockupTemplateId: null },
      active: true,
    },
  });

  console.log(`✅ Birthday template created: ${template.id}`);
  console.log(`   Name: ${template.name}`);
  console.log(`   printSize: ${PRINT_W}×${PRINT_H}px`);
  console.log(`   photoSlot: ${SLOT_SIZE}px circle at (${SLOT_X}, ${SLOT_Y})`);
}

main()
  .catch(err => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
