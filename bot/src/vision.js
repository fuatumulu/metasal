const axios = require('axios');
const puppeteer = require('puppeteer-core');

// Local API URL (Varsayılan: http://127.0.0.1:3030)
const VISION_LOCAL_API = process.env.VISION_LOCAL_API || 'http://127.0.0.1:3030';
// Cloud API URL
const VISION_CLOUD_API = 'https://v1.empr.cloud/api/v1';
// Cloud API için Token
const VISION_API_TOKEN = process.env.VISION_API_TOKEN;

// Proxy cache (proxy_id -> proxy bilgisi)
let proxyCache = new Map();

/**
 * Hassas verileri loglardan temizleyen yardımcı
 */
function maskSensitiveData(data) {
    if (!data) return data;
    const masked = JSON.parse(JSON.stringify(data));
    // Header'lardaki tokenları temizle
    if (masked.headers) {
        if (masked.headers['X-Token']) masked.headers['X-Token'] = '***MASKED***';
        if (masked.headers['Authorization']) masked.headers['Authorization'] = '***MASKED***';
    }
    // URL'deki query parametrelerini temizle (gerekirse)
    return masked;
}

/**
 * Tüm proxy'leri klasör bazlı listele ve cache'le
 * Skill Dokümantasyonu: GET /folders/{folderId}/proxies
 */
async function loadProxies() {
    try {
        if (!VISION_API_TOKEN) return proxyCache;

        const headers = { 'X-Token': VISION_API_TOKEN };
        const filterFolderId = process.env.VISION_FOLDER_ID;

        proxyCache.clear();

        // 1. Klasör listesini al
        let folderIds = [];
        if (filterFolderId && filterFolderId !== 'your_folder_id_here') {
            folderIds = [filterFolderId];
        } else {
            const foldersRes = await axios.get(`${VISION_CLOUD_API}/folders`, { headers });
            folderIds = (foldersRes.data.data || []).map(f => f.id);
        }

        // 2. Her klasör için proxy'leri çek
        for (const folderId of folderIds) {
            try {
                const res = await axios.get(`${VISION_CLOUD_API}/folders/${folderId}/proxies`, { headers });
                const proxies = res.data.data || [];

                for (const proxy of proxies) {
                    const hostPort = proxy.host && proxy.port ? `${proxy.host}:${proxy.port}` : null;
                    if (hostPort) {
                        proxyCache.set(proxy.id, {
                            id: proxy.id,
                            name: proxy.name,
                            host: proxy.host,
                            port: proxy.port,
                            hostPort: hostPort
                        });
                    }
                }
            } catch (err) {
                console.error(`[Vision] Klasör ${folderId} proxy'leri alınamadı:`, err.message);
            }
        }

        console.log(`[Vision] ${proxyCache.size} proxy yüklendi (Klasör bazlı)`);
        return proxyCache;
    } catch (error) {
        console.error('[Vision] Proxy listesi alma hatası:', error.message);
        return proxyCache;
    }
}

/**
 * Proxy ID'ye göre host:port getir
 */
function getProxyHostPort(proxyId) {
    const proxy = proxyCache.get(proxyId);
    return proxy?.hostPort || null;
}

/**
 * Kloud API üzerinden tüm klasörleri ve içindeki profilleri listele
 * Proxy bilgisi profil verisinden doğrudan alınır
 */
