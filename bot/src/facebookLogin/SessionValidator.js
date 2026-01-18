/**
 * Session Validator - Facebook session doğrulama
 * SRP: Sadece Facebook session kontrolü
 * 
 * Değişim nedeni: Facebook login sayfası yapısı değişirse
 */

const { sleep, handlePopups } = require('../facebook');

/**
 * Facebook session'ın geçerli olup olmadığını kontrol et
 * @param {object} page - Puppeteer page
 * @returns {object} - { valid: boolean, reason: string }
 */
async function verifySession(page) {
    try {
        await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 30000 });

        // Sayfayı yenile ve bekle (taskHandler.js mantığı)
        try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
            console.log('[FBLogin:Session] Sayfa yenileme uyarısı atlandı.');
        }

        // Popup temizliği yap ve 10sn bekle
        await handlePopups(page);
        await sleep(10000);

        const url = page.url();

        // Login sayfasına yönlendirildiyse = session yok
        if (url.includes('login')) {
            return { valid: false, reason: 'login_redirect' };
        }

        // Checkpoint = güvenlik doğrulaması gerekiyor
        if (url.includes('checkpoint')) {
            return { valid: false, reason: 'checkpoint' };
        }

        // Doğrulama: Aria-label kontrolü (Daha güvenilir)
        const hasSession = await page.evaluate(() => {
            const labels = ['bildirimler', 'notifications', 'messenger', 'mesajlar', 'ana sayfa', 'home'];
            return Array.from(document.querySelectorAll('[aria-label]'))
                .some(el => labels.includes(el.getAttribute('aria-label').toLowerCase()));
        });

        if (!hasSession) {
            // Yedek kontrol: role="feed"
            const feedExists = await page.$('[role="feed"]');
            if (!feedExists) {
                return { valid: false, reason: 'no_feed' };
            }
        }

        return { valid: true, reason: 'success' };
    } catch (error) {
        console.error('[FBLogin:Session] Session doğrulama hatası:', error.message);
        return { valid: false, reason: 'error', error: error.message };
    }
}

/**
 * Checkpoint sayfasında mı kontrol et
 * @param {object} page - Puppeteer page
 * @returns {boolean}
 */
async function isCheckpointPage(page) {
    try {
        const url = page.url();
        return url.includes('checkpoint');
    } catch (error) {
        return false;
    }
}

module.exports = {
    verifySession,
    isCheckpointPage
};
