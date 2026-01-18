/**
 * Facebook Login Orchestrator
 * SRP: Sadece iş akışı koordinasyonu - HOW değil WHAT
 * 
 * Değişim nedeni: İş akışı sırası veya mantığı değişirse
 * 
 * Bu modül hiçbir teknik detay içermez, sadece adımları koordine eder.
 */

const puppeteer = require('puppeteer-core');
const { sleep, login } = require('../facebook');
const { sendLog } = require('../api');

// SRP-uyumlu servisler
const PanelAPI = require('./PanelAPI');
const VisionProfileService = require('./VisionProfileService');
const CookieService = require('./CookieService');
const SessionValidator = require('./SessionValidator');
const OperatorUI = require('./OperatorUI');
const ProxyIPService = require('./ProxyIPService');

/**
 * Facebook Login Job Orchestrator
 * Tek bir hesabın tüm giriş sürecini yönetir
 */
class FacebookLoginJob {
    constructor(account, threadId = 1) {
        this.account = account;
        this.threadId = threadId;
        this.profile = null;
        this.browser = null;
        this.page = null;
    }

    /**
     * Tag: Loglama için prefix
     */
    get tag() {
        return `[Thread-${this.threadId}:FBLogin]`;
    }

    /**
     * Adım 1: Vision profili oluştur
     */
    async createVisionProfile() {
        console.log(`${this.tag} Adım 1: Vision profili oluşturuluyor...`);

        this.profile = await VisionProfileService.createProfile(this.account);

        // Panel'e bildir
        await PanelAPI.updateAccountStatus(this.account.id, 'processing', {
            visionId: this.profile.id,
            folderId: this.profile.folderId
        });

        return this.profile;
    }

    /**
     * Adım 2: Cookie import et (varsa)
     */
    async importCookies() {
        if (!this.account.cookie) {
            console.log(`${this.tag} Adım 2: Cookie yok, atlanıyor`);
            return false;
        }

        console.log(`${this.tag} Adım 2: Cookie import ediliyor...`);
        return await CookieService.importCookies(
            this.profile.folderId,
            this.profile.id,
            this.account.cookie
        );
    }

