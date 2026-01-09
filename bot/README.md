# MetaSal Bot - Facebook Otomasyon Botu

Vision Antidetect Browser API kullanarak Facebook otomasyonu yapan masaüstü botu.

## Gereksinimler

- Node.js 18+
- Vision Antidetect Browser (yerel makinede çalışıyor olmalı)
- Panel (çalışır durumda olmalı)

## Kurulum

### 1. Bağımlılıkları Yükle
```bash
npm install
```

### 2. Environment Ayarları
```bash
cp .env.example .env
```

`.env` dosyasını düzenleyin:
```env
PANEL_URL=http://localhost:3000
VISION_API_URL=http://localhost:35599
TASK_CHECK_INTERVAL=10000
ACTION_DELAY=3000
```

### 3. Botu Başlat
```bash
npm start
```

## Çalışma Mantığı

1. Bot, panelden bekleyen görevleri çeker
2. Her görev için Vision'da profil oluşturur/kullanır
3. Facebook'a giriş yapar (login görevi)
4. Sayfa/grup beğenir (like_target görevi)
5. Gönderi beğenir/yorum yapar/paylaşır (post_action görevi)
6. Sonucu panele bildirir

## Görev Tipleri

| Tip | Açıklama |
|-----|----------|
| `login` | Facebook'a giriş yap |
| `like_target` | Sayfa veya grubu beğen/takip et |
| `post_action` | Gönderiyi beğen/yorum yap/paylaş |

## Vision API

Bot, Vision Antidetect Browser'ın HTTP API'sini kullanır:

- `GET /api/profile/list` - Profilleri listele
- `POST /api/profile/create` - Yeni profil oluştur
- `GET /api/profile/start/:id` - Profili başlat
- `GET /api/profile/stop/:id` - Profili durdur

## Önemli Notlar

- Vision Antidetect Browser yerel makinede çalışıyor olmalı
- Her hesap için ayrı bir Vision profili oluşturulur
- Facebook güvenlik önlemlerine karşı dikkatli olun
- Bot görevleri sırayla işler (paralel değil)
