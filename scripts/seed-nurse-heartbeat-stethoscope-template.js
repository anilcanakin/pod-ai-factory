'use strict';

/**
 * Seed: "Custom Nurse - Heartbeat Stethoscope EKG" text_only PhotoTemplate.
 * Base artwork: assets/uploads/photo-templates/nursing-heart-stethoscope-base.png
 * (heart+EKG+stethoscope motif, transparent, alpha-recolorable at render time).
 *
 * Usage: node scripts/seed-nurse-heartbeat-stethoscope-template.js
 * Safe to re-run — checks for existing template before creating.
 */

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const NAME = 'Custom Nurse - Heartbeat Stethoscope EKG';

async function main() {
  const workspace = await prisma.workspace.findUnique({
    where: { id: '7139ef56-725f-4d15-aecc-7b5130958edb' },
  });
  if (!workspace) {
    console.error('Workspace 7139ef56-725f-4d15-aecc-7b5130958edb not found.');
    process.exit(1);
  }

  const existing = await prisma.photoTemplate.findFirst({
    where: { workspaceId: workspace.id, name: NAME },
  });
  if (existing) {
    console.log(`Template already exists: ${existing.id}`);
    return;
  }

  const template = await prisma.photoTemplate.create({
    data: {
      workspaceId:    workspace.id,
      name:           NAME,
      occasion:       'nurse',
      templateType:   'text_only',
      baseArtworkUrl: 'assets/uploads/photo-templates/nursing-heart-stethoscope-base.png',
      textLayers: [
        {
          key: 'name', font: 'GingerbreadRegular', size: 514,
          x: 2250, y: 2656, align: 'center', color: '#1d1d1b',
          scaleX: 1.38, maxWidth: 3600,
        },
        {
          key: 'nursing_position', font: 'BaseballClubSolid', size: 505,
          x: 2340, y: 1398, align: 'center', color: '#1d1d1b',
          scaleX: 0.96, maxWidth: 900,
        },
      ],
      printWidthPx:  4500,
      printHeightPx: 5400,
      mockupConfig:  { inkTintable: true },
      active: true,
    },
  });

  console.log(`Created: ${template.id}`);
}

main()
  .catch(err => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
