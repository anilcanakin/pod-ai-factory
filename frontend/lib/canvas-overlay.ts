/**
 * canvas-overlay.ts — Browser Canvas tabanlı Slogan Text Overlay
 *
 * Model yazıyı doğru çizemediğinde fallback olarak kullanılır.
 * drawSloganOverlay() → bir görsel URL'si + metin alır, Canvas ile
 * üstüne yazı işler ve data URL döner.
 */

export interface SloganOverlayOptions {
    position:   'top' | 'center' | 'bottom';
    fontSize:   number;          // px
    fontFamily: string;
    textColor:  string;          // CSS color
    bgColor:    string;          // CSS color (rgba destekler)
    padding:    number;          // px (yatay + dikey iç boşluk)
    uppercase:  boolean;
}

const DEFAULTS: SloganOverlayOptions = {
    position:   'bottom',
    fontSize:   32,
    fontFamily: '"Geist", "Inter", Arial, sans-serif',
    textColor:  '#FFFFFF',
    bgColor:    'rgba(0, 0, 0, 0.68)',
    padding:    18,
    uppercase:  false,
};

/**
 * Bir görsel URL'si üzerine Canvas ile slogan yazısı ekler.
 * Tarayıcı ortamında çalışır (SSR uyumlu değil).
 * CORS kısıtlaması olan URL'lerde hata verebilir — caller yakalamalı.
 *
 * @returns PNG data URL
 */
export async function drawSloganOverlay(
    imageUrl: string,
    slogan:   string,
    options:  Partial<SloganOverlayOptions> = {}
): Promise<string> {
    const opts = { ...DEFAULTS, ...options };
    const text = opts.uppercase ? slogan.toUpperCase() : slogan;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas 2d context alınamadı')); return; }

            // 1. Görseli çiz
            ctx.drawImage(img, 0, 0);

            // 2. Yazı boyutunu ölçümle
            ctx.font = `bold ${opts.fontSize}px ${opts.fontFamily}`;
            const measured  = ctx.measureText(text);
            const textW     = measured.width;
            const stripH    = opts.fontSize + opts.padding * 2;
            const maxTextW  = canvas.width - opts.padding * 4;

            // Yazı geniş gelirse font'u küçült
            let finalFontSize = opts.fontSize;
            if (textW > maxTextW) {
                finalFontSize = Math.floor(opts.fontSize * (maxTextW / textW));
                ctx.font = `bold ${finalFontSize}px ${opts.fontFamily}`;
            }

            // 3. Şerit pozisyonu
            let stripY: number;
            if (opts.position === 'top')    stripY = 0;
            else if (opts.position === 'center') stripY = (canvas.height - stripH) / 2;
            else                            stripY = canvas.height - stripH;

            // 4. Arka plan şeridini çiz
            ctx.fillStyle = opts.bgColor;
            ctx.fillRect(0, stripY, canvas.width, stripH);

            // 5. Yazıyı merkez hizalı çiz
            ctx.fillStyle    = opts.textColor;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width / 2, stripY + stripH / 2, maxTextW);

            resolve(canvas.toDataURL('image/png'));
        };

        img.onerror = () => reject(new Error(`Görsel yüklenemedi: ${imageUrl}`));
        img.src = imageUrl;
    });
}

/**
 * İki satır overlay: üstte slogan, altta (küçük) niche etiketi.
 */
export async function drawDoubleLineOverlay(
    imageUrl:  string,
    headline:  string,
    subline:   string,
    options:   Partial<SloganOverlayOptions> = {}
): Promise<string> {
    const opts = { ...DEFAULTS, ...options };

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas context yok')); return; }

            ctx.drawImage(img, 0, 0);

            const headlineSize = opts.fontSize;
            const sublineSize  = Math.round(opts.fontSize * 0.55);
            const totalH       = headlineSize + sublineSize + opts.padding * 3;

            let stripY: number;
            if (opts.position === 'top')    stripY = 0;
            else if (opts.position === 'center') stripY = (canvas.height - totalH) / 2;
            else                            stripY = canvas.height - totalH;

            ctx.fillStyle = opts.bgColor;
            ctx.fillRect(0, stripY, canvas.width, totalH);

            const maxW = canvas.width - opts.padding * 4;

            // Headline
            ctx.font         = `bold ${headlineSize}px ${opts.fontFamily}`;
            ctx.fillStyle    = opts.textColor;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(
                opts.uppercase ? headline.toUpperCase() : headline,
                canvas.width / 2,
                stripY + opts.padding,
                maxW
            );

            // Subline
            ctx.font      = `${sublineSize}px ${opts.fontFamily}`;
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.fillText(subline, canvas.width / 2, stripY + opts.padding + headlineSize + 4, maxW);

            resolve(canvas.toDataURL('image/png'));
        };

        img.onerror = () => reject(new Error(`Görsel yüklenemedi: ${imageUrl}`));
        img.src = imageUrl;
    });
}
