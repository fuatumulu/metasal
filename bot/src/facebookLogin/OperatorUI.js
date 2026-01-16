/**
 * Operator UI - Operatör müdahalesi bekleme arayüzü
 * SRP: Sadece operatör etkileşimi
 * 
 * Değişim nedeni: Operatör UI gereksinimleri değişirse
 */

const { sendLog } = require('../api');

/**
 * Operatör müdahalesi bekle - Ekranda bildirim göster
 * @param {object} page - Puppeteer page
 * @param {string} message - Operatöre gösterilecek mesaj
 * @param {number} timeout - Maksimum bekleme süresi (ms)
 * @returns {boolean} - Operatör tamamlandı mı
 */
async function waitForOperator(page, message, timeout = 300000) {
    console.log(`[FBLogin:Operator] ⏳ OPERATÖR BEKLENİYOR: ${message}`);
    await sendLog('warning', 'OPERATOR_WAIT', `⏳ OPERATÖR BEKLENİYOR: ${message}`);

    // Sayfaya bildirim overlay'i ekle
    await page.evaluate((msg) => {
        // Mevcut overlay'i kaldır (varsa)
        const existingOverlay = document.getElementById('operator-overlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'operator-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            flex-direction: column;
        `;
        overlay.innerHTML = `
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 50px; border-radius: 20px; text-align: center; max-width: 550px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                <div style="font-size: 64px; margin-bottom: 25px;">⏳</div>
                <h2 style="margin-bottom: 20px; color: white; font-size: 28px; font-weight: 600;">Operatör Bekleniyor</h2>
                <p style="color: rgba(255,255,255,0.9); margin-bottom: 30px; font-size: 18px; line-height: 1.6;">${msg}</p>
                <p style="color: rgba(255,255,255,0.7); font-size: 14px; margin-bottom: 25px;">Gerekli işlemi yaptıktan sonra butona tıklayın</p>
                <button id="operator-done-btn" style="
                    padding: 18px 50px;
                    font-size: 18px;
                    font-weight: 600;
                    background: white;
                    color: #667eea;
                    border: none;
                    border-radius: 12px;
                    cursor: pointer;
                    transition: transform 0.2s, box-shadow 0.2s;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">✅ Tamamlandı</button>
            </div>
        `;
        document.body.appendChild(overlay);

        // Buton tıklama event'i
        document.getElementById('operator-done-btn').onclick = function () {
            overlay.remove();
            window.__operatorDone = true;
        };
    }, message);

    // Operatör tamamlamasını bekle
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const done = await page.evaluate(() => window.__operatorDone === true);
            if (done) {
                console.log('[FBLogin:Operator] ✅ Operatör işlemi tamamladı');
                await page.evaluate(() => { window.__operatorDone = false; });
                return true;
            }
        } catch (e) {
            // Sayfa değişmiş olabilir, overlay kaybolmuştur
            console.log('[FBLogin:Operator] Sayfa değişti, operatör işlemi tamamlanmış sayılıyor');
            return true;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('[FBLogin:Operator] ⚠️ Timeout, operatör beklemesi sona erdi');
    return false;
}

/**
 * Overlay'i temizle
 * @param {object} page - Puppeteer page
 */
async function clearOverlay(page) {
    try {
        await page.evaluate(() => {
            const overlay = document.getElementById('operator-overlay');
            if (overlay) overlay.remove();
        });
    } catch (e) {
        // Sayfa değişmiş olabilir
    }
}

module.exports = {
    waitForOperator,
    clearOverlay
};
