/**
 * Vision Profile Service - Vision profil oluşturma ve yönetimi
 * SRP: Sadece Vision profil işlemleri
 * 
 * Değişim nedeni: Vision API değişirse
 */

const axios = require('axios');

const VISION_LOCAL_API = process.env.VISION_LOCAL_API || 'http://127.0.0.1:3030';
const VISION_CLOUD_API = 'https://v1.empr.cloud/api/v1';
const VISION_API_TOKEN = process.env.VISION_API_TOKEN;
const VISION_FOLDER_ID = process.env.VISION_FOLDER_ID;

// Proxy cache
let proxyCache = [];

/**
 * Tüm proxy'leri yükle ve cache'le
 */
async function loadProxies() {
    try {
        const headers = { 'X-Token': VISION_API_TOKEN };

        if (!VISION_FOLDER_ID || VISION_FOLDER_ID === 'your_folder_id_here') {
            console.error('[FBLogin:VisionProfile] VISION_FOLDER_ID ayarlanmamış!');
            return [];
        }

        const res = await axios.get(`${VISION_CLOUD_API}/folders/${VISION_FOLDER_ID}/proxies`, { headers });
        proxyCache = res.data.data || [];

        console.log(`[FBLogin:VisionProfile] ${proxyCache.length} proxy yüklendi`);
        return proxyCache;
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Proxy yükleme hatası:', error.message);
        return [];
    }
}

/**
 * IP adresine göre proxy bul
 */
function findProxyByIP(ip) {
    // IP|HOST formatı desteği (HOST kısmı proxy manager için)
    const cleanIP = ip.split('|')[0];
    // Vision API: proxy_ip alanını kullanıyor
    return proxyCache.find(p => p.proxy_ip === cleanIP || p.proxy_ip?.includes(cleanIP)) || null;
}

/**
 * En son fingerprint'i al
 */
async function getLatestFingerprint(platform = 'windows') {
    try {
        const headers = { 'X-Token': VISION_API_TOKEN };
        const res = await axios.get(`${VISION_CLOUD_API}/fingerprints/${platform}/latest`, { headers });

        // Vision API response: { data: { fingerprint: {...} } } veya { data: {...} }
        const data = res.data.data || res.data;

        // Eğer fingerprint iç içe geldiyse düzelt
        let fingerprint = data;
        if (data.fingerprint && data.fingerprint.major) {
            fingerprint = data.fingerprint;
        }

        // Vision API zorunlu alanları ekle (eksikse varsayılan değerler)
        // Dokümantasyon: webrtc_pref, webgl_pref, canvas_pref, ports_protection zorunlu
        if (!fingerprint.webrtc_pref) {
            fingerprint.webrtc_pref = 'auto';
        }
        if (!fingerprint.webgl_pref) {
            fingerprint.webgl_pref = 'real';
        }
        if (!fingerprint.canvas_pref) {
            fingerprint.canvas_pref = 'real';
        }
        if (!fingerprint.ports_protection) {
            fingerprint.ports_protection = [];
        }

        return fingerprint;
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Fingerprint alma hatası:', error.message);
        return null;
    }
}



/**
 * Yeni Vision profili oluştur
 * @param {object} account - Facebook hesap bilgileri
 * @returns {object} - { id, folderId, name }
 */
