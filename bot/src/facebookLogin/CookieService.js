/**
 * Cookie Service - Cookie import/export işlemleri
 * SRP: Sadece cookie işlemleri
 * 
 * Değişim nedeni: Cookie formatı veya Vision Cookie API değişirse
 */

const axios = require('axios');

const VISION_CLOUD_API = 'https://v1.empr.cloud/api/v1';
const VISION_API_TOKEN = process.env.VISION_API_TOKEN;

/**
 * Cookie'yi Vision profiline import et
 * @param {string} folderId - Vision folder ID
 * @param {string} profileId - Vision profile ID
 * @param {string} cookieBase64 - Base64 encoded cookie JSON
 * @returns {boolean} - Başarılı mı
 */
async function importCookies(folderId, profileId, cookieBase64) {
    try {
        if (!cookieBase64) {
            console.log('[FBLogin:Cookie] Cookie yok, import atlanıyor');
            return false;
        }

        const headers = {
            'X-Token': VISION_API_TOKEN,
            'Content-Type': 'application/json'
        };

        // Base64'ten decode et
        const cookieJson = Buffer.from(cookieBase64, 'base64').toString('utf-8');
        const rawCookies = JSON.parse(cookieJson);

        // Cookie formatını Vision API'ye uygun hale getir
        // Vision API: { name, value, path, domain, expires (saniye) }
        // Gelen format: { name, value, path, domain, expirationDate (milisaniye), httpOnly, secure }
        const cookies = rawCookies.map(cookie => ({
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/',
            domain: cookie.domain || '.facebook.com',
            // expirationDate milisaniye, expires saniye olmalı
            expires: cookie.expirationDate
                ? Math.floor(cookie.expirationDate / 1000)
                : (cookie.expires || Math.floor(Date.now() / 1000) + 86400 * 365)
        }));

        // Cookie import
        await axios.post(
            `${VISION_CLOUD_API}/cookies/import/${folderId}/${profileId}`,
            { cookies },
            { headers }
        );

        console.log(`[FBLogin:Cookie] ${cookies.length} cookie import edildi`);
        return true;
    } catch (error) {
        console.error('[FBLogin:Cookie] Cookie import hatası:', error.response?.data || error.message);
        return false;
    }
}


/**
 * Profile cookie'lerini export et
 * @param {string} folderId 
 * @param {string} profileId 
 * @returns {array|null} - Cookie array
 */
async function exportCookies(folderId, profileId) {
    try {
        const headers = { 'X-Token': VISION_API_TOKEN };
        const res = await axios.get(`${VISION_CLOUD_API}/cookies/${folderId}/${profileId}`, { headers });
        return res.data.data || res.data;
    } catch (error) {
        console.error('[FBLogin:Cookie] Cookie export hatası:', error.message);
        return null;
    }
}

module.exports = {
    importCookies,
    exportCookies
};
