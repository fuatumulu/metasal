const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

/**
 * Bekleyen görevi al
 */
async function getPendingTask() {
    try {
        const response = await axios.get(`${PANEL_URL}/api/tasks/pending`);
        return response.data.task;
    } catch (error) {
        console.error('Görev alma hatası:', error.message);
        return null;
    }
}

/**
 * Görev sonucunu bildir
 */
async function reportTaskResult(taskId, status, result = null) {
    try {
        await axios.post(`${PANEL_URL}/api/tasks/${taskId}/result`, {
            status,
            result
        });
        console.log(`Görev #${taskId} sonucu bildirildi: ${status}`);
    } catch (error) {
        console.error('Sonuç bildirme hatası:', error.message);
    }
}

/**
 * Hesap durumunu güncelle
 */
async function updateAccountStatus(accountId, status, visionProfileId = null) {
    try {
        await axios.post(`${PANEL_URL}/api/accounts/${accountId}/status`, {
            status,
            visionProfileId
        });
        console.log(`Hesap #${accountId} durumu güncellendi: ${status}`);
    } catch (error) {
        console.error('Hesap güncelleme hatası:', error.message);
    }
}

module.exports = {
    getPendingTask,
    reportTaskResult,
    updateAccountStatus
};
