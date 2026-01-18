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
async function changePassword(page, currentPassword) {
    const newPassword = generateStrongPassword();
    console.log(`[PasswordChange] Şifre değiştirme işlemi başlıyor...`);
    console.log(`[PasswordChange] Yeni şifre belirlendi: ${newPassword}`);

    try {
        // 1. Password change sayfasına git
        console.log('[PasswordChange] 1. Şifre değiştirme sayfasına gidiliyor...');
        await page.goto('https://accountscenter.facebook.com/password_and_security/password/change', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await sleep(5000);

        // 2. Hesap seçimi (Popup) - Eğer birden fazla hesap varsa veya yapı gereği
        // Genelde bir liste çıkar, Facebook hesabını seçmek gerekir.
        console.log('[PasswordChange] 2. Hesap seçimi kontrol ediliyor...');

        // Modalın yüklenmesi için bekle
        try {
            // Facebook hesabını seç (Genellikle isminde "Facebook" geçen veya bir liste elemanı)
            // Strateji: role="dialog" içindeki listbox/listitem'lara bak
            await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
            console.log('[PasswordChange] Hesap seçim dialogu bulundu.');

            const accountSelected = await page.evaluate(() => {
                // Dialog içindeki tıklanabilir öğeleri bul
                const dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) return false;

                // role="button" veya role="listitem" veya a tag'i
                // Genellikle Facebook logosu veya "Facebook" yazısı olur
                const items = Array.from(dialog.querySelectorAll('div[role="button"], div[role="listitem"], a'));

                for (const item of items) {
                    const text = item.innerText || item.textContent || '';
                    // Facebook hesabını bulmaya çalış (Instagram değil)
                    if (text.toLowerCase().includes('facebook')) {
                        item.click();
                        return true;
                    }
                }

                // Eğer spesifik bulamazsa ilkine tıkla (muhtemelen tek hesap vardır)
                if (items.length > 0) {
                    items[0].click();
                    return true;
                }
                return false;
            });

            if (accountSelected) {
                console.log('[PasswordChange] Hesap seçimi yapıldı, form bekleniyor...');
                await sleep(5000);
            } else {
                console.log('[PasswordChange] Hesap seçimi yapılamadı veya gerekmedi.');
            }

        } catch (e) {
            console.log('[PasswordChange] Hesap seçim dialogu çıkmadı, doğrudan form olabilir.');
        }

        // 3. Şifre formunu doldur
        console.log('[PasswordChange] 3. Şifre formu dolduruluyor...');

        // Inputları bekle (name niteliği en güvenilir olanıdır)
        // current_password, new_password, new_password_confirm gibi name'ler beklenir
        // Ancak Accounts Center'da genelde:
        // 1. Mevcut şifre
        // 2. Yeni şifre
        // 3. Yeni şifre tekrar

        // Selector stratejisi: input type="password"
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });

        const filled = await page.evaluate((curr, newPass) => {
            const inputs = Array.from(document.querySelectorAll('input[type="password"]'));

            if (inputs.length < 3) return false;

            // React/Framework inputlarını doldurmak için native value setter
            const setNativeValue = (element, value) => {
                const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
                const prototype = Object.getPrototypeOf(element);
                const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

                if (valueSetter && valueSetter !== prototypeValueSetter) {
                    prototypeValueSetter.call(element, value);
                } else {
                    valueSetter.call(element, value);
                }

                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            };

            // 1. Mevcut şifre
            setNativeValue(inputs[0], curr);

            // 2. Yeni şifre
            setNativeValue(inputs[1], newPass);

            // 3. Yeni şifre tekrar
            setNativeValue(inputs[2], newPass);

            return true;
        }, currentPassword, newPassword);

        if (!filled) {
            throw new Error('Şifre inputları bulunamadı (en az 3 adet password input olmalı)');
        }

        console.log('[PasswordChange] Form dolduruldu, "Change Password" butonu aranıyor...');
        await sleep(2000);

        // 4. "Change password" butonuna tıkla
        // button[type="submit"] veya "Change password" metni
        const clicked = await page.evaluate(() => {
            const submitTargets = ['change password', 'şifreyi değiştir', 'şifre değiştir', 'save changes'];

            // Submit butonları
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));

            // Önce disabled olmayan submit butonuna bak
            // Accounts Center'da genelde buton mavidir ve aktiftir

            for (const btn of buttons) {
                const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();

                // Metin kontrolü
                if (submitTargets.some(t => text.includes(t))) {
                    // Disabled kontrolü
                    if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
                        continue;
                    }

                    btn.click();
                    return true;
                }
            }

            // Bulamazsa type="submit" olan ilk aktif butona tıkla (form içindeki)
            const submitBtn = document.querySelector('button[type="submit"]:not([disabled])');
            if (submitBtn) {
                submitBtn.click();
                return true;
            }

            return false;
        });

        if (!clicked) {
            throw new Error('Onay butonu (Change Password) bulunamadı veya tıklanamadı');
        }

        console.log('[PasswordChange] Butona tıklandı, sonuç bekleniyor...');

        // 5. Başarı kontrolü
        // Başarılı olduğunda ya yönlendirme olur ya da bir toast mesajı çıkar
        // Hata olduğunda inputların altında uyarı çıkar

        await sleep(5000);

        // Hata var mı kontrol et
        const errorText = await page.evaluate(() => {
            // Hata mesajları genellikle alert role veya kırmızı metinlerle gösterilir
            const alerts = document.querySelectorAll('[role="alert"]');
            if (alerts.length > 0) return alerts[0].innerText;
            return null;
        });

        if (errorText) {
            throw new Error(`Facebook şifre değişimini reddetti: ${errorText}`);
        }

        // URL değişti mi veya "Stay logged in" popup'ı geldi mi?
        // Başarı durumunda genellikle "Log out of other devices" veya benzeri bir popup gelir
        // Ya da doğrudan settings sayfasına atar

        console.log('[PasswordChange] Şifre değiştirme işlemi başarılı görünüyor.');
        await sendLog('success', 'PASSWORD_CHANGE', `✅ Şifre başarıyla değiştirildi. Yeni şifre: ${newPassword}`);

        return { success: true, newPassword };

    } catch (error) {
        console.error(`[PasswordChange] HATA: ${error.message}`);
        await sendLog('error', 'PASSWORD_CHANGE_FAILED', `Şifre değiştirme hatası: ${error.message}`);
        return { success: false, error: error.message };
    }
}

module.exports = {
    changePassword,
    generateStrongPassword
};
