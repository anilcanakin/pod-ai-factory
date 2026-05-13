const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '../assets/presets/shadows');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const PRESETS = [
    { name: 'tshirt',      w: 800,  h: 1000 },
    { name: 'hoodie',      w: 800,  h: 1000 },
    { name: 'sweatshirt',  w: 800,  h: 1000 },
    { name: 'mug',         w: 800,  h: 800  },
    { name: 'sticker',     w: 800,  h: 800  },
    { name: 'phone_case',  w: 600,  h: 1000 },
];

async function makeShadow({ name, w, h }) {
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="vignette" cx="50%" cy="50%" r="65%">
                <stop offset="0%"   stop-color="black" stop-opacity="0"/>
                <stop offset="55%"  stop-color="black" stop-opacity="0"/>
                <stop offset="100%" stop-color="black" stop-opacity="0.28"/>
            </radialGradient>
            <linearGradient id="topfold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stop-color="black" stop-opacity="0.10"/>
                <stop offset="12%" stop-color="black" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="botfold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="88%" stop-color="black" stop-opacity="0"/>
                <stop offset="100%" stop-color="black" stop-opacity="0.12"/>
            </linearGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#vignette)"/>
        <rect width="${w}" height="${h}" fill="url(#topfold)"/>
        <rect width="${w}" height="${h}" fill="url(#botfold)"/>
    </svg>`;

    await sharp(Buffer.from(svg), { density: 96 })
        .png()
        .toFile(path.join(OUT, `${name}_shadow.png`));

    console.log(`✓ ${name}_shadow.png`);
}

(async () => {
    for (const p of PRESETS) await makeShadow(p);
    console.log('All preset shadows created in assets/presets/shadows/');
})();
