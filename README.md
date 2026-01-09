# MetaSal

Facebook hesap yönetimi ve otomasyon projesi.

## Proje Yapısı

```
metasal/
├── panel/          # Web yönetim paneli
│   ├── src/        # Express sunucu
│   ├── views/      # EJS şablonları
│   ├── public/     # Statik dosyalar
│   └── prisma/     # Veritabanı şeması
│
└── bot/            # Masaüstü otomasyon botu
    └── src/        # Bot kaynak kodları
```

## Başlangıç

### Panel
```bash
cd panel
npm install
cp .env.example .env
# .env dosyasını düzenle
npm run db:push
npm start
```

### Bot
```bash
cd bot
npm install
cp .env.example .env
# .env dosyasını düzenle
npm start
```

## Özellikler

- ✅ Facebook hesap yönetimi
- ✅ Sayfa/Grup beğenme
- ✅ Gönderi beğenme, yorum yapma, paylaşma
- ✅ Vision Antidetect Browser entegrasyonu
- ✅ Easypanel/Docker deploy desteği
