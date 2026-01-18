/**
 * Password Change Service
 * SRP: Sadece şifre değiştirme işlemleri (UI otomasyonu)
 * 
 * Değişim nedeni: Facebook Account Center UI değişirse
 */

const { sleep } = require('../facebook');
const { sendLog } = require('../api');

/**
 * Güçlü rastgele şifre oluştur
 */
function generateStrongPassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&';
    let password = '';
    // En az 12 karakter
    for (let i = 0; i < 14; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * İnsan gibi yazma simülasyonu (Element Handle üzerinden)
 */
async function typeHumanely(element, text) {
    for (const char of text) {
        await element.type(char, { delay: 50 + Math.random() * 150 });
    }
}

/**
 * Şifre değiştirme akışını yürüt
 * @param {object} page - Puppeteer page
 * @param {string} currentPassword - Mevcut şifre
 * @returns {object} - { success: boolean, newPassword: string, error: string }
 */
async function changePassword(page, currentPassword) {
    const newPassword = generateStrongPassword();
    console.log(`[PasswordChange] Şifre değiştirme işlemi başlıyor...`);
    console.log(`[PasswordChange] Yeni şifre belirlendi: ${newPassword}`);

    try {
        // 1. Password change sayfasına gidiliyor...
        await page.goto('https://accountscenter.facebook.com/password_and_security/password/change', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await sleep(5000);

        // 2. Hesap seçimi (Varsa)
        try {
            // Dialog çıkarsa Facebook olana tıkla
            const accountSelector = 'div[role="dialog"] div[role="button"]';
            const hasDialog = await page.$(accountSelector);

            if (hasDialog) {
                console.log('[PasswordChange] Hesap seçim ekranı, Facebook hesabı seçiliyor...');
                await page.evaluate(() => {
                    const items = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] a'));
                    for (const item of items) {
                        if (item.textContent.toLowerCase().includes('facebook')) {
                            item.click();
                            return;
                        }
                    }
                    if (items.length > 0) items[0].click();
                });
                await sleep(5000);
            }
        } catch (e) { }

        // 3. Form doldur (Human typing)
        console.log('[PasswordChange] Şifre formu dolduruluyor (Human Typing)...');
        await page.waitForSelector('input[type="password"]', { timeout: 20000 });

        const inputs = await page.$$('input[type="password"]');
        if (inputs.length < 3) throw new Error('3 adet şifre inputu bulunamadı');

        // Inputları temizle
        await page.evaluate(() => {
            const inps = document.querySelectorAll('input[type="password"]');
            inps.forEach(i => i.value = '');
        });

        // 1. Mevcut Şifre
        await typeHumanely(inputs[0], currentPassword);
        await sleep(500);

        // 2. Yeni Şifre
        await typeHumanely(inputs[1], newPassword);
        await sleep(500);

        // 3. Yeni Şifre (Tekrar)
        await typeHumanely(inputs[2], newPassword);
        await sleep(1000);

        // 3.5 Validation Tetikle (Blur)
        await page.evaluate(() => {
            const inps = document.querySelectorAll('input[type="password"]');
            if (inps.length > 0) inps[inps.length - 1].blur();
            document.body.click();
        });
        await sleep(1000);

        // 4. Change Password Butonu (Iframe ve Disabled kontrolü)
        console.log('[PasswordChange] "Change password" butonu aranıyor (Iframe ve Status kontrolü)...');

        const contexts = [page, ...page.frames()];
        let clicked = false;

        for (const context of contexts) {
            try {
                // Her frame içinde butonu ara ve aktif olmasını bekle
                const contextClicked = await context.evaluate(async () => {
                    const findBtn = () => {
                        const submitTargets = ['change password', 'şifreyi değiştir', 'şifre değiştir', 'save changes', 'değişiklikleri kaydet'];

                        // 1. Span/Div text kontrolü
                        const spans = Array.from(document.querySelectorAll('span, div, button'));
                        for (const el of spans) {
                            // Text check
                            const text = (el.innerText || el.textContent || '').toLowerCase().trim();
                            if (submitTargets.some(t => text === t || text.includes(t))) {

                                // Tıklanabilir ebeveyni bul
                                let clickable = el;
                                if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
                                    clickable = el.closest('button, [role="button"]') || el;
                                }

                                return clickable;
                            }
                        }

                        // 2. Type submit
                        return document.querySelector('button[type="submit"]');
                    };

                    // Polling ile butonun aktifleşmesini bekle (10 saniye)
                    const startTime = Date.now();
                    while (Date.now() - startTime < 10000) {
                        const btn = findBtn();
                        if (btn) {
                            const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
                            const isDimmed = getComputedStyle(btn).opacity < 0.5 || getComputedStyle(btn).cursor === 'not-allowed';

                            if (!isDisabled && !isDimmed) {
                                btn.click();
                                return true;
                            }
                        }
                        await new Promise(r => setTimeout(r, 500));
                    }
                    return false;
                });

                if (contextClicked) {
                    console.log(`[PasswordChange] Buton bulundu ve tıklandı (Context: ${context === page ? 'Main' : 'Iframe'})`);
                    clicked = true;
                    break;
                }
            } catch (e) {
                // Frame access error pass
            }
        }

        if (!clicked) throw new Error('Change Password butonu bulunamadı veya aktifleşmedi');

        console.log('[PasswordChange] Butona tıklandı. 10 saniye bekleniyor...');
        await sleep(10000); // Kullanıcı isteği: 10sn bekle

        // Başarılı kabul edip dönüyoruz, kontrol index.js'de yapılacak
        return { success: true, newPassword };

    } catch (error) {
        console.error(`[PasswordChange] HATA: ${error.message}`);
        return { success: false, error: error.message };
    }
}

module.exports = {
    changePassword,
    generateStrongPassword
};
