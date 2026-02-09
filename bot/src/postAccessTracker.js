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

// Sayfadan erişim sayısını çek (placeholder - kullanıcı selector verecek)
async function extractReachFromPage(page) {
    try {
        // PLACEHOLDER: Kullanıcı ileride hangi HTML selector'ünü kullanacağını söyleyecek
        // Şimdilik basit bir örnek:
        // const reach = await page.evaluate(() => {
        //     const element = document.querySelector('.reach-count-selector');
        //     return element ? parseInt(element.textContent.replace(/\D/g, '')) : 0;
        // });

        // Geçici olarak: Sayfanın body'sinde sayı ara
        const reach = await page.evaluate(() => {
            // Bu kısım kullanıcı tarafından özelleştirilecek
            const bodyText = document.body.innerText;
            const numbers = bodyText.match(/\d{1,3}(,\d{3})*/g);

            if (numbers && numbers.length > 0) {
                // İlk bulunan büyük sayıyı al (geçici)
                return parseInt(numbers[0].replace(/,/g, ''));
            }

            return 0;
        });

        return reach;
    } catch (error) {
        console.error('[PostAccessTracker] Erişim sayısı çekilirken hata:', error.message);
        return 0;
    }
}

// Bir gönderiyi kontrol et
async function checkPostAccess(track, startProfile, stopProfile, sleep) {
    const { id, url, profile } = track;

    console.log(`[PostAccessTracker] Kontrol başlıyor - Track ID: ${id}, URL: ${url}`);

    let browser = null;

    try {
        // Vision profilini başlat (admin yetkili profil)
        console.log(`[PostAccessTracker] Profil başlatılıyor: ${profile.name}`);
        browser = await startProfile(profile.folderId, profile.visionId);

        if (!browser) {
            console.error(`[PostAccessTracker] Profil başlatılamadı: ${profile.name}`);
            return;
        }

        // Yeni sayfa aç
        const page = await browser.newPage();

        // URL'ye git
        console.log(`[PostAccessTracker] URL'ye gidiliyor: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Sayfa yüklenmesini bekle
        await sleep(3000);

        // Erişim sayısını çek
        const reach = await extractReachFromPage(page);
        console.log(`[PostAccessTracker] Erişim sayısı: ${reach}`);

        // Panele gönder
        await updateReachOnPanel(id, reach);

        // Sayfayı kapat
        await page.close();

        // Profili durdur
        console.log(`[PostAccessTracker] Profil durduruluyor: ${profile.name}`);
        await stopProfile(profile.folderId, profile.visionId);

        console.log(`[PostAccessTracker] Kontrol tamamlandı - Track ID: ${id}`);

    } catch (error) {
        console.error(`[PostAccessTracker] Track ID ${id} kontrol hatası:`, error.message);

        // Hata durumunda profili durdur
        if (browser) {
            try {
                await stopProfile(profile.folderId, profile.visionId);
            } catch (stopError) {
                console.error('[PostAccessTracker] Profil durdurulurken hata:', stopError.message);
            }
        }
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

    for (const track of tracks) {
        await checkPostAccess(track, startProfile, stopProfile, sleep);

        // Track'ler arasında bekleme (rate limiting)
        await sleep(5000);
    }

    console.log('[PostAccessTracker] Tüm track\'ler kontrol edildi');
}

module.exports = {
    checkAllActiveTracks,
    getActiveTracks,
    updateReachOnPanel,
    extractReachFromPage
};
