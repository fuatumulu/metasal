/**
 * Facebook Login Handler
 * Ana bot döngüsünden BAĞIMSIZ çalışan hesap doğrulama modülü
 * 
 * Çalıştırma: node src/facebookLoginHandler.js
 * 
 * Bu dosya SRP-uyumlu facebookLogin modülünü kullanır.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sleep } = require('./facebook');
const FacebookLogin = require('./facebookLogin');

const POLL_INTERVAL = 10000; // 10 saniye

/**
 * Ana döngü
 */
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('🔐 Facebook Login Handler Başlatıldı');
    console.log('='.repeat(60));
    console.log('Bu modül ana bot döngüsünden BAĞIMSIZ çalışır.');
    console.log('Ana bot için: node src/index.js');
    console.log('='.repeat(60) + '\n');

    // Token kontrolü
    if (!process.env.VISION_API_TOKEN) {
        console.error('[FB Login] HATA: VISION_API_TOKEN ayarlanmamış!');
        process.exit(1);
    }

    if (!process.env.VISION_FOLDER_ID || process.env.VISION_FOLDER_ID === 'your_folder_id_here') {
        console.error('[FB Login] HATA: VISION_FOLDER_ID ayarlanmamış!');
        process.exit(1);
    }

    // Modülü başlat (proxy cache yükle)
    const initialized = await FacebookLogin.initialize();
    if (!initialized) {
        console.error('[FB Login] HATA: Modül başlatılamadı!');
        process.exit(1);
    }

    // Sonsuz döngü ile hesapları işle
    console.log('[FB Login] Bekleyen hesaplar kontrol ediliyor...\n');

    while (true) {
        try {
            const account = await FacebookLogin.getNextAccount();

            if (!account) {
                console.log('[FB Login] Bekleyen hesap yok. 10 saniye sonra tekrar kontrol edilecek...');
                await sleep(POLL_INTERVAL);
                continue;
            }

            // Hesabı işle
            await FacebookLogin.processAccount(account, 1);

            // Bir sonraki hesaba geçmeden önce kısa bekle
            console.log('\n[FB Login] 5 saniye sonra bir sonraki hesaba geçiliyor...\n');
            await sleep(5000);

        } catch (error) {
            console.error('[FB Login] Ana döngü hatası:', error.message);
            await sleep(POLL_INTERVAL);
        }
    }
}

// Başlat
main().catch(console.error);
