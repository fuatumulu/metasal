/**
 * Facebook Login Orchestrator
 * SRP: Sadece iş akışı koordinasyonu - HOW değil WHAT
 * 
 * Değişim nedeni: İş akışı sırası veya mantığı değişirse
 * 
 * Bu modül hiçbir teknik detay içermez, sadece adımları koordine eder.
 * Yeni Akış: Init -> Bekle -> Operatör Kararı -> (Hatalı -> Sil) veya (Başarılı -> Dil/Şifre Değişimi -> Kaydet)
 */

const puppeteer = require('puppeteer-core');
const { sleep, handlePopups } = require('../facebook');
const { sendLog } = require('../api');

// SRP-uyumlu servisler
const PanelAPI = require('./PanelAPI');
const VisionProfileService = require('./VisionProfileService');
const CookieService = require('./CookieService');
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

    get tag() {
        return `[Thread-${this.threadId}:FBLogin]`;
    }

    /**
     * ADIM 1: Başlangıç (Proxy, Profil, Browser)
     */
    async initializeStack() {
        console.log(`${this.tag} Adım 1: Kaynaklar hazırlanıyor...`);

        // Proxy değiştir - Retry loop
        while (true) {
            const result = await ProxyIPService.changeProxyIP(this.account.proxyIP);

            if (result.success) {
                break;
            }

            if (result.waitSeconds) {
                console.log(`${this.tag} Proxy rotasyon limiti, ${result.waitSeconds} saniye bekleniyor...`);
                // Panel'e de bilgi ver
                await PanelAPI.updateAccountStatus(this.account.id, 'processing', {
                    errorMessage: `Proxy bekleniyor (${result.waitSeconds} sn)`
                });
                await sleep(result.waitSeconds * 1000);
            } else {
                // Bekleme süresi yoksa hesabı proxy_failed durumuna al ve atla
                console.log(`${this.tag} Proxy değiştirilemedi, hesap atlanıyor: ${result.message}`);
                await PanelAPI.updateAccountStatus(this.account.id, 'proxy_failed', {
                    errorMessage: `Proxy hatası: ${result.message}`
                });
                return false; // İşlemi başarısız olarak işaretle
            }
        }

        // Profil oluştur
        this.profile = await VisionProfileService.createProfile(this.account);
        await PanelAPI.updateAccountStatus(this.account.id, 'processing', {
            visionId: this.profile.id,
            folderId: this.profile.folderId
        });

        // Cookie import (varsa) - Şifre modunda bile varsa import edelim, zararı olmaz
        if (this.account.cookie) {
            await CookieService.importCookies(this.profile.folderId, this.profile.id, this.account.cookie);
        }

        // Browser başlat
        const port = await VisionProfileService.startProfile(this.profile.folderId, this.profile.id);
        if (!port) throw new Error('Vision profili başlatılamadı');

        // Puppeteer connect - Retry mekanizmalı
        for (let i = 0; i < 5; i++) {
            await sleep(2000 + (i * 1000));
            try {
                this.browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${port}`,
                    defaultViewport: null
                });
                break;
            } catch (err) {
                console.log(`${this.tag} Bağlantı denemesi ${i + 1}/5 başarısız`);
            }
        }

        if (!this.browser) throw new Error('Tarayıcıya bağlanılamadı');

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();

        // Facebook'a git (yavaş proxy'ler için 120sn timeout)
        console.log(`${this.tag} Facebook açılıyor...`);
        await this.page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 120000 });

        // Cookie kontrolü ve otomatik login denemesi
        const autoLoginAttempted = await this.attemptAutoLogin();
        if (autoLoginAttempted) {
            console.log(`${this.tag} Login sonrası sayfa yüklenmesi bekleniyor...`);
            // Login sonrası ek bekleme (2FA, checkpoint, ana sayfa vs. için)
            await sleep(5000);
        }
    }

    /**
     * Otomatik login denemesi (cookie çalışmadıysa)
     * Facebook login formunu doldur ve giriş yap
     * @returns {boolean} - Login formu bulundu ve dolduruldu mu
     */
    async attemptAutoLogin() {
        try {
            console.log(`${this.tag} Cookie kontrolü yapılıyor...`);

            // Cookie consent popup'ı kapat (varsa)
            try {
                await sleep(2000); // Popup'ın yüklenmesi için bekle

                // Facebook cookie consent seçicileri
                const cookieAcceptSelectors = [
                    'button[data-cookiebanner="accept_button"]',
                    'button[title="Tümünü kabul et"]',
                    'button[title="Accept all"]',
                    'button:has-text("Tümünü kabul et")',
                    'button:has-text("Accept all")'
                ];

                for (const selector of cookieAcceptSelectors) {
                    try {
                        const cookieBtn = await this.page.$(selector);
                        if (cookieBtn) {
                            await cookieBtn.click();
                            console.log(`${this.tag} Cookie uyarısı kapatıldı`);
                            await sleep(1000); // Popup kapanması için bekle
                            break;
                        }
                    } catch (e) {
                        // Bu seçici yoksa bir sonrakini dene
                    }
                }
            } catch (e) {
                console.log(`${this.tag} Cookie uyarısı bulunamadı veya hata: ${e.message}`);
            }

            // Login formu var mı kontrol et (email input varlığı)
            const emailInput = await this.page.$('[data-testid="royal-email"]') ||
                await this.page.$('#email');

            if (!emailInput) {
                console.log(`${this.tag} Login formu bulunamadı, cookie çalışmış olabilir`);
                return false; // Login ekranı yok, cookie çalışmış
            }

            // Username ve password kontrolü
            if (!this.account.username || !this.account.password) {
                console.log(`${this.tag} Username veya password yok, manuel login gerekli`);
                return false;
            }

            console.log(`${this.tag} Login formu bulundu, otomatik giriş yapılıyor...`);

            // 1. Email/Username gir
            await emailInput.click(); // Focus
            await sleep(300);
            await emailInput.type(this.account.username, { delay: 80 });
            console.log(`${this.tag} Username girildi`);

            // 2. Password gir
            const passInput = await this.page.$('[data-testid="royal-pass"]') ||
                await this.page.$('#pass');

            if (!passInput) {
                console.log(`${this.tag} Password input bulunamadı`);
                return false;
            }

            await passInput.click(); // Focus
            await sleep(300);
            await passInput.type(this.account.password, { delay: 80 });
            console.log(`${this.tag} Password girildi`);

            // 3. Login butonuna tıkla
            const loginButton = await this.page.$('button[data-testid="royal-login-button"]') ||
                await this.page.$('button[name="login"]') ||
                await this.page.$('button[type="submit"]');

            if (!loginButton) {
                console.log(`${this.tag} Login butonu bulunamadı`);
                return false;
            }

            console.log(`${this.tag} Login butonuna tıklanıyor...`);
            await loginButton.click();

            console.log(`${this.tag} ✅ Otomatik login yapıldı, sayfa yükleniyor...`);

            // Navigation başlaması için kısa bekleme
            await sleep(3000);

            return true; // Otomatik login yapıldı

        } catch (error) {
            console.log(`${this.tag} Otomatik login hatası: ${error.message}`);
            return false; // Hata oldu ama devam et
        }
    }


    /**
     * ADIM 2: Operatör Kararı (Manuel Kontrol)
     */
    async getOperatorDecision() {
        console.log(`${this.tag} Adım 2: 10sn bekleniyor ve operatör kararı sorulacak...`);
        await sleep(10000); // Sayfanın ve varsa checkpoint'in yüklenmesi için süre

        // Kararı sor: SUCCESS veya FAILED
        const decision = await OperatorUI.askForStatus(this.page);
        console.log(`${this.tag} Operatör Kararı: ${decision.toUpperCase()}`);
        return decision;
    }

    /**
     * ADIM 3: Finalizasyon (Başarılı ise)
     */
    async finalizeSuccess() {
        console.log(`${this.tag} Adım 3: İşlem başarıyla tamamlanıyor...`);

        // 1. Dil ayarlarına git
        try {
            console.log(`${this.tag} Dil ayarlarına gidiliyor...`);
            await this.page.goto('https://www.facebook.com/settings/?tab=language', { waitUntil: 'networkidle2', timeout: 60000 });
            await handlePopups(this.page);
        } catch (e) {
            console.log(`${this.tag} Ayarlar sayfası uyarısı: ${e.message}`);
        }

        // 2. Dil değişimi için bekle (Hazır olunca devam et)
        await OperatorUI.waitForReady(this.page, 'Lütfen dili İngilizce yapın ve HAZIR butonuna basın.');

        // 3. Vision notlarını güncelle
        const noteLines = [
            `Kullanıcı: ${this.account.username}`,
            `Şifre: ${this.account.password}`,
            `Durum: Operatör Onaylı`,
            `Tarih: ${new Date().toLocaleString('tr-TR')}`
        ];

        const newNotes = noteLines.join('\n');
        await VisionProfileService.updateProfileNotes(this.profile.id, this.profile.folderId, newNotes);

        // 4. Raporla
        await PanelAPI.updateAccountStatus(this.account.id, 'success');
        await sendLog('success', 'FB_LOGIN', `✅ İşlem Tamamlandı: ${this.account.username}`);
    }

    /**
     * ADIM 3: Temizlik (Hatalı ise)
     */
    async finalizeFailure() {
        console.log(`${this.tag} Adım 3: Hatalı işlem temizliği...`);

        // Browser kapat
        if (this.browser) await this.browser.disconnect();

        // Profili DURDUR ve SİL
        await sleep(2000);
        await VisionProfileService.stopProfile(this.profile.folderId, this.profile.id);
        await sleep(3000); // Durması için bekle
        await VisionProfileService.deleteProfile(this.profile.folderId, this.profile.id);

        // Raporla
        await PanelAPI.updateAccountStatus(this.account.id, 'login_failed', { errorMessage: 'Operatör tarafından reddedildi' });
        await sendLog('error', 'FB_LOGIN', `❌ Operatör Reddi: ${this.account.username}`);
    }

    /**
     * Genel Temizlik (Her durumda çalışır - Sadece browser kapatma ve durdurma)
     * Not: Failed durumunda profil zaten silinmiş oluyor, double check yapıyoruz
     */
    async cleanup() {
        if (this.browser) {
            try { await this.browser.disconnect(); } catch (e) { }
        }
        if (this.profile) {
            // Sadece durdurmayı dene, silinmiş olabilir hata vermesin
            try { await VisionProfileService.stopProfile(this.profile.folderId, this.profile.id); } catch (e) { }
        }
    }
}

/**
 * Ana işlem fonksiyonu
 */
async function processAccount(account, threadId = 1) {
    const job = new FacebookLoginJob(account, threadId);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Thread-${threadId}:FBLogin] İşleniyor: ${account.username}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
        // 1. Başlat - false dönerse (proxy hatası) işlemi atla
        const initialized = await job.initializeStack();
        if (initialized === false) {
            console.log(`${job.tag} İşlem atlandt (inisilization başarısız)`);
            return; // cleanup'a git
        }

        // 2. Operatör Kararı
        const decision = await job.getOperatorDecision();

        // 3. Karara göre işlem
        if (decision === 'success') {
            await job.finalizeSuccess();
            // Başarılı durumda profili koruyoruz (cleanup sadece browser kapatır)
        } else {
            await job.finalizeFailure();
            // Hatalı durumda profil silindi
        }

    } catch (error) {
        console.error(`${job.tag} KRİTİK HATA: ${error.message}`);
        await PanelAPI.updateAccountStatus(account.id, 'login_failed', { errorMessage: error.message });

    } finally {
        await job.cleanup();
    }
}

/**
 * Modül Başlatma
 */
async function initialize() {
    console.log('[FBLogin] Modül başlatılıyor...');
    ProxyIPService.initialize();
    await VisionProfileService.loadProxies();

    if (!VisionProfileService.isProxyCacheLoaded()) {
        console.error('[FBLogin] HATA: Proxy cache yüklenemedi!');
        return false;
    }
    return true;
}

// Helper exports
async function hasPendingAccounts() { return (await PanelAPI.shouldProcess()).shouldProcess; }
async function getNextAccount() { return await PanelAPI.getNextPendingAccount(); }

module.exports = {
    processAccount,
    initialize,
    hasPendingAccounts,
    getNextAccount,
    FacebookLoginJob
};
