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
const PasswordChangeService = require('./PasswordChangeService');

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

        // Proxy değiştir
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
                // Bekleme süresi yoksa direkt hata ver
                throw new Error(`Proxy IP değiştirilemedi: ${result.message}`);
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

        // Facebook'a git
        console.log(`${this.tag} Facebook açılıyor...`);
        await this.page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 60000 });
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

        // 1. Dil ayarlarına git (Kullanıcı talebi)
        try {
            console.log(`${this.tag} Dil ayarlarına gidiliyor...`);
            await this.page.goto('https://www.facebook.com/settings/?tab=language', { waitUntil: 'networkidle2', timeout: 60000 });
            await handlePopups(this.page);
        } catch (e) {
            console.log(`${this.tag} Ayarlar sayfası uyarısı: ${e.message}`);
        }

        // 2. Dil değişimi için bekle (Hazır olunca devam et)
        await OperatorUI.waitForReady(this.page, 'Lütfen dili İngilizce yapın (Account Center için gerekli) ve HAZIR butonuna basın.');

        // 3. Şifre değiştir (Otomatik)
        console.log(`${this.tag} Şifre değiştirme işlemi başlatılıyor...`);
        const changeResult = await PasswordChangeService.changePassword(this.page, this.account.password);

        // 4. SON KONTROL (Kullanıcı Talebi)
        // Şifre değişiminden sonra ana sayfaya git ve son durumu sor
        console.log(`${this.tag} Son kontrol için ana sayfaya gidiliyor...`);
        try {
            await this.page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) { }

        console.log(`${this.tag} Operatöre SON DURUM soruluyor...`);
        const finalDecision = await OperatorUI.askForStatus(this.page);

        let finalPassword = this.account.password;

        if (finalDecision === 'success') {
            // Şifre değişimi başarılı ise yeni şifreyi kaydet, değilse eskisi kalsın
            if (changeResult.success) {
                finalPassword = changeResult.newPassword;
                console.log(`${this.tag} ✅ Şifre değiştirildi ve onaylandı: ${finalPassword}`);
            } else {
                console.log(`${this.tag} ⚠️ Şifre değiştirilemedi ama operatör onayladı.`);
            }

            // 5. Vision notlarını güncelle
            const newNotes = [
                `Kullanıcı: ${this.account.username}`,
                `Şifre: ${finalPassword} ${changeResult.success ? '(YENİ)' : '(Eski)'}`,
                `Durum: Operatör Onaylı (Final)`,
                `Tarih: ${new Date().toLocaleString('tr-TR')}`
            ].join('\n');

            await VisionProfileService.updateProfileNotes(this.profile.id, this.profile.folderId, newNotes);

            // 6. Raporla
            await PanelAPI.updateAccountStatus(this.account.id, 'success');
            await sendLog('success', 'FB_LOGIN', `✅ İşlem Tamamlandı ve Onaylandı: ${this.account.username}`);
        } else {
            console.log(`${this.tag} ❌ Operatör son adımda REDDETTİ.`);
            throw new Error('Operatör tarafından son kontrolde reddedildi');
        }
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
        // 1. Başlat
        await job.initializeStack();

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
        await job.reportFailure('error', error.message); // Bu metod eski class'ta kaldı, manuel yapalım:
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
