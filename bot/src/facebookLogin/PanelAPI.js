/**
 * Panel API Service - Facebook Login için Panel iletişimi
 * SRP: Sadece Panel API çağrıları
 * 
 * Değişim nedeni: Panel API endpoint'leri değişirse
 */

const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

/**
 * Sonraki bekleyen hesabı al
 * @returns {object|null} - Hesap objesi veya null
 */
async function getNextPendingAccount() {
    try {
        const res = await axios.get(`${PANEL_URL}/api/fb-login/next-pending`);
        return res.data.success ? res.data.account : null;
    } catch (error) {
        console.error('[FBLogin:PanelAPI] Hesap alma hatası:', error.message);
        return null;
    }
}

/**
 * Hesap durumunu güncelle
 * @param {number} accountId - Hesap ID
 * @param {string} status - Yeni durum
 * @param {object} extra - Ek veriler (visionId, folderId, errorMessage)
 */
async function updateAccountStatus(accountId, status, extra = {}) {
    try {
        await axios.post(`${PANEL_URL}/api/fb-login/update-status`, {
            accountId,
            status,
            ...extra
        });
        console.log(`[FBLogin:PanelAPI] Hesap #${accountId} durumu: ${status}`);
    } catch (error) {
        console.error('[FBLogin:PanelAPI] Status güncelleme hatası:', error.message);
    }
}

/**
 * İşlenecek hesap var mı kontrol et
 * @returns {object} - { shouldProcess, pendingCount, processingCount }
 */
async function shouldProcess() {
    try {
        const res = await axios.get(`${PANEL_URL}/api/fb-login/should-process`);
        return res.data;
    } catch (error) {
        return { shouldProcess: false, pendingCount: 0, processingCount: 0 };
    }
}

module.exports = {
    getNextPendingAccount,
    updateAccountStatus,
    shouldProcess
};