async function listProfiles() {
    try {
        if (!VISION_API_TOKEN) {
            console.error('VISION_API_TOKEN ayarlanmamış, cloud senkronizasyon yapılamaz.');
            return [];
        }

        const headers = { 'X-Token': VISION_API_TOKEN };
        const filterFolderId = process.env.VISION_FOLDER_ID;

        // Eğer bir klasör ID'si verilmişse, doğrudan o klasörün profillerini çek
        if (filterFolderId && filterFolderId !== 'your_folder_id_here' && filterFolderId !== 'optional_folder_guid_here') {
            console.log(`Doğrudan "${filterFolderId}" klasöründeki profiller çekiliyor...`);
            try {
                let allItems = [];
                let pn = 0; // Vision API pn=0'dan başlar
                const ps = 100; // Sayfa başına profil sayısı
                let hasMore = true;

                while (hasMore) {
                    const profilesRes = await axios.get(`${VISION_CLOUD_API}/folders/${filterFolderId}/profiles`, {
                        headers,
                        params: { pn, ps }
                    });

                    const items = profilesRes.data.data?.items || [];
                    const total = profilesRes.data.data?.total || 0;

                    // Yeni unique profilleri ekle
                    const existingIds = new Set(allItems.map(p => p.id));
                    const newItems = items.filter(item => !existingIds.has(item.id));
                    allItems = allItems.concat(newItems);

                    console.log(`Sayfa ${pn}: ${items.length} profil alındı (Toplam: ${allItems.length}/${total})`);

                    // Daha fazla sayfa var mı kontrol et
                    if (allItems.length >= total || items.length === 0) {
                        hasMore = false;
                    } else {
                        pn++;
                    }
                }

                return allItems.map(p => {
                    // Proxy bilgisi doğrudan profil verisinde geliyor
                    const proxyHost = p.proxy?.proxy_ip && p.proxy?.proxy_port
                        ? `${p.proxy.proxy_ip}:${p.proxy.proxy_port}`
                        : null;

                    return {
                        visionId: p.id,
                        folderId: p.folder_id,
                        name: p.profile_name,
                        status: p.running ? 'active' : 'disabled',
                        proxyId: p.proxy_id || null,
                        proxyHost: proxyHost
                    };
                }).filter((profile, index, self) =>
                    // Duplicate visionId'leri temizle (API pagination sorunu için)
                    index === self.findIndex(p => p.visionId === profile.visionId)
                );
            } catch (err) {
                console.error(`"${filterFolderId}" klasörü profilleri alınamadı:`, err.message);
                return [];
            }
        }

        // Eğer klasör ID'si yoksa tüm klasörleri listele (Fallback)
        const foldersRes = await axios.get(`${VISION_CLOUD_API}/folders`, { headers });
        const folders = foldersRes.data.data || [];

        console.log('\n--- Vision Klasör Listesi ---');
        folders.forEach(f => console.log(`İsim: ${f.folder_name} | ID: ${f.id}`));
        console.log('-----------------------------\n');

        let allProfiles = [];

        for (const folder of folders) {
            try {
                let pn = 0; // Vision API pn=0'dan başlar
                const ps = 100;
                let hasMore = true;

                while (hasMore) {
                    const profilesRes = await axios.get(`${VISION_CLOUD_API}/folders/${folder.id}/profiles`, {
                        headers,
                        params: { pn, ps }
                    });

                    const items = profilesRes.data.data?.items || [];
                    const total = profilesRes.data.data?.total || 0;

                    const formatted = items.map(p => ({
                        visionId: p.id,
                        folderId: p.folder_id,
                        name: p.profile_name,
                        status: p.running ? 'active' : 'disabled',
                        proxyId: p.proxy_id || null,
                        proxyHost: getProxyHostPort(p.proxy_id)
                    }));

                    allProfiles = allProfiles.concat(formatted);

                    // Daha fazla sayfa var mı kontrol et
                    if (allProfiles.length >= total || items.length === 0) {
                        hasMore = false;
                    } else {
                        pn++;
                    }
                }
            } catch (err) {
                console.error(`Klasör ${folder.id} profilleri alınamadı:`, err.message);
            }
        }

        // Duplicate visionId'leri temizle (API pagination sorunu için)
        return allProfiles.filter((profile, index, self) =>
            index === self.findIndex(p => p.visionId === profile.visionId)
        );
    } catch (error) {
        console.error('Profil listesi alma hatası:', error.message);
        if (error.config) {
            console.error('[Vision] Hata detayları (Maskelenmiş):', maskSensitiveData(error.config));
        }
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

                // VISION_LOCAL_API'deki host bilgisini al (örn: 127.0.0.1 veya sunucu IP'si)
                const visionUrl = new URL(VISION_LOCAL_API);
                let targetHost = visionUrl.hostname;

                // Eğer ilk deneme başarısız olursa, alternatif olarak localhost dene
                if (attempts % 2 === 0 && targetHost === '127.0.0.1') {
                    targetHost = 'localhost';
                }

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
        if (error.config) {
            console.error('[Vision] Hata detayları (Maskelenmiş):', maskSensitiveData(error.config));
        }
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

// Status cache (folder_id -> status listesi)
let statusCache = new Map();

/**
 * Folder'daki status listesini getir (cache'li)
 */
async function getStatusList(folderId) {
    // Cache'de varsa döndür
    if (statusCache.has(folderId)) {
        return statusCache.get(folderId);
    }

    try {
        const headers = { 'X-Token': VISION_API_TOKEN };
        const res = await axios.get(`${VISION_CLOUD_API}/folders/${folderId}/statuses`, { headers });
        const statuses = res.data.data || [];

        // Cache'e kaydet
        statusCache.set(folderId, statuses);
        console.log(`[Vision] ${folderId} klasörü için ${statuses.length} status yüklendi`);

        return statuses;
    } catch (error) {
        console.error('[Vision] Status listesi alma hatası:', error.message);
        return [];
    }
}

/**
 * Status isminden UUID bul
 */
async function getStatusIdByName(folderId, statusName) {
    const statuses = await getStatusList(folderId);
    const status = statuses.find(s => s.status.toUpperCase() === statusName.toUpperCase());
    return status?.id || null;
}

/**
 * Profil status'unu güncelle
 * @param {string} folderId - Folder UUID
 * @param {string} profileId - Profile UUID
 * @param {string} statusName - Status ismi (örn: "ERROR", "GOOD", "CHECK")
 */
async function updateProfileStatus(folderId, profileId, statusName) {
    try {
        // Status isminden UUID bul
        const statusId = await getStatusIdByName(folderId, statusName);

        if (!statusId) {
            console.error(`[Vision] "${statusName}" isimli status bulunamadı! Lütfen Vision'da bu status'u oluşturun.`);
            return false;
        }

        const headers = {
            'X-Token': VISION_API_TOKEN,
            'Content-Type': 'application/json'
        };

        const body = {
            profile_status: statusId
        };

        await axios.patch(
            `${VISION_CLOUD_API}/folders/${folderId}/profiles/${profileId}`,
            body,
            { headers }
        );

        console.log(`[Vision] Profil ${profileId} status'u "${statusName}" olarak güncellendi`);
        return true;
    } catch (error) {
        console.error('[Vision] Profil status güncelleme hatası:', error.message);
        if (error.config) {
            console.error('[Vision] Hata detayları (Maskelenmiş):', maskSensitiveData(error.config));
        }
        return false;
    }
}

module.exports = {
    listProfiles,
    startProfile,
    stopProfile,
    getProxyHostPort,
    loadProxies,
    updateProfileStatus,
    getStatusList
};
