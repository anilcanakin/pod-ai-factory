# Görsel Yükleme Performansı — Thumbnail Üretimi

## Problem

Dashboard'da 130 istek / 40MB transfer / 39s yükleme süresi. Gallery, Personalization
ve Mockups kart/liste görünümlerinde gerçek boyutlu (4500×5400, 8-12MB) PNG'ler
doğrudan `<img>` src olarak kullanılıyor — tarayıcı ham dosyayı indirip küçültüyor.

## Karar Noktaları (kullanıcı onaylı)

1. **Depolama:** dosya-adı konvansiyonu, DB migration YOK.
2. **Kapsam:** `PhotoTemplate.baseArtworkUrl` VE `MockupTemplate.baseImagePath` ikisi de.
3. **Kapsam:** `generation.service.js` (FAL orijinalleri, Gallery ana kart grid) da dahil.

## Mimari

**Tek merkezi hook noktası:** `src/services/storage.service.js`'in üç upload
fonksiyonu (`uploadToStorage`, `uploadUrlToStorage`, `uploadBufferToStorage`)
zaten repodaki ~15 çağıran dosyanın (composite-engine, mockup-render,
generation.service, personalization.routes, tool.routes, batch/mockup.worker,
image-router...) TEK ortak noktası. Bu üç fonksiyona thumbnail üretimi **iç
yan-etki** olarak eklenir — imza ve dönüş değeri (public URL string) değişmez,
mevcut hiçbir çağıran dosyaya dokunulmaz.

- Thumbnail: Sharp `.resize(400, null, { withoutEnlargement: true }).webp({ quality: 72 })`.
- Konvansiyon: aynı dizin, uzantı `-thumb.webp` ile değişir
  (`personalization/print-files/x_print.png` → `personalization/print-files/x_print-thumb.webp`).
- try/catch ile sarılı — thumbnail üretimi asla ana upload'ı kıramaz, sadece
  `console.warn` loglanır (enhancement, kritik yol değil).
- `uploadRejectedToStorage` (zaten kendi 512×512 JPEG thumbnail'i) dokunulmaz —
  nested thumbnail yok.

**Tek istisna — `mockup-template.routes.js`:** `MockupTemplate.baseImagePath`
(hem PSD hem standart branch) `storage.service.js` üzerinden değil doğrudan
`fs.writeFileSync`/`copyFileSync` ile `assets/mockups/{category}/{templateId}/`
altına yazılıyor. Bu path storage.service.js hook'unun kapsamı DIŞINDA —
her iki branch'te de base PNG diske yazıldıktan hemen sonra açık bir
thumbnail-üretim çağrısı eklenir (aynı Sharp resize+webp mantığı, yerel dosya
yoluna göre).

`PhotoTemplate.baseArtworkUrl` ayrı bir upload route'una sahip değil — route'a
zaten hazır bir URL string olarak geliyor (`POST /api/photo-templates` body'sinde).
Bu URL normal akışta storage.service.js'in ürettiği bir public URL olduğundan
(nurse-template seed script'inde de `uploadToStorage` kullanılmıştı), yukarıdaki
storage.service.js hook'u sayesinde otomatik kapsanır — ayrı kod yolu gerekmez.

## Frontend

`frontend/lib/utils.ts`'e aynı regex konvansiyonuyla `toThumbUrl(url: string): string`
eklenir: uzantıyı `-thumb.webp` ile değiştirir.

Üç hedefte `<img>` src'i `toThumbUrl(resolveUrl(...))` olur, `onError` ile
orijinale (`resolveUrl(...)`) düşer (Personalization'da zaten kurulu pattern):

- **GalleryClient.tsx** — ana kart grid (`img.imageUrl`) + mockup alt-liste (`m.mockupUrl`).
- **PersonalizationClient.tsx** — SİPARİŞLER tablosu thumbnail (`printFileUrl`).
- **MockupsClient.tsx** — mockup kart/liste görünümü.

Lightbox / tam ekran / print-export görünümleri dokunulmuyor — hep orijinal
gösterilir.

Eski kayıtlarda thumb dosyası yok → thumb URL 404 → `onError` otomatik
orijinale düşer. Backfill script'i gerekmez (kullanıcının kendi belirttiği
requirement #4 ile birebir örtüşüyor).

## Regresyon Riski

Düşük — sadece yeni dosyalar (`-thumb.webp`) üretiliyor, mevcut hiçbir alan/
fonksiyon imzası/DB şeması değişmiyor. Thumbnail üretimi try/catch'li,
başarısız olursa ana akış etkilenmez. Backend değişikliği tek dosyada
(`storage.service.js`) + bir route'ta (`mockup-template.routes.js`) toplanıyor.

## Test

Manuel:
1. Yeni bir composite/mockup/generation üret → `assets/uploads/.../*-thumb.webp`
   dosyasının orijinalin yanında oluştuğunu doğrula.
2. Yeni bir MockupTemplate yükle (hem standart hem PSD) → `assets/mockups/.../base-thumb.webp` oluştuğunu doğrula.
3. Gallery/Personalization/Mockups kart görünümlerinde Network tab'da yüklenen
   dosya boyutunun (~400px webp, KB seviyesi) orijinal yerine geldiğini doğrula.
4. Eski (thumb'sız) bir kayıt için kart görünümünün hâlâ orijinali gösterdiğini,
   konsolda hata olmadığını doğrula.
5. Lightbox/tam ekran görünümlerin hâlâ orijinal (tam çözünürlük) gösterdiğini
   doğrula.
