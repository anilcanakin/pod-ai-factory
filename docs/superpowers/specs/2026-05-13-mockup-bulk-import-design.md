# Mockup Bulk Import & PSD Integration — Design Spec

**Tarih:** 2026-05-13  
**Kapsam:** Creative Fabrica PNG/JPG/PSD mockup toplu aktarımı + gerçekçi kumaş render + ürün rengi değiştirme  
**Yaklaşım:** Mevcut Mockups sayfasına "Toplu İçe Aktar" sekmesi + backend PSD analiz servisi + render pipeline güncellemesi

---

## Problem & Motivasyon

Creative Fabrica'dan indirilen PSD mockupların değeri şuradan geliyor:
1. **Smart object katmanı** — tasarımın tam olarak nereye oturacağını piksel piksel tanımlar
2. **Shadow/highlight overlay katmanı** — kumaş kıvrımlarını ve doku etkisini yaratır
3. **Ürün silüeti** — farklı tişört renklerinde aynı mockupu kullanmaya izin verir

Mevcut sistem bunların hiçbirini PSD'den otomatik çıkaramıyor; brightness-based tahmin yapıyor ve tek renk sabit.

---

## Hedef Çıktı

Bir PSD yüklendiğinde sistem otomatik olarak şunları üretecek:

```
assets/mockups/{category}/{templateId}/
  ├── base.png          → flattened PSD (orijinal renk + texture, preview için)
  ├── gray_base.png     → greyscale ürün silüeti (renk değiştirme için)
  ├── shadow.png        → shadow/highlight overlay katmanı
  └── config.json       → printArea (smart object bounds'dan), defaultColor, layerMap
```

---

## Mimari

```
Frontend: MockupsClient.tsx
  ├── "Toplu İçe Aktar" sekmesi → <BulkImporter />
  │    └── PNG/JPG/PSD yükle → kategori → batch POST
  │
  └── Render bölümü (mevcut)
       └── Renk picker eklendi → productColor → render isteğine eklenir

Backend: POST /api/mockups/templates/bulk-upload  [güncellendi]
  ├── PNG/JPG → detectPrintArea → DB
  └── PSD     → PsdAnalyzer.analyze() → base/gray/shadow PNG'leri → DB

Yeni: src/services/psd-analyzer.service.js
  └── analyze(filePath): { printArea, shadowBuffer, grayBuffer, baseBuffer, defaultColor }

Güncellenen: src/services/mockup-render.service.js
  └── renderMockup() → productColor parametresi eklendi
       grayBasePath varsa: gray_base.png → tint(productColor) → base olarak kullan
       yoksa: mevcut base.jpg/png kullan
```

---

## PSD Analiz Servisi: `psd-analyzer.service.js`

### Layer tanımlama stratejisi

`psd.js` ile layer tree taranır, isim heuristikleri uygulanır:

```js
const SMART_OBJECT_KEYWORDS = ['design', 'artwork', 'place', 'your', 'motif', 'print', 'grafik', 'tasarım'];
const SHADOW_KEYWORDS       = ['shadow', 'highlight', 'texture', 'shading', 'overlay', 'wrinkle', 'fold'];
const COLOR_KEYWORDS        = ['color', 'colour', 'renk', 'fill', 'base', 'shirt', 'tshirt'];
```

### analyze() çıktısı

