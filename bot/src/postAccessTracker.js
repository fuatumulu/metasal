const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

// Panel'den aktif gönderi erişim track'lerini al
async function getActiveTracks() {
    try {
        const response = await axios.get(`${PANEL_URL}/api/post-access/active`);

        if (response.data.success) {
            return response.data.tracks;
        }

        console.error('[PostAccessTracker] Aktif track\'ler alınamadı:', response.data.message);
        return [];
    } catch (error) {
        console.error('[PostAccessTracker] Aktif track\'ler alınırken hata:', error.message);
        return [];
    }
}

// Erişim sayısını panele gönder
async function updateReachOnPanel(trackId, reach) {
    try {
        const response = await axios.post(`${PANEL_URL}/api/post-access/${trackId}/update-reach`, {
            reach
        });

        if (response.data.success) {
            console.log(`[PostAccessTracker] Erişim güncellendi - Track ID: ${trackId}, Reach: ${reach}`);
        } else {
            console.error('[PostAccessTracker] Erişim güncellenemedi:', response.data.error);
        }
    } catch (error) {
        console.error('[PostAccessTracker] Erişim güncellerken hata:', error.message);
    }
}

// Sayfadan erişim sayısını çek
async function extractReachFromPage(page) {
    try {
        const reach = await page.evaluate(() => {
            // "People reached" veya "Erişilen Kişiler" içeren elementi bul
            const labels = Array.from(document.querySelectorAll('span'));
            const reachLabel = labels.find(el =>
                el.textContent.includes('People reached') ||
                el.textContent.includes('Erişilen Kişiler')
            );

            if (!reachLabel) {
                console.log('Erişim etiketi bulunamadı');
                return 0;
            }

            // Parent container'ı bul
            const container = reachLabel.closest('div');
            if (!container) {
                console.log('Parent container bulunamadı');
                return 0;
            }

            // Container içindeki tüm span'leri tara
            const allSpans = container.querySelectorAll('span');

            for (let span of allSpans) {
                const text = span.textContent.trim();

                // Sadece rakam, virgül ve nokta içeren metni ara
                if (/^[\d,.]+$/.test(text)) {
                    // Virgül ve noktaları temizle, sayıya çevir
                    const number = parseInt(text.replace(/[,.]/g, ''));

                    // Makul bir sayı mı kontrol et (0-10M arası)
                    if (number > 0 && number < 10000000) {
                        console.log('Erişim sayısı bulundu:', number);
                        return number;
                    }
                }
            }

            console.log('Erişim sayısı parse edilemedi');
            return 0;
        });

        return reach;
    } catch (error) {
        console.error('[PostAccessTracker] Erişim sayısı çekilirken hata:', error.message);
        return 0;
    }
}

// Tek bir URL'yi kontrol et (profil zaten açık)
async function checkSingleURL(track, browser, sleep) {
    const { id, url } = track;

    console.log(`[PostAccessTracker] URL kontrol ediliyor - Track ID: ${id}`);

    try {
        // Yeni sayfa aç
        const page = await browser.newPage();

        // URL'ye git
        console.log(`[PostAccessTracker] URL: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Sayfa yüklenmesini bekle
        await sleep(3000);

        // Erişim sayısını çek
        const reach = await extractReachFromPage(page);
        console.log(`[PostAccessTracker] Track ID ${id} - Erişim: ${reach}`);

        // Panele gönder
        await updateReachOnPanel(id, reach);

        // Sayfayı kapat
        await page.close();

        console.log(`[PostAccessTracker] Track ID ${id} tamamlandı`);

    } catch (error) {
        console.error(`[PostAccessTracker] Track ID ${id} kontrol hatası:`, error.message);
    }
}

// Tüm aktif track'leri kontrol et
async function checkAllActiveTracks(startProfile, stopProfile, sleep) {
    console.log('[PostAccessTracker] Aktif track\'ler kontrol ediliyor...');

    const tracks = await getActiveTracks();

    if (tracks.length === 0) {
        console.log('[PostAccessTracker] Kontrol edilecek aktif track yok');
        return;
    }

    console.log(`[PostAccessTracker] ${tracks.length} aktif track bulundu`);

    // Profil bilgilerini al (hepsi aynı profili kullanıyor)
    const { profile } = tracks[0];
    let browser = null;

    try {
        // Profili bir kez başlat
        console.log(`[PostAccessTracker] Profil başlatılıyor: ${profile.name}`);
        browser = await startProfile(profile.folderId, profile.visionId);

        if (!browser) {
            console.error(`[PostAccessTracker] Profil başlatılamadı: ${profile.name}`);
            return;
        }

        // İlk açılışta her şeyin yerine oturması için bekle
        console.log('[PostAccessTracker] Profil hazırlanıyor (20 saniye)...');
        await sleep(20000);

        // Tüm URL'leri sırayla kontrol et
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];

            console.log(`[PostAccessTracker] İşleniyor: ${i + 1}/${tracks.length}`);
            await checkSingleURL(track, browser, sleep);

            // URL'ler arası bekleme (son URL değilse)
            if (i < tracks.length - 1) {
                await sleep(3000);
            }
        }

        console.log('[PostAccessTracker] Tüm track\'ler kontrol edildi');

    } catch (error) {
        console.error('[PostAccessTracker] Genel hata:', error.message);

    } finally {
        // Her durumda profili kapat
        if (browser) {
            try {
                console.log(`[PostAccessTracker] Profil kapatılıyor: ${profile.name}`);
                await stopProfile(profile.visionId);
                console.log('[PostAccessTracker] Profil kapatıldı');
            } catch (stopError) {
                console.error('[PostAccessTracker] Profil kapatılırken hata:', stopError.message);
            }
        }
    }
}

module.exports = {
    checkAllActiveTracks,
    getActiveTracks,
    updateReachOnPanel,
    extractReachFromPage
};
