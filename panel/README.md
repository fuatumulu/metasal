# MetaSal - Facebook Hesap Yönetim Paneli

Facebook hesaplarını yönetmek, sayfa/grup beğenmek ve gönderi etkileşimleri için emir gönderebilen bir web paneli.

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
DATABASE_URL="mysql://user:password@localhost:3306/metasal"
SESSION_SECRET="your-super-secret-key"
PORT=3000
```

### 3. Veritabanını Oluştur
```bash
npm run db:push
```

### 4. Paneli Başlat
```bash
npm start
```

Panel `http://localhost:3000` adresinde çalışacaktır.

## İlk Kurulum

1. Panele ilk girişte admin kullanıcı adı ve şifre belirlenir
2. Giriş yapıldıktan sonra Dashboard'a yönlendirilir
3. Hesaplar, Hedefler ve Gönderiler menülerinden işlemler yapılabilir

## API Endpoints

Bot ile iletişim için kullanılan API endpoint'leri:

| Metod | Endpoint | Açıklama |
|-------|----------|----------|
| GET | `/api/tasks/pending` | Bekleyen görevi al |
| POST | `/api/tasks/:id/result` | Görev sonucunu bildir |
| GET | `/api/accounts` | Hesap listesi |
| POST | `/api/accounts/:id/status` | Hesap durumu güncelle |

## Docker ile Deploy

```bash
docker build -t metasal-panel .
docker run -p 3000:3000 --env-file .env metasal-panel
```

## Easypanel Deploy

1. GitHub'a push'layın
2. Easypanel'de yeni bir servis oluşturun
3. GitHub repo'sunu bağlayın
4. Environment değişkenlerini ayarlayın
5. Deploy butonuna tıklayın
