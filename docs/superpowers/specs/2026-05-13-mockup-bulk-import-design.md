# Mockup Bulk Import — Design Spec

**Tarih:** 2026-05-13  
**Kapsam:** Creative Fabrica'dan indirilen PNG/JPG/PSD mockupları toplu sisteme aktarma  
**Yaklaşım:** Mevcut Mockups sayfasına "Toplu İçe Aktar" sekmesi + backend PSD desteği

---

## Bağlam

Creative Fabrica'dan 100+ mockup (flat PNG/JPG + PSD) indirilmektedir. Mevcut sistem tek-dosya template yüklemesini destekliyor; backend'de `bulk-upload` route'u var ama sadece PNG/JPG kabul ediyor ve 20 dosya limiti var. PSD desteği hiç yok.

---

## Mimari

```
Frontend: MockupsClient.tsx
  └─ "Toplu İçe Aktar" sekmesi → <BulkImporter />
       ├─ Çoklu dosya seçimi (PNG/JPG/PSD)
       ├─ Kategori seçici (tek kategori tüm batch için)
       ├─ Frontend batching: 20'şerlik gruplar → sırayla POST
       └─ Dosya başına durum: bekliyor → işleniyor → ✓/✗

Backend: POST /api/mockups/templates/bulk-upload  [güncellendi]
  ├─ PNG/JPG → detectPrintArea → MockupTemplate DB kaydı
  └─ PSD     → psdFlatten() → PNG buffer → detectPrintArea → DB kaydı

Yeni servis: src/services/psd.service.js
  └─ psdFlatten(filePath): Promise<Buffer>
```

---

## Backend Değişiklikleri

### 1. Yeni: `src/services/psd.service.js`

```js
const PSD = require('psd');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function psdFlatten(filePath) {
    const psd = PSD.fromFile(filePath);
    psd.parse();
    // saveAsPng yazar ve tamamlandığında resolve eder
    const tmpPath = path.join(os.tmpdir(), `psd-${Date.now()}.png`);
    await psd.image.saveAsPng(tmpPath);
    const buffer = fs.readFileSync(tmpPath);
    fs.unlinkSync(tmpPath);
    return buffer; // PNG Buffer
}

module.exports = { psdFlatten };
```

### 2. Güncelleme: `bulk-upload` route (`mockup-template.routes.js`)

**Değişen noktalar:**

| Satır | Öncesi | Sonrası |
|-------|--------|---------|
| `fileFilter` | sadece `image/*` | `image/*` + `.psd` uzantısı |
| `maxCount` | 20 | 100 |
| Dosya işleme döngüsü | sadece PNG/JPG | `.psd` uzantısı → `psdFlatten()` → geçici PNG → detectPrintArea |

**PSD akışı:**
```js
if (path.extname(file.originalname).toLowerCase() === '.psd') {
    const pngBuffer = await psdFlatten(file.path);
    const tmpPng = path.join(os.tmpdir(), `psd-${Date.now()}.png`);
    fs.writeFileSync(tmpPng, pngBuffer);
    // tmpPng'yi base image olarak kullan
    // detectPrintArea(tmpPng) ile print area tespit et
    // finalDir'e kopyala, DB kaydı oluştur
    fs.unlinkSync(tmpPng); // temizle
}
```

### 3. `package.json`
```
npm install psd
```

---

## Frontend Değişiklikleri

### 1. Yeni dosya: `frontend/app/dashboard/mockups/BulkImporter.tsx`

**Props:**
```ts
interface BulkImporterProps {
  onComplete: (count: number) => void;
}
```

**State:**
```ts
type FileEntry = {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  templateId?: string;
};

const [files, setFiles] = useState<FileEntry[]>([]);
const [category, setCategory] = useState('tshirt');
const [isRunning, setIsRunning] = useState(false);
const [progress, setProgress] = useState({ done: 0, total: 0 });
```

**Kullanıcı akışı:**
1. Kategori seç (dropdown — tshirt/hoodie/sweatshirt/mug/sticker/phone_case)
2. Dosyaları sürükle veya "Dosya Seç" (`accept="image/*,.psd"` + `multiple`)
3. Dosya listesi görünür: isim, boyut, tip badge (PSD=mor/PNG=yeşil/JPG=mavi), durum
4. "Yüklemeyi Başlat" → batch işleme başlar
5. Her dosya güncel durumu gösterir
6. Tüm batch bitince: "X/Y yüklendi" özet ve `onComplete(successCount)` callback

**Batching stratejisi:**
```
files → 20'şerlik chunks → sırayla POST /api/mockups/templates/bulk-upload
```
Her chunk için tek bir `FormData` (20 dosya, aynı kategori). Bir chunk tamamlandıktan sonra sonraki chunk başlar.

**Dosya tipi badge'leri:**
- `.psd` → `bg-purple-600/20 text-purple-400 border-purple-500/30`
- `.png` → `bg-green-600/20 text-green-400 border-green-500/30`
- `.jpg/.jpeg` → `bg-blue-600/20 text-blue-400 border-blue-500/30`

### 2. Güncelleme: `MockupsClient.tsx`

- Mevcut sekme yapısına "Toplu İçe Aktar" sekmesi eklenir
- Sekme içeriğinde `<BulkImporter onComplete={handleBulkComplete} />` render edilir
- `handleBulkComplete` → template listesini yeniler (mevcut `refetchTemplates` fonksiyonu)

---

## Hata Yönetimi

| Durum | Davranış |
|-------|----------|
| PSD parse hatası | O dosya `error` durumuna geçer, batch devam eder |
| Ağ hatası (chunk) | Chunk içindeki tüm dosyalar `error` olur, sonraki chunk devam eder |
| Boyut aşımı (>20MB) | `fileFilter` reddeder, frontend'de `error` badge |
| Geçersiz uzantı | Frontend'de filtrelenir, listeye eklenmez |

---

## Kapsam Dışı

- Dosya adından otomatik kategori tespiti (gelecekte eklenebilir)
- PSD içindeki smart object bounds'u kullanarak hassas print area tespiti (mevcut auto-detect yeterli)
- Batch sırasında individual dosya iptali
- Klasör yükleme (`webkitdirectory`) — standart multi-file seçimi yeterli

---

## Test Planı

1. 5 PNG + 2 PSD + 1 JPG karışık batch yükle → tümü başarılı
2. Bozuk PSD yükle → sadece o dosya `error` badge, geri kalanlar başarılı
3. 25 dosya yükle → 20+5 olarak iki batch gönderildiği logda görülür
4. Yükleme sonrası MockupsClient template listesinde yeni templatelar görünür
5. Yüklenen bir PSD template'iyle normal render çalışır
