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

module.exports = {
    listProfiles,
    startProfile,
    stopProfile
};
