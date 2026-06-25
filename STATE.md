# STATE.md — POD AI Factory canlı durum

## ŞU AN NEREDEYIZ
Üretim bandı kuruluyor. Aşama 1 (galeri ayrımı) BİTTİ. Sıradaki: Aşama 2 (onay kapıları).

## ÇALIŞAN SİSTEM (bugün doğrulandı)
- OneClick pipeline uçtan uca çalışıyor: BG Remove → Mockup → SEO. ~41sn sürüyor, frontend proxy 90sn (frontend/app/api/pipeline/one-click/route.ts, maxDuration=90).
- createDraftListing TEK çağrıda: görsel + 399 varyant + kategori 391 + uyum basıyor (withVariations=true default). Test: listing 4524494525 başarılı.
- Galeri 2 sekme: "Tasarımlar" (çıplak Image, engine≠mockup) + "Listinglerim" (seoData.etsyListingId dolu). gallery.routes.js /recent + /listings.

## ALTYAPI
- Sunucu: Tailscale 100.96.119.102. Backend PM2 'factory-backend' :3001, frontend 'factory-frontend' :3000.
- HER ŞEY SUNUCUDA çalışır. Windows sadece kod yazma (Claude Code). Windows'ta backend/frontend ÇALIŞTIRMA (port çakışması, eski kod bug'ı).
- Git akışı: Windows commit+push → sunucuda `git pull && pm2 restart <servis>`.
- Frontend PRODUCTION build (`next start`). Yeni route.ts eklenince `cd frontend && npm run build` ŞART, yoksa görünmez.

## ETSY ENTEGRASYON (çözülmüş, dokunma)
- Şablon: src/config/yuppion-variation-template.js — 399 product (132 enabled + 267 disabled). property_name (Size=513, Primary color=200), price düz float, readiness_state_id=1421270594788.
- updateListingInventory body: price_on_property=[513,200], diğer 3 on_property=[]. 399'un TAMAMI gerekli (Etsy "all combinations").
- taxonomy_id=391 (Hoodies & Sweatshirts). env ETSY_TAXONOMY_ID=391.
- Uyum: who_made=i_did, production_partner_ids=[5454339] (Prinella), AI ifşa açıklama sonuna idempotent.
- Etsy header: x-api-key = `${ETSY_API_KEY}:${ETSY_API_SECRET}`. dotenvx, 43 env.

## SEO MOTORU (bugün eğitildi)
- seo.service.js + seo-knowledge.service.js: başlık 70-90 karakter (140 DEĞİL), ilk 50'ye keyword, stuffing yok, cross-niche long-tail etiketler, açıklama sorun→çözüm formatı.

## SIRADAKI: ÜRETİM BANDI (5 istasyon, 3 onay kapısı)
1. Tasarım üret (Flux) → ONAY → 2. upscale+BG remove + SEO (paralel, oto, durum bilgisi) → ONAY(SEO) → 4. listing kur (mockup + Yuppion 3-4 sabit görsel + 399 varyant) → ONAY(final) → 5. yayınla → Listinglerim.
- Durum modeli: ImageStatus enum (GENERATED/APPROVED/PROCESSED/COMPLETED/PENDING_APPROVAL) YETERLI, migration gerekmez.
- Aşama 2 sıradaki: onay kapıları + SEO onay ekranı + final listing onay ekranı.
- Yuppion 3-4 sabit görsel (renk/ebat tablosu): henüz eklenmedi, kullanıcı diğer listinglerden alacak.

## AÇIK BUG/İŞLER
- expiresAt / MemoryExpiry: cron her döngüde patlıyor (Unknown argument expiresAt). Ayrı, dokunulmadı.
- factory-backend bellek: 23 saatte 413MB'a çıkıyor (mockup render birikimi?). Restart temizliyor. İzle.
- Yuppion'a "hoodie hangi marka basılıyor?" sorusu açık (Bella $20 vs Gildan $14, marj farkı).

## ÇALIŞMA KURALLARI
- caveman mod: kısa, kod açıklama yok, az token.
- Claude Code'a DAR paket ver (net dosya + net diff), "araştır+uygula" PAHALI (subagent 3.7M token/$1.5).
- Basit işte Sonnet/Haiku, Opus sadece karmaşık mimari.
- Force-push yok, .env yok, migration onaysız yok, * copy yok.
