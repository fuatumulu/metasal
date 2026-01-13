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
        // Silent error for task polling
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

async function pushProfiles(profiles) {
    try {
        await axios.post(`${PANEL_URL}/api/profiles/push`, { profiles });
        return true;
    } catch (error) {
        console.error('Push profiles error:', error.message);
        return false;
    }
}

/**
 * Log gönder
 */
async function sendLog(level, type, message, details = null) {
    try {
        await axios.post(`${PANEL_URL}/api/logs`, {
            level,
            type,
            message,
            details
        });
    } catch (error) {
        // Silent error for logging
    }
}
/**
 * Heartbeat - Panel ile bağlantıyı canlı tut
 * Uzun süre görevsiz kalan bot'un uykuya dalmasını engeller
 */
async function heartbeat() {
    try {
        const response = await axios.get(`${PANEL_URL}/api/heartbeat`);
        return response.data;
    } catch (error) {
        console.error('[Heartbeat] Panel bağlantı hatası:', error.message);
        return null;
    }
}

module.exports = {
    getPendingTask,
    reportTaskResult,
    pushProfiles,
    sendLog,
    heartbeat
};