```js
async function analyze(psdFilePath) {
    const psd = PSD.fromFile(psdFilePath);
    psd.parse();

    const { width, height } = psd.header;
    const layers = flattenLayers(psd.tree().children());

    // 1. Smart object → print area
    const smartLayer = findLayer(layers, SMART_OBJECT_KEYWORDS);
    const printArea = smartLayer
        ? boundsToNormalized(smartLayer.get('bounds'), width, height)
        : await detectPrintArea(psdFilePath); // fallback: brightness tabanlı

    // 2. Tam flatten → base.png
    const baseTmp = tmp();
    await psd.image.saveAsPng(baseTmp);
    const baseBuffer = fs.readFileSync(baseTmp);

    // 3. Greyscale base → gray_base.png (tişört rengi için)
    const grayBuffer = await sharp(baseBuffer)
        .greyscale()
        .png()
        .toBuffer();

    // 4. Shadow katmanı render → shadow.png
    //    psd.js layer export ile shadow katmanını izole et
    //    Eğer bulunamazsa: null (render engine shadow kullanmaz)
    const shadowLayer = findLayer(layers, SHADOW_KEYWORDS);
    const shadowBuffer = shadowLayer
        ? await renderLayerToPng(shadowLayer, width, height)
        : null;

    // 5. Default color → ilk color fill katmanından al
    const colorLayer = findLayer(layers, COLOR_KEYWORDS);
    const defaultColor = colorLayer
        ? extractFillColor(colorLayer)
        : '#FFFFFF';

    return { printArea, baseBuffer, grayBuffer, shadowBuffer, defaultColor };
}
```

### Shadow katmanı render notu

`psd.js` tek bir katmanı izole render etmek için doğrudan API sunmuyor. `renderLayerToPng()` implementasyonu şu yolu izleyecek:
- Layer'ın pixel buffer'ını `layer.image.toBuffer()` ile al
- Layer `width × height` boyutunda boş bir canvas oluştur, layer'ı `(left, top)` koordinatına yerleştir
- Sharp ile PNG'ye çevir
Eğer bu yaklaşım belirli PSD yapıları için başarısız olursa, shadow layer çıkarma atlanır (fallback: shadow yok).

### Fallback davranışı

Her adım bağımsız — bir katman bulunamazsa sistem durmuyor:

| Bulunamazsa | Davranış |
|-------------|----------|
| Smart object | `detectPrintArea()` ile brightness tahmini |
| Shadow katmanı | **Preset shadow** — `assets/presets/shadows/{category}_shadow.png` uygulanır |
| Color layer | `defaultColor = '#FFFFFF'` |

### Shadow fallback: Preset + isteğe bağlı AI

**Preset shadow'lar** (`assets/presets/shadows/`):
```
tshirt_shadow.png
hoodie_shadow.png
sweatshirt_shadow.png
mug_shadow.png
sticker_shadow.png
phone_case_shadow.png
```
Kategori başına elle hazırlanmış, neutral wrinkle/fold etkisi veren soft-overlay PNG'ler.
PSD'den shadow çıkarılamazsa → `template.shadowImagePath = preset/{category}_shadow.png`

**"AI Shadow Üret" butonu** (MockupsClient.tsx — template detay kartında):
- Sadece `template.shadowImagePath === preset` ise (AI üretilmiş değilse) görünür
- Tıklanınca `POST /api/mockups/templates/:id/generate-shadow` çağrılır
- Backend: FAL.ai depth estimation modeli → base görüntüden depth map → shadow PNG üretir
- Üretilen shadow `shadowImagePath`'e kaydedilir, preset'in yerini alır
- Maliyet: ~1 FAL çağrısı/şablon, isteğe bağlı

---

## Render Pipeline Güncellemesi: `mockup-render.service.js`

### Yeni parametre: `productColor`

```js
renderMockup({ ..., productColor: '#FF5733' })
```

### Güncellenen akış

```
1. baseImagePath mi, grayBasePath mi?
   └── grayBasePath varsa (PSD'den gelen şablonlar):
         gray_base.png → sharp().tint({ r, g, b }) → renkli base buffer
   └── baseImagePath varsa (mevcut PNG şablonlar):
         base.jpg / base.png direkt yüklenir

2. Mevcut adımlar devam eder:
   print area → design composite → shadow overlay → output
```

### Sharp tint uygulaması

```js
if (template.grayBasePath && productColor) {
    const { r, g, b } = hexToRgb(productColor);
    baseBuffer = await sharp(grayBasePath)
        .tint({ r, g, b })
        .toBuffer();
} else {
    baseBuffer = basePath; // mevcut akış
}
```

### configJson yeni alanlar