    /**
     * Adım 3: Tarayıcıyı başlat
     */
    async startBrowser() {
        console.log(`${this.tag} Adım 3: Tarayıcı başlatılıyor...`);

        const port = await VisionProfileService.startProfile(
            this.profile.folderId,
            this.profile.id
        );

        if (!port) {
            throw new Error('Vision profili başlatılamadı');
        }

        // Bağlantı için bekle ve dene
        for (let i = 0; i < 5; i++) {
            await sleep(2000 + (i * 1000));
            try {
                this.browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${port}`,
                    defaultViewport: null
                });
                console.log(`${this.tag} Tarayıcı bağlantısı başarılı`);
                break;
            } catch (err) {
                console.log(`${this.tag} Bağlantı denemesi ${i + 1}/5 başarısız`);
            }
        }

        if (!this.browser) {
            throw new Error('Tarayıcı bağlantısı kurulamadı');
        }

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();

        return this.browser;
    }

    /**
     * Adım 4: Cookie ile session doğrula
     */
    async verifyCookieSession() {
        if (!this.account.cookie) {
            return { valid: false, reason: 'no_cookie' };
        }

        console.log(`${this.tag} Adım 4: Cookie ile session doğrulanıyor...`);
        return await SessionValidator.verifySession(this.page);
    }

    /**
     * Adım 5: Kullanıcı adı/şifre ile giriş yap
     */
    async loginWithCredentials() {
        console.log(`${this.tag} Adım 5: Kullanıcı adı/şifre ile giriş yapılıyor...`);
        return await login(this.page, this.account.username, this.account.password);
    }

    /**
     * Adım 6: Operatör müdahalesi bekle
     */
    async waitForOperator(message) {
        console.log(`${this.tag} Adım 6: Operatör bekleniyor...`);
        return await OperatorUI.waitForOperator(this.page, message);
    }

    /**
     * Başarı durumunu bildir
     */
    async reportSuccess() {
        await PanelAPI.updateAccountStatus(this.account.id, 'success');
        await sendLog('success', 'FB_LOGIN', `✅ Giriş başarılı: ${this.account.username}`);
        console.log(`${this.tag} ✅ BAŞARILI: ${this.account.username}`);
    }

    /**
     * Hata durumunu bildir
     */
    async reportFailure(status, errorMessage) {
        await PanelAPI.updateAccountStatus(this.account.id, status, { errorMessage });
        await sendLog('error', 'FB_LOGIN', `❌ ${errorMessage}: ${this.account.username}`);
        console.log(`${this.tag} ❌ HATA: ${this.account.username} - ${errorMessage}`);
    }

    /**
     * Kaynakları temizle
     */
    async cleanup() {
        // Tarayıcı bağlantısını kes
        if (this.browser) {
            try {
                await this.browser.disconnect();
            } catch (e) { }
        }

        // Profili durdur
        if (this.profile) {
            await sleep(3000);
            await VisionProfileService.stopProfile(this.profile.folderId, this.profile.id);
        }
    }
}

/**
 * Ana işlem fonksiyonu - Orchestrator
 * Tek bir hesabı baştan sona işler
 * 
 * @param {object} account - Facebook hesap bilgileri
 * @param {number} threadId - Thread ID
 * @returns {boolean} - Başarılı mı
 */
async function processAccount(account, threadId = 1) {
    const job = new FacebookLoginJob(account, threadId);
    const loginMode = account.loginMode || 'auto'; // auto veya password_only

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Thread-${threadId}:FBLogin] İşleniyor: ${account.username}`);
    console.log(`[Thread-${threadId}:FBLogin] Mod: ${loginMode === 'password_only' ? '🔑 Şifre ile Giriş' : '🍪 Otomatik (Cookie öncelikli)'}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
        // 0. Proxy IP değiştir (yeni oturum için temiz IP)
        console.log(`[Thread-${threadId}:FBLogin] Adım 0: Proxy IP değiştiriliyor...`);
        await ProxyIPService.changeProxyIP(account.proxyIP);

        // 1. Profil oluştur
        await job.createVisionProfile();

        // 2. Cookie import et (password_only modunda atla)
        if (loginMode !== 'password_only') {
            await job.importCookies();
        } else {
            console.log(`${job.tag} Adım 2: password_only modu - Cookie import atlanıyor`);
        }

        // 3. Tarayıcıyı başlat
        await job.startBrowser();

        // 4. Cookie ile session doğrula (password_only modunda atla)
        if (loginMode !== 'password_only') {
            const sessionResult = await job.verifyCookieSession();

            if (sessionResult.valid) {
                // Cookie çalışıyor!
                await job.waitForOperator('Giriş başarılı. Ekranda buton veya onay varsa tıklayın.');
                await job.reportSuccess();
                return true;
            }

            // Cookie başarısız veya yok - auto modda cookie_failed rapor et
            if (account.cookie && sessionResult.reason !== 'no_cookie') {
                console.log(`${job.tag} Cookie çalışmıyor (${sessionResult.reason})`);
                await job.reportFailure('cookie_failed', 'Cookie ile giriş başarısız');
                return false;
            }
        } else {
            console.log(`${job.tag} Adım 4: password_only modu - Cookie doğrulama atlanıyor`);
        }

        // 5. Kullanıcı adı/şifre ile giriş
        const loginSuccess = await job.loginWithCredentials();

        if (!loginSuccess) {
            // Checkpoint kontrolü
            const isCheckpoint = await SessionValidator.isCheckpointPage(job.page);
            if (isCheckpoint) {
                await job.waitForOperator('Facebook güvenlik doğrulaması gerekiyor. Doğrulamayı tamamlayın.');

                // Doğrulama sonrası kontrol
                const afterVerify = await SessionValidator.verifySession(job.page);
                if (afterVerify.valid) {
                    await job.reportSuccess();
                    return true;
                }
            }

            await job.reportFailure('login_failed', 'Kullanıcı adı/şifre ile giriş başarısız');
            return false;
        }

        // Giriş başarılı
        await job.waitForOperator('Giriş yapıldı. Ekranda "Devam Et" veya doğrulama butonu varsa tıklayın.');

        // Son kontrol
        const finalCheck = await SessionValidator.verifySession(job.page);
        if (finalCheck.valid) {
            await job.reportSuccess();
            return true;
        } else {
            await job.reportFailure('needs_verify', 'Giriş yapıldı ama doğrulama gerekiyor');
            return false;
        }

    } catch (error) {
        console.error(`${job.tag} HATA: ${error.message}`);
        await job.reportFailure('login_failed', error.message);
        return false;

    } finally {
        await job.cleanup();
    }
}

/**
 * Proxy cache'i yükle (Başlangıçta bir kere çağrılmalı)
 */
async function initialize() {
    console.log('[FBLogin] Modül başlatılıyor...');

    // Proxy IP change config'lerini yükle
    ProxyIPService.initialize();

    // Vision proxy cache'i yükle
    await VisionProfileService.loadProxies();

    if (!VisionProfileService.isProxyCacheLoaded()) {
        console.error('[FBLogin] HATA: Proxy cache yüklenemedi!');
        return false;
    }

    console.log('[FBLogin] Modül hazır');
    return true;
}

/**
 * Bekleyen hesap var mı kontrol et
 */
async function hasPendingAccounts() {
    const result = await PanelAPI.shouldProcess();
    return result.shouldProcess;
}

/**
 * Sonraki bekleyen hesabı al
 */
async function getNextAccount() {
    return await PanelAPI.getNextPendingAccount();
}

module.exports = {
    processAccount,
    initialize,
    hasPendingAccounts,
    getNextAccount,
    FacebookLoginJob
};
