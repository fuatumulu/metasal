const axios = require('axios');
const puppeteer = require('puppeteer-core');

const VISION_API_URL = process.env.VISION_API_URL || 'http://localhost:35599';

/**
 * Vision profilleri listele
 */
async function listProfiles() {
    try {
        const response = await axios.get(`${VISION_API_URL}/api/profile/list`);
        return response.data.profiles || [];
    } catch (error) {
        console.error('Profil listesi alma hatası:', error.message);
        return [];
    }
}

/**
 * Yeni profil oluştur
 */
async function createProfile(name) {
    try {
        const response = await axios.post(`${VISION_API_URL}/api/profile/create`, {
            name,
            os: 'mac',
            browser: 'chrome'
        });
        return response.data.uuid || null;
    } catch (error) {
        console.error('Profil oluşturma hatası:', error.message);
        return null;
    }
}

/**
 * Profili başlat ve browser bağlantısı al
 */
async function startProfile(profileId) {
    try {
        const response = await axios.get(`${VISION_API_URL}/api/profile/start/${profileId}`);
        const wsEndpoint = response.data.ws?.puppeteer;

        if (!wsEndpoint) {
            console.error('WebSocket endpoint bulunamadı');
            return null;
        }

        const browser = await puppeteer.connect({
            browserWSEndpoint: wsEndpoint,
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
 */
async function stopProfile(profileId) {
    try {
        await axios.get(`${VISION_API_URL}/api/profile/stop/${profileId}`);
        console.log(`Profil ${profileId} durduruldu`);
    } catch (error) {
        console.error('Profil durdurma hatası:', error.message);
    }
}

/**
 * Hesap için profil al veya oluştur
 */
async function getOrCreateProfile(accountId, visionProfileId) {
    // Mevcut profil varsa kullan
    if (visionProfileId) {
        const profiles = await listProfiles();
        const exists = profiles.find(p => p.uuid === visionProfileId);
        if (exists) {
            return visionProfileId;
        }
    }

    // Yeni profil oluştur
    const newProfileId = await createProfile(`fb_account_${accountId}`);
    return newProfileId;
}

module.exports = {
    listProfiles,
    createProfile,
    startProfile,
    stopProfile,
    getOrCreateProfile
};
