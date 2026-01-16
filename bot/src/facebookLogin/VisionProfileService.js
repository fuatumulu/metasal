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
    return proxyCache.find(p => p.host === ip || p.host?.includes(ip)) || null;
}

/**
 * En son fingerprint'i al
 */
async function getLatestFingerprint(platform = 'windows') {
    try {
        const headers = { 'X-Token': VISION_API_TOKEN };
        const res = await axios.get(`${VISION_CLOUD_API}/fingerprints/${platform}/latest`, { headers });
        return res.data.data || res.data;
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

    // Profil verileri
    const profileData = {
        profile_name: `FB_${account.username.split('@')[0]}_${Date.now()}`,
        platform: 'windows',
        browser: 'chromium',
        fingerprint: fingerprint,
        proxy_id: proxy.id,
        profile_notes: notesContent
    };

    console.log(`[FBLogin:VisionProfile] Profil oluşturuluyor: ${profileData.profile_name}`);

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
        console.error('[FBLogin:VisionProfile] Profil başlatma hatası:', error.message);
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

module.exports = {
    loadProxies,
    findProxyByIP,
    createProfile,
    startProfile,
    stopProfile,
    isProxyCacheLoaded
};
