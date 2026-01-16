---
name: vision-api
description: Browser.Vision resmi API dokümantasyonuna dayanarak Vision uygulamasının REST ve Local API’lerini doğru ve güvenli şekilde kullanmak için hazırlanmış skill.
---

# Vision API Skill

Bu skill, **Browser.Vision** resmi dokümantasyonunda tanımlanan API’leri temel alarak Vision uygulaması ile programatik entegrasyon yapılmasını sağlar.

Amaç:
- Folder, profile, proxy, fingerprint, status, tag ve cookie yönetimi
- Profilleri local servis üzerinden başlatma ve durdurma
- Instant Profile (geçici profil) akışlarını kullanma
- Çalışan profile Chrome DevTools Protocol (CDP) üzerinden otomasyon bağlama

Bu skill **uydurma endpoint, parametre veya davranış içermez**.  
Sadece dokümantasyonda açıkça belirtilmiş yöntemleri kapsar.

---

## Authentication

Tüm REST ve Local API çağrılarında aşağıdaki header zorunludur:

- `X-Token`: Vision uygulamasının **Settings** bölümünden alınır

Teamwork modu kullanılıyorsa ek olarak:

- `X-Team-Token`

Token bilgileri gizli tutulmalı ve client tarafına sızdırılmamalıdır.

---

## API Alanları

Vision iki farklı API alanı kullanır.

### Cloud REST API

Base URL:

https://v1.empr.cloud/api/v1/

Bu API şu kaynakları yönetir:
- Folder
- Profile
- Proxy
- Fingerprint
- Status
- Tag
- Cookie

---

### Local Runtime API

Base URL:

http://127.0.0.1:3030/

Bu API şu işlemler için kullanılır:
- Profil başlatma ve durdurma
- Instant Profile çalıştırma
- Çalışan profilleri listeleme
- CDP bağlantısı

Local API yalnızca Vision uygulamasının çalıştığı makineden çağrılabilir.

---

## Folder API

### Get folders

GET /folders

### Create folder

POST /folders

### Update folder

PATCH /folders/{folderId}

### Delete folder

DELETE /folders/{folderId}

---

## Profile API

### Get profiles

GET /folders/{folderId}/profiles

Opsiyonel query parametreleri:
- name
- pn (page number)
- ps (page size)

### Get profile

GET /folders/{folderId}/profiles/{profileId}

### Create profile

POST /folders/{folderId}/profiles

Zorunlu alanlar:
- profile_name
- platform (windows | macos | linux)
- browser
- fingerprint

Opsiyonel alanlar:
- profile_notes
- profile_tags
- proxy_id
- profile_status

### Update profile

PATCH /folders/{folderId}/profiles/{profileId}

### Delete profile

DELETE /folders/{folderId}/profiles/{profileId}

---

## Fingerprint API

Profil oluştururken fingerprint zorunludur.

### Get latest fingerprint

GET /fingerprints/{platform}/latest

### Get fingerprint by version

GET /fingerprints/{platform}/{version}

Fingerprint içinde yer alan önemli alanlar:
- webrtc_pref
- webgl_pref
- canvas_pref
- client_rects
- ports_protection
- audio_input
- audio_output
- video_input

Fingerprint manuel olarak üretilmez, API üzerinden alınır.

---

## Cookie API

### Import cookies

POST /cookies/import/{folderId}/{profileId}

### Export cookies

GET /cookies/{folderId}/{profileId}

---

## Proxy API

### Get proxies

GET /folders/{folderId}/proxies

### Create proxy

POST /folders/{folderId}/proxies

### Update proxy

PUT /folders/{folderId}/proxies/{proxyId}

### Delete proxies (bulk)

DELETE /folders/{folderId}/proxies

---

## Status API

### Get statuses

GET /folders/{folderId}/statuses

### Create statuses

POST /folders/{folderId}/statuses

### Update status

PUT /folders/{folderId}/statuses/{statusId}

### Delete statuses

DELETE /folders/{folderId}/statuses

---

## Tag API

### Get tags

GET /folders/{folderId}/tags

### Create tags

POST /folders/{folderId}/tags

### Update tag

PUT /folders/{folderId}/tags/{tagId}

### Delete tags

DELETE /folders/{folderId}/tags

---

## Local Profile Control

### List running profiles

GET /list

### Start profile

GET  /start/{folderId}/{profileId}
POST /start/{folderId}/{profileId}

Opsiyonel body:
- args (browser arguments)
- proxy (geçici proxy, profile kaydedilmez)

### Stop profile

GET /stop/{folderId}/{profileId}

---

## Instant Profiles

Instant profile kalıcı olarak kaydedilmez.

### Start instant profile

GET  /start/instant
POST /start/instant

POST body ile gönderilebilen alanlar:
- name
- os
- version
- smart
- fingerprint
- proxy
- extensions

### Stop instant profile

GET /stop/instant/{profileId}

Profil durdurulduğunda tamamen silinir.

---

## CDP (Automation Connection)

Çalışan profile Chrome DevTools Protocol üzerinden bağlanılır.

### Puppeteer

puppeteer.connect({
  browserURL: http://127.0.0.1:PORT
})

### Playwright

chromium.connectOverCDP(http://127.0.0.1:PORT)

PORT değeri start çağrısında `--remote-debugging-port` argümanı ile belirlenir.

---

## When to use this skill

- Vision API ile profil, proxy ve fingerprint yönetimi yapılacaksa
- Profiller otomasyon için programatik olarak başlatılacaksa
- Puppeteer veya Playwright ile Vision entegrasyonu gerekiyorsa
- Instant Profile akışı kullanılacaksa

---

## Guardrails

- Dokümantasyonda olmayan endpoint kullanılmaz
- Fingerprint elle uydurulmaz
- Local API sadece Vision’ın çalıştığı makineden çağrılır
- Profil lifecycle yönetimi ile iş mantığı ayrıdır
