const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

const outputDir = path.join(__dirname, '../../assets/outputs');
const templateDir = path.join(__dirname, '../../assets/pack-templates');

// Ensure template directory exists
if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

/**
 * Product template definitions
 * Each product has a canvas size and a placement area where the design gets composited
 */
const PRODUCT_TEMPLATES = {
    tshirt: {
        label: 'T-Shirt',
        canvasWidth: 2400,
        canvasHeight: 3000,
        placement: { x: 600, y: 400, width: 1200, height: 1400 },
        bgColor: '#1a1a1a',
        shapeColor: '#2d2d2d'
    },
    sweatshirt: {
        label: 'Sweatshirt',
        canvasWidth: 2400,
        canvasHeight: 3000,
        placement: { x: 550, y: 350, width: 1300, height: 1500 },
        bgColor: '#111122',
        shapeColor: '#1a1a3e'
    },
    mug: {
        label: 'Mug',
        canvasWidth: 2000,
        canvasHeight: 2000,
        placement: { x: 300, y: 400, width: 1400, height: 1000 },
        bgColor: '#1a1a1a',
        shapeColor: '#f5f5f5'
    },
    sticker: {
        label: 'Sticker',
        canvasWidth: 1500,
        canvasHeight: 1500,
        placement: { x: 150, y: 150, width: 1200, height: 1200 },
        bgColor: '#ffffff',
        shapeColor: '#f0f0f0'
    },
    phone_case: {
        label: 'Phone Case',
        canvasWidth: 1200,
        canvasHeight: 2400,
        placement: { x: 100, y: 300, width: 1000, height: 1600 },
        bgColor: '#0a0a0a',
        shapeColor: '#1a1a2e'
    }
};

class ProductPackService {

    /**
     * Get default product pack items (built-in templates)
     */
    getDefaultProducts() {
        return Object.entries(PRODUCT_TEMPLATES).map(([type, config]) => ({
            productType: type,
            label: config.label,
            placementConfig: config.placement,
            canvasWidth: config.canvasWidth,
            canvasHeight: config.canvasHeight
        }));
    }

    /**
     * Create a product pack with selected product types
     */
    async createPack(workspaceId, name, productTypes) {
        const validTypes = productTypes.filter(t => PRODUCT_TEMPLATES[t]);
        if (validTypes.length === 0) throw new Error('At least one valid product type required');

        const pack = await prisma.productPack.create({
            data: {
                workspaceId,
                name,
                items: {
                    create: validTypes.map(type => ({
                        productType: type,
                        placementConfig: PRODUCT_TEMPLATES[type].placement
                    }))
                }
            },
            include: { items: true }
        });

        return pack;
    }

