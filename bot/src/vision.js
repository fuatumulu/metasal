const axios = require('axios');
const puppeteer = require('puppeteer-core');

// Local API URL (Varsayılan: http://127.0.0.1:3030)
const VISION_LOCAL_API = process.env.VISION_LOCAL_API || 'http://127.0.0.1:3030';
// Cloud API URL
const VISION_CLOUD_API = 'https://v1.empr.cloud/api/v1';
// Cloud API için Token
const VISION_API_TOKEN = process.env.VISION_API_TOKEN;

/**
 * Kloud API üzerinden tüm klasörleri ve içindeki profilleri listele
 */
async function listProfiles() {
    try {
        if (!VISION_API_TOKEN) {
            console.error('VISION_API_TOKEN ayarlanmamış, cloud senkronizasyon yapılamaz.');
            // Token yoksa yerel API'den (sadece çalışanları) dönmeyi deneyebiliriz veya hata verebiliriz.
            // Ama dökümantasyona göre tam liste için klasörler üzerinden gitmek lazım.
            return [];
        }

        const headers = { 'X-Token': VISION_API_TOKEN };
        const filterFolderId = process.env.VISION_FOLDER_ID;

        // Eğer bir klasör ID'si verilmişse, doğrudan o klasörün profillerini çek
        if (filterFolderId && filterFolderId !== 'your_folder_id_here' && filterFolderId !== 'optional_folder_guid_here') {
            console.log(`Doğrudan "${filterFolderId}" klasöründeki profiller çekiliyor...`);
            try {
                const profilesRes = await axios.get(`${VISION_CLOUD_API}/folders/${filterFolderId}/profiles`, { headers });
                const items = profilesRes.data.data?.items || [];

                return items.map(p => ({
                    visionId: p.id,
                    folderId: p.folder_id,
                    name: p.profile_name,
                    status: p.running ? 'active' : 'disabled'
                }));
            } catch (err) {
                console.error(`"${filterFolderId}" klasörü profilleri alınamadı:`, err.message);
                return [];
            }
        }

        // Eğer klasör ID'si yoksa tüm klasörleri listele (Fallback)
        // 1. Klasörleri al
        const foldersRes = await axios.get(`${VISION_CLOUD_API}/folders`, { headers });
        const folders = foldersRes.data.data || [];

        console.log('\n--- Vision Klasör Listesi ---');
        folders.forEach(f => console.log(`İsim: ${f.folder_name} | ID: ${f.id}`));
        console.log('-----------------------------\n');

        let allProfiles = [];

        // 2. Her klasör için profilleri al
        for (const folder of folders) {
            try {
                const profilesRes = await axios.get(`${VISION_CLOUD_API}/folders/${folder.id}/profiles`, { headers });
                const items = profilesRes.data.data?.items || [];

                const formatted = items.map(p => ({
                    visionId: p.id,
                    folderId: p.folder_id,
                    name: p.profile_name,
                    status: p.running ? 'active' : 'disabled'
                }));

                allProfiles = allProfiles.concat(formatted);
            } catch (err) {
                console.error(`Klasör ${folder.id} profilleri alınamadı:`, err.message);
            }
        }

        return allProfiles;
    } catch (error) {
        console.error('Profil listesi alma hatası:', error.message);
        return [];
    }
}

/**
 * Profili başlat ve browser bağlantısı al
 * URL: http://127.0.0.1:3030/start/{folderId}/{profileId}
 */
async function startProfile(folderId, profileId) {
    try {
        const response = await axios.get(`${VISION_LOCAL_API}/start/${folderId}/${profileId}`, {
            headers: { 'X-Token': VISION_API_TOKEN }
        });

        const { port } = response.data;

        if (!port) {
            console.error('Port bilgisi alınamadı');
            return null;
        }

        console.log(`Profil başlatıldı, port: ${port}. Bağlantı kuruluyor...`);

        // Tarayıcının hazır olması için kısa bir bekleme ve retry mekanizması
        let browser = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                // Tarayıcı penceresinin açılması ve portun dinlemeye başlaması için bekle
                const delay = 1000 + (attempts * 1000);
                console.log(`Deneme ${attempts}/${maxAttempts}: ${delay}ms bekleniyor...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                // Önce 127.0.0.1 dene, başarısız olursa localhost dene
                const targetHost = attempts % 2 === 0 ? 'localhost' : '127.0.0.1';
                console.log(`Bağlanılıyor: http://${targetHost}:${port}...`);

                browser = await puppeteer.connect({
                    browserURL: `http://${targetHost}:${port}`,
                    defaultViewport: null
                });

                if (browser) {
                    console.log('Bağlantı başarılı!');

                    // Tarayıcı bildirim izinlerini otomatik engelle (Native bildirim pencerelerini önlemek için)
                    try {
                        const context = browser.defaultBrowserContext();
                        await context.overridePermissions('https://www.facebook.com', ['notifications']);
                        console.log('Facebook bildirim izinleri devre dışı bırakıldı.');
                    } catch (e) {
                        console.log('İzinler override edilemedi (belki anonim pencere değil?):', e.message);
                    }

                    break;
                }
            } catch (err) {
                console.log(`Bağlantı denemesi ${attempts}/${maxAttempts} başarısız: ${err.message}`);
                if (attempts >= maxAttempts) throw err;
            }
        }

        return browser;
    } catch (error) {
        console.error('Profil başlatma hatası:', error.message);
        return null;
    }
}

/**
 * Profili durdur
 * URL: http://127.0.0.1:3030/stop/{folderId}/{profileId}
 */
async function stopProfile(folderId, profileId) {
    try {
        await axios.get(`${VISION_LOCAL_API}/stop/${folderId}/${profileId}`, {
            headers: { 'X-Token': VISION_API_TOKEN }
        });
        console.log(`Profil ${profileId} durduruldu`);
    } catch (error) {
        console.error('Profil durdurma hatası:', error.message);
    }
}

module.exports = {
    listProfiles,
    startProfile,
    stopProfile
};
