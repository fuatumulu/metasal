const { sleep, likeTarget, boostTarget, findPostByKeyword, likeCurrentPost, commentCurrentPost, shareCurrentPost, simulateHumanBrowsing, ensureMaximized } = require('./facebook');
const { startProfile, stopProfile, updateProfileStatus, listProfiles } = require('./vision');
const { tryLockCarrier, unlockCarrier, changeIP, getDefaultProxyHost } = require('./proxyManager');
const { reportTaskResult, pushProfiles, sendLog } = require('./api');
const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

class JobOrchestrator {
    constructor(task, threadId) {
        this.task = task;
        this.threadId = threadId;
        this.profile = task.profile;
        this.visionId = this.profile?.visionId;
        this.folderId = this.profile?.folderId;
        this.proxyHost = this.profile?.proxyHost || getDefaultProxyHost() || 'DEFAULT';

        this.browser = null;
        this.page = null;
        this.isCarrierLocked = false;
        this.shouldRotateIP = false;
    }

    /**
     * ADIM 1: Kaynakları Hazırla (Proxy Kilidi ve Slot)
     */
    async prepareResources(waitForProfileSlotFn) {
        // Carrier Lock
        if (!tryLockCarrier(this.proxyHost, this.visionId)) {
            console.log(`[Thread-${this.threadId}] Carrier ${this.proxyHost} meşgul, tekrar kuyruğa alınıyor.`);
            await reportTaskResult(this.task.id, 'pending', 'Carrier meşgul - yeniden kuyrukta');
            return false;
        }
        this.isCarrierLocked = true;

        // Thread'ler arası slot bekleme (index.js'den gelen fonksiyon)
        await waitForProfileSlotFn(this.threadId);
        return true;
    }

    /**
     * ADIM 2: Tarayıcıyı Başlat
     */
    async initBrowser() {
        console.log(`[Thread-${this.threadId}] Profil başlatılıyor: ${this.profile.name}`);

        let startAttempts = 0;
        const maxStartAttempts = 3;

        while (startAttempts < maxStartAttempts) {
            startAttempts++;
            this.browser = await startProfile(this.folderId, this.visionId);
            if (this.browser) break;

            if (startAttempts < maxStartAttempts) {
                console.log(`[Thread-${this.threadId}] Browser başlatılamadı, 5sn sonra tekrar denenecek (${startAttempts}/${maxStartAttempts})`);
                await sleep(5000);
            }
        }

        if (!this.browser) {
            throw new Error('Browser başlatılamadı veya Vision profil meşgul');
        }

        this.shouldRotateIP = true; // Tarayıcı bir kez bile açıldıysa IP rotasyonu şart
        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();
        await ensureMaximized(this.page);
    }

    /**
     * ADIM 3: Facebook Oturum Kontrolü
     */
    async validateLogin() {
        console.log(`[Thread-${this.threadId}] Facebook oturumu doğrulanıyor...`);
        await this.page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(10000);

        try {
            await this.page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
            console.log(`[Thread-${this.threadId}] Sayfa yenileme uyarısı atlandı.`);
        }

        const hasSession = await this.page.evaluate(() => {
            const labels = ['bildirimler', 'notifications', 'messenger', 'mesajlar'];
            return Array.from(document.querySelectorAll('[aria-label]'))
                .some(el => labels.includes(el.getAttribute('aria-label').toLowerCase()));
        });

        if (!hasSession) {
            await updateProfileStatus(this.folderId, this.visionId, 'ERROR');
            throw new Error('Facebook girişi aktif değil (Oturum doğrulaması başarısız)');
        }
        console.log(`[Thread-${this.threadId}] Oturum doğrulandı.`);
    }

    /**
     * ADIM 4: Görevi İcra Et
     */
    async runAction() {
        let success = false;
        const type = this.task.taskType;

        switch (type) {
            case 'like_target':
                success = await likeTarget(this.page, this.task.target.url, this.task.target.type);
                break;

            case 'post_action':
                success = await this._handlePostAction();
                break;

            case 'boost_target':
                const postCount = parseInt(this.task.result) || 4;
                success = await boostTarget(this.page, this.task.target.url, postCount);
                break;

            default:
                throw new Error(`Bilinmeyen görev tipi: ${type}`);
        }

        if (success) {
            await simulateHumanBrowsing(this.page);
        }
        return success;
    }

    /**
     * Private: Post Action (Like/Comment/Share) detay yönetimi
     */
    async _handlePostAction() {
        console.log(`[Thread-${this.threadId}] --- POST ACTION: Gönderi aranıyor ---`);
        const found = await findPostByKeyword(this.page, this.task.postTask.searchKeyword);

        if (!found) {
            await reportTaskResult(this.task.id, 'failed', 'Gönderi bulunamadı - devrediliyor');
            return false;
        }

        const action = this.task.result;
        console.log(`[Thread-${this.threadId}] --- İşlem: ${action.toUpperCase()} ---`);

        switch (action) {
            case 'like':
                return await likeCurrentPost(this.page);
            case 'comment':
                const commentRes = await axios.get(`${PANEL_URL}/api/comments/random`);
                const commentText = commentRes.data.comment?.text;
                if (!commentText) throw new Error('Yorum havuzu boş');
                return await commentCurrentPost(this.page, commentText);
            case 'share':
                return await shareCurrentPost(this.page);
            default:
                return false;
        }
    }

    /**
     * ADIM 5: Başarılı Sonuç Bildirimi
     */
    async complete() {
        await reportTaskResult(this.task.id, 'completed', 'Başarılı');
        await sendLog('success', 'TASK_END', `[Thread-${this.threadId}] Görev #${this.task.id} başarıyla tamamlandı`, { taskId: this.task.id, threadId: this.threadId });
    }

    /**
     * ADIM 6: Hata Raporlama
     */
    async fail(error) {
        console.error(`[Thread-${this.threadId}] HATA:`, error.message);
        await reportTaskResult(this.task.id, 'failed', error.message);
        await sendLog('error', 'TASK_ERROR', `[Thread-${this.threadId}] Hata: ${error.message}`, { taskId: this.task.id, threadId: this.threadId });
    }

    /**
     * ADIM 7: Kaynakları Serbest Bırak (Kritik Temizlik)
     */
    async releaseResources() {
        if (this.browser) {
            try {
                console.log(`[Thread-${this.threadId}] Profil kapatılıyor...`);
                await stopProfile(this.folderId, this.visionId);
                await this.browser.disconnect();
            } catch (e) {
                console.log(`[Thread-${this.threadId}] Temizlik uyarısı:`, e.message);
            }
        }

        if (this.shouldRotateIP) {
            console.log(`[Thread-${this.threadId}] --- PROXY IP DEĞİŞTİRİLİYOR ---`);
            await changeIP(this.proxyHost);
        }

        if (this.isCarrierLocked) {
            console.log(`[Thread-${this.threadId}] Taşıyıcı kilidi açılıyor.`);
            unlockCarrier(this.proxyHost);
        }
    }
}

module.exports = JobOrchestrator;