    /**
     * Generate mockup for a specific product type using Sharp
     * Composites the design image onto a product-shaped canvas
     */
    async generateProductMockup(designImagePath, productType, imageId) {
        const template = PRODUCT_TEMPLATES[productType];
        if (!template) throw new Error(`Unknown product type: ${productType}`);

        const { canvasWidth, canvasHeight, placement, bgColor, shapeColor, label } = template;

        // Create base canvas with product shape
        const productSvg = this.buildProductSvg(productType, canvasWidth, canvasHeight, shapeColor, label);

        // Try to load and resize design, fall back to placeholder
        let designBuffer;
        const fullDesignPath = path.isAbsolute(designImagePath)
            ? designImagePath
            : path.join(__dirname, '../../', designImagePath);

        if (fs.existsSync(fullDesignPath)) {
            designBuffer = await sharp(fullDesignPath)
                .resize(placement.width, placement.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
        } else {
            // Generate placeholder design
            designBuffer = await sharp({
                create: { width: placement.width, height: placement.height, channels: 4, background: '#333333' }
            })
                .composite([{
                    input: Buffer.from(`<svg width="${placement.width}" height="${placement.height}">
                        <rect width="100%" height="100%" fill="#333" rx="10"/>
                        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
                              font-size="40" fill="#fff">DESIGN</text>
                    </svg>`),
                    top: 0, left: 0
                }])
                .png()
                .toBuffer();
        }

        // Composite design onto product canvas
        const mockupFilename = `${imageId}_pack_${productType}.png`;
        const mockupPath = path.join(outputDir, mockupFilename);

        await sharp({
            create: { width: canvasWidth, height: canvasHeight, channels: 4, background: bgColor }
        })
            .composite([
                { input: Buffer.from(productSvg), top: 0, left: 0 },
                { input: designBuffer, top: placement.y, left: placement.x }
            ])
            .png()
            .toFile(mockupPath);

        return `assets/outputs/${mockupFilename}`;
    }

    /**
     * Build an SVG product shape outline
     */
    buildProductSvg(type, width, height, color, label) {
        const shapes = {
            tshirt: `<path d="M${width * 0.3} ${height * 0.1} L${width * 0.1} ${height * 0.25} L${width * 0.2} ${height * 0.35} L${width * 0.25} ${height * 0.25} L${width * 0.25} ${height * 0.85} L${width * 0.75} ${height * 0.85} L${width * 0.75} ${height * 0.25} L${width * 0.8} ${height * 0.35} L${width * 0.9} ${height * 0.25} L${width * 0.7} ${height * 0.1} Z" fill="${color}" stroke="#444" stroke-width="3"/>`,
            sweatshirt: `<path d="M${width * 0.28} ${height * 0.08} L${width * 0.05} ${height * 0.3} L${width * 0.18} ${height * 0.42} L${width * 0.22} ${height * 0.3} L${width * 0.22} ${height * 0.88} L${width * 0.78} ${height * 0.88} L${width * 0.78} ${height * 0.3} L${width * 0.82} ${height * 0.42} L${width * 0.95} ${height * 0.3} L${width * 0.72} ${height * 0.08} Z" fill="${color}" stroke="#444" stroke-width="3"/>`,
            mug: `<ellipse cx="${width * 0.45}" cy="${height * 0.5}" rx="${width * 0.35}" ry="${height * 0.35}" fill="${color}" stroke="#444" stroke-width="3"/><path d="M${width * 0.75} ${height * 0.35} Q${width * 0.95} ${height * 0.35} ${width * 0.95} ${height * 0.5} Q${width * 0.95} ${height * 0.65} ${width * 0.75} ${height * 0.65}" fill="none" stroke="#444" stroke-width="4"/>`,
            sticker: `<rect x="${width * 0.05}" y="${height * 0.05}" width="${width * 0.9}" height="${height * 0.9}" rx="30" fill="${color}" stroke="#ddd" stroke-width="3" stroke-dasharray="15,10"/>`,
            phone_case: `<rect x="${width * 0.05}" y="${height * 0.05}" width="${width * 0.9}" height="${height * 0.9}" rx="40" fill="${color}" stroke="#444" stroke-width="3"/>`
        };

        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            ${shapes[type] || `<rect width="${width}" height="${height}" fill="${color}"/>`}
            <text x="${width / 2}" y="${height * 0.95}" text-anchor="middle" font-size="36" fill="#666">${label}</text>
        </svg>`;
    }

    /**
     * Run a design through a product pack
     * Takes an approved image and generates mockups for each product in the pack
     */
    async runPackPipeline(imageId, packId, workspaceId) {
        const image = await prisma.image.findFirst({
            where: { id: imageId, job: { workspaceId } }
        });
        if (!image) throw new Error('Image not found');

        const pack = await prisma.productPack.findFirst({
            where: { id: packId, workspaceId },
            include: { items: true }
        });
        if (!pack) throw new Error('Product pack not found');

        const results = [];

        for (const item of pack.items) {
            const designPath = image.masterFileUrl || image.imageUrl;
            const mockupUrl = await this.generateProductMockup(designPath, item.productType, imageId);

            // Save mockup to DB
            const mockup = await prisma.mockup.create({
                data: {
                    imageId,
                    templateId: `pack_${item.productType}`,
                    mockupUrl
                }
            });

            results.push({
                productType: item.productType,
                mockupUrl,
                mockupId: mockup.id
            });
        }

        return {
            imageId,
            packId,
            packName: pack.name,
            mockups: results,
            message: `Generated ${results.length} product mockups.`
        };
    }
}

module.exports = new ProductPackService();
