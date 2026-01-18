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
 * Şifre değiştirme akışını yürüt
 * @param {object} page - Puppeteer page
 * @param {string} currentPassword - Mevcut şifre
 * @returns {object} - { success: boolean, newPassword: string, error: string }
 */
/**
 * İnsan gibi yazma simülasyonu
 */
async function humanType(page, selector, text) {
    await page.focus(selector);
    for (const char of text) {
        await page.keyboard.type(char, { delay: 100 + Math.random() * 100 });
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

        // Mevcut şifre
        await humanType(page, 'input[type="password"]:nth-of-type(1)', currentPassword); // Veya inputs[0] handle ile
        // Puppeteer nth-of-type bazen sorun olabilir, sırayla focus yapalım:

        // Temiz bir yöntem:
        await page.evaluate(() => {
            const inps = document.querySelectorAll('input[type="password"]');
            inps.forEach(i => i.value = ''); // Önce temizle
        });

        // 1. Mevcut
        await inputs[0].type(currentPassword, { delay: 100 });
        await sleep(500);

        // 2. Yeni
        await inputs[1].type(newPassword, { delay: 100 });
        await sleep(500);

        // 3. Yeni tekrar
        await inputs[2].type(newPassword, { delay: 100 });
        await sleep(1000);

        // 4. Change Password Butonu
        console.log('[PasswordChange] "Change password" butonu tıklanıyor...');

        // Kullanıcının verdiği yapıya göre Span bulup tıklıyoruz
        const clicked = await page.evaluate(() => {
            // Span içindeki metni kontrol et
            const spans = Array.from(document.querySelectorAll('span'));
            for (const span of spans) {
                const text = span.textContent?.toLowerCase()?.trim();
                // "change password" veya "şifreyi değiştir" gibi
                if (text === 'change password' || text === 'şifreyi değiştir') {
                    // Tıklanabilir üst elemanı bul (button veya role=button)
                    let parent = span.parentElement;
                    while (parent && parent.tagName !== 'BODY') {
                        if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
                            parent.click();
                            return true;
                        }
                        parent = parent.parentElement;
                    }
                    // Eğer parent button bulamazsa direkt span'a tıkla (bazen çalışır)
                    span.click();
                    return true;
                }
            }

            // Yedek: type submit
            const btn = document.querySelector('button[type="submit"]');
            if (btn && !btn.disabled) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!clicked) throw new Error('Change Password butonu bulunamadı');

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
