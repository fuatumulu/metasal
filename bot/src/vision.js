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

        // 1. Klasörleri al
        const foldersRes = await axios.get(`${VISION_CLOUD_API}/folders`, { headers });
        const folders = foldersRes.data.data || [];

        console.log('\n--- Vision Klasör Listesi ---');
        folders.forEach(f => console.log(`İsim: ${f.folder_name} | ID: ${f.id}`));
        console.log('-----------------------------\n');

        const filterFolderId = process.env.VISION_FOLDER_ID;
        if (filterFolderId) {
            console.log(`Filtre uygulanıyor: Sadece "${filterFolderId}" klasörü çekilecek.`);
        }

        let allProfiles = [];

        // 2. Her klasör için profilleri al
        for (const folder of folders) {
            // Eğer filtre varsa ve bu klasör o değilse atla
            if (filterFolderId && folder.id !== filterFolderId) continue;

            try {
                const profilesRes = await axios.get(`${VISION_CLOUD_API}/folders/${folder.id}/profiles`, { headers });
                const items = profilesRes.data.data?.items || [];

                // Profil verilerini bizim modelimize uygun hale getir
                const formatted = items.map(p => ({
                    visionId: p.id,
                    folderId: p.folder_id,
                    name: p.profile_name,
                    status: p.running ? 'active' : 'disabled' // Vision'da çalışma durumu
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

        const browser = await puppeteer.connect({
            browserURL: `http://127.0.0.1:${port}`,
            defaultViewport: null
        });

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