```json
{
  "printArea": { ... },
  "transform": { ... },
  "render": { ... },
  "meta": {
    "grayBasePath": "assets/mockups/tshirt/{id}/gray_base.png",
    "defaultColor": "#FFFFFF",
    "isPsdDerived": true,
    "layerMap": {
      "smartObject": "Your Design Here",
      "shadow": "Shadow & Highlights",
      "colorBase": "Color"
    }
  }
}
```

---

## DB Değişikliği

Yok. `grayBasePath` ve `defaultColor` `configJson.meta` içinde saklanıyor — mevcut `MockupTemplate` modeli yeterli.

---

## Frontend Değişiklikleri

### 1. `BulkImporter.tsx` (yeni dosya)

**Dosya tipi desteği:** `image/*,.psd`  
**Kategori:** tek seçim, tüm batch'e uygulanır  
**Batching:** 20 dosya/istek, sırayla  
**Per-dosya durum:** bekliyor → işleniyor → ✓ / ✗ (hata mesajıyla)  
**Özet:** "47/50 yüklendi, 3 hatalı"

Dosya badge renkleri: PSD=mor, PNG=yeşil, JPG=mavi

### 2. `MockupsClient.tsx` güncellemeleri

**Yeni sekme:** "Toplu İçe Aktar" → `<BulkImporter />`

**Render bölümüne renk picker eklenir:**
- Sadece `configJson.meta.isPsdDerived === true` olan şablonlarda görünür
- Yaygın tişört renkleri için 8-10 hazır renk swatchi: beyaz, siyah, lacivert, gri, kırmızı, yeşil vb.
- Özel hex renk input'u da var
- Seçilen renk render isteğine `productColor` olarak eklenir
- Seçili renk şablona özel `localStorage`'da hatırlanır (oturum boyunca)

---

## `bulk-upload` Route Güncellemesi

```
fileFilter: image/* + .psd
dosya limiti: 100
PSD akışı:
  PsdAnalyzer.analyze(filePath)
  → base/gray/shadow dosyaları assets/mockups/{category}/{id}/ altına yazar
  → configJson meta alanlarını doldurur
  → MockupTemplate DB kaydı oluşturur (shadowImagePath dahil)
```

---

## Yeni Route: `POST /api/mockups/templates/:id/generate-shadow`

```
1. Template'i DB'den yükle (workspaceId kontrolü)
2. base.png'i FAL.ai depth estimation modeline gönder
   → depth map PNG döner (aydınlık = yakın, karanlık = uzak)
3. Depth map'i invert et + blur uygula → shadow overlay etkisi
4. assets/mockups/{category}/{id}/shadow_ai.png olarak kaydet
5. template.shadowImagePath güncelle → 'assets/mockups/{category}/{id}/shadow_ai.png'
6. configJson.meta.shadowSource = 'ai' olarak işaretle
```

FAL.ai model: `fal-ai/imageutils/depth` veya `fal-ai/monocular-depth-estimation`

## Kapsam Dışı

- Perspective warp / mesh warp (displacement map ile tasarımı eğme) — gelecek
- PSD içindeki birden fazla smart object (multi-area) otomatik tespiti — gelecek
- Batch sırasında individual dosya iptali
- Klasör yükleme (`webkitdirectory`)

---

## Test Planı

1. Creative Fabrica PSD yükle → `config.json`'da `printArea` smart object bounds'a uyuyor mu?
2. Aynı şablonda 3 farklı renk seç → her render farklı renkte tişört üretiyor mu?
3. Shadow katmanı olan PSD → render'da kumaş texture görünüyor mu?
4. Shadow katmanı olmayan PSD → render çalışıyor, shadow yok ama hata yok
5. 25 PNG + 5 PSD karışık batch → tüm PSD'ler `isPsdDerived: true`, tümü başarılı
6. Bozuk PSD → sadece o dosya error, batch devam ediyor
7. PNG şablonlarda renk picker görünmüyor (sadece PSD şablonlarda)
8. Shadow katmanı olmayan PSD → preset shadow otomatik atanmış
9. "AI Shadow Üret" butonu → shadow_ai.png oluşuyor, preset'in yerini alıyor
10. Preset shadow ile render vs AI shadow ile render görsel kalite farkı gözlemlenir