async function createProfile(account) {
    const headers = {
        'X-Token': VISION_API_TOKEN,
        'Content-Type': 'application/json'
    };

    // Fingerprint al
    const fingerprint = await getLatestFingerprint('windows');
    if (!fingerprint) {
        throw new Error('Fingerprint alınamadı');
    }

    // Proxy bul
    const proxy = findProxyByIP(account.proxyIP);
    if (!proxy) {
        throw new Error(`Proxy bulunamadı: ${account.proxyIP}`);
    }

    // Notes oluştur (kullanıcı adı, şifre, cookie)
    const notesContent = [
        `Kullanıcı: ${account.username}`,
        `Şifre: ${account.password}`,
        `Cookie: ${account.cookie ? 'Var (' + account.cookie.substring(0, 50) + '...)' : 'Yok'}`,
        `Oluşturulma: ${new Date().toISOString()}`
    ].join('\n');

    // Profil verileri - Vision API dokümantasyonuna uygun (TÜM alanlar)
    const profileData = {
        profile_name: `FB_${account.username.split('@')[0]}_${Date.now()}`,
        platform: 'Windows',
        browser: 'Chrome',
        fingerprint: fingerprint,
        proxy_id: proxy.id,
        profile_notes: notesContent,
        profile_tags: [],
        new_profile_tags: [],
        profile_status: null
    };

    console.log(`[FBLogin:VisionProfile] Profil oluşturuluyor: ${profileData.profile_name}`);

    try {
        const res = await axios.post(
            `${VISION_CLOUD_API}/folders/${VISION_FOLDER_ID}/profiles`,
            profileData,
            { headers }
        );

        const profile = res.data.data || res.data;
        console.log(`[FBLogin:VisionProfile] Profil oluşturuldu: ${profile.id}`);

        return {
            id: profile.id,
            folderId: VISION_FOLDER_ID,
            name: profileData.profile_name
        };
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Profil oluşturma hatası:', error.response?.status);
        console.error('[FBLogin:VisionProfile] Hata detayı:', JSON.stringify(error.response?.data, null, 2));
        console.error('[FBLogin:VisionProfile] Gönderilen veri:', JSON.stringify(profileData, null, 2));
        throw error;
    }
}


/**
 * Profili başlat ve port bilgisini döndür
 * @param {string} folderId 
 * @param {string} profileId 
 * @returns {number|null} - Debug port
 */
async function startProfile(folderId, profileId) {
    try {
        const response = await axios.get(`${VISION_LOCAL_API}/start/${folderId}/${profileId}`, {
            headers: { 'X-Token': VISION_API_TOKEN }
        });

        const { port } = response.data;
        console.log(`[FBLogin:VisionProfile] Profil başlatıldı, port: ${port}`);
        return port;
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Profil başlatma hatası:', error.response?.status, error.message);
        console.error('[FBLogin:VisionProfile] Hata detayı:', JSON.stringify(error.response?.data, null, 2));
        return null;
    }
}

/**
 * Profili durdur
 */
async function stopProfile(folderId, profileId) {
    try {
        await axios.get(`${VISION_LOCAL_API}/stop/${folderId}/${profileId}`, {
            headers: { 'X-Token': VISION_API_TOKEN }
        });
        console.log(`[FBLogin:VisionProfile] Profil durduruldu: ${profileId}`);
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Profil durdurma hatası:', error.message);
    }
}

/**
 * Proxy cache'in yüklenip yüklenmediğini kontrol et
 */
function isProxyCacheLoaded() {
    return proxyCache.length > 0;
}

/**
 * Profil notlarını güncelle
 * @param {string} profileId
 * @param {string} folderId
 * @param {string} newNotes
 */
async function updateProfileNotes(profileId, folderId, newNotes) {
    try {
        const headers = {
            'X-Token': VISION_API_TOKEN,
            'Content-Type': 'application/json'
        };

        // Vision API: PATCH /api/v1/folders/:folderId/profiles/:profileId
        // Body: { profile_notes: '...' }
        await axios.patch(
            `${VISION_CLOUD_API}/folders/${folderId}/profiles/${profileId}`,
            { profile_notes: newNotes },
            { headers }
        );

        console.log(`[FBLogin:VisionProfile] Profil notları güncellendi: ${profileId}`);
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Not güncelleme hatası:', error.message);
    }
}

/**
 * Profili sil
 * @param {string} folderId 
 * @param {string} profileId 
 */
async function deleteProfile(folderId, profileId) {
    try {
        const headers = { 'X-Token': VISION_API_TOKEN };
        // Vision API: DELETE /api/v1/folders/:folderId/profiles/:profileId
        await axios.delete(`${VISION_CLOUD_API}/folders/${folderId}/profiles/${profileId}`, { headers });
        console.log(`[FBLogin:VisionProfile] Profil silindi: ${profileId}`);
    } catch (error) {
        console.error('[FBLogin:VisionProfile] Profil silme hatası:', error.message);
    }
}

module.exports = {
    loadProxies,
    findProxyByIP,
    createProfile,
    startProfile,
    stopProfile,
    isProxyCacheLoaded,
    updateProfileNotes,
    deleteProfile
};
