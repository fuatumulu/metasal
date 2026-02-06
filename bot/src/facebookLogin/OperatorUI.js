/**
 * Operator UI - Operatör müdahalesi bekleme arayüzü
 * SRP: Sadece operatör etkileşimi (UI)
 * 
 * Değişim nedeni: Operatör UI gereksinimleri değişirse
 */

const { sendLog } = require('../api');

const UI_STYLES = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    max-width: 320px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    z-index: 999999;
    font-family: system-ui, -apple-system, sans-serif;
    border: 1px solid #e2e8f0;
    animation: slideIn 0.5s ease-out;
`;

const ANIMATION_STYLE = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;

/**
 * Status modal'ını inject et (helper fonksiyon)
 * @param {object} page 
 */
async function injectStatusModal(page) {
    try {
        await page.evaluate((styles, animParams) => {
            // Varsa temizle
            const old = document.getElementById('operator-overlay');
            if (old) old.remove();

            const style = document.createElement('style');
            style.textContent = animParams;
            document.head.appendChild(style);

            const overlay = document.createElement('div');
            overlay.id = 'operator-overlay';
            overlay.style.cssText = styles;

            overlay.innerHTML = `
                <h3 style="margin: 0 0 15px 0; color: #1a202c; font-size: 18px; font-weight: 600;">Hesap Durumu Nedir?</h3>
                <p style="color: #4a5568; margin-bottom: 20px; font-size: 14px;">Lütfen kontrol edip karar verin.</p>
                
                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button id="btn-failed" style="
                        flex: 1;
                        padding: 12px;
                        font-size: 14px;
                        font-weight: 600;
                        background: #fc8181;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">❌ HATALI</button>
                    
                    <button id="btn-success" style="
                        flex: 1;
                        padding: 12px;
                        font-size: 14px;
                        font-weight: 600;
                        background: #48bb78;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">✅ BAŞARILI</button>
                </div>
            `;
            document.body.appendChild(overlay);

            // Global değişkeni koru/oluştur
            if (window.__operatorDecision === undefined) {
                window.__operatorDecision = null;
            }

            document.getElementById('btn-failed').onclick = () => {
                window.__operatorDecision = 'failed';
                overlay.innerHTML = '<p style="color: #c53030; font-weight: 600;">❌ İŞARETLENDİ: HATALI</p>';
            };

            document.getElementById('btn-success').onclick = () => {
                window.__operatorDecision = 'success';
                overlay.innerHTML = '<p style="color: #2f855a; font-weight: 600;">✅ İŞARETLENDİ: BAŞARILI</p>';
            };

        }, styles, animParams);
    } catch (e) {
        // Sayfa yükleniyorsa veya context kaybolmuşsa yutalım
    }
}

/**
 * Operatörden durum onayı iste (Başarılı / Hatalı) - PERSISTENT
 * @param {object} page 
 * @returns {Promise<string>} 'success' | 'failed'
 */
async function askForStatus(page) {
    console.log(`[FBLogin:Operator] ⏳ Operatör kararı bekleniyor (Persistent modal)...`);

    // İlk injection
    await injectStatusModal(page, UI_STYLES, ANIMATION_STYLE);

    // Kararı bekle - Context error handling ile + Persistent modal
    while (true) {
        try {
            // 1. Karar kontrolü
            const decision = await page.evaluate(() => window.__operatorDecision);
            if (decision) {
                await new Promise(r => setTimeout(r, 1000)); // Görsel geri bildirim için kısa bekleme
                return decision;
            }

            // 2. Modal hala var mı? (sayfa değişmiş olabilir - 2FA, checkpoint vs)
            const hasOverlay = await page.evaluate(() => !!document.getElementById('operator-overlay'));
            if (!hasOverlay) {
                console.log(`[FBLogin:Operator] Modal kayboldu (sayfa değişti), tekrar inject ediliyor...`);
                await injectStatusModal(page, UI_STYLES, ANIMATION_STYLE);
            }

        } catch (e) {
            // Context kaybolmuş olabilir (sayfa yenileniyor, navigation vs)
            // Sessizce atla, bir sonraki döngüde tekrar dene
            console.log(`[FBLogin:Operator] Context geçici olarak kayboldu, devam ediliyor...`);
        }
        await new Promise(r => setTimeout(r, 2000)); // 2 saniyede bir kontrol (context error toleransı için artırıldı)
    }

}

/**
 * Operatörün "Hazır" demesini bekle (Dil değişimi vs. için)
 * Sayfa yenilense bile overlay'i tekrar inject eder.
 * @param {object} page
 * @param {string} taskDescription
 */
async function waitForReady(page, taskDescription) {
    console.log(`[FBLogin:Operator] ⏳ Operatör bekleniyor: ${taskDescription}`);

    // Injector fonksiyonu
    const injectOverlay = async () => {
        try {
            await page.evaluate((msg, styles, animParams) => {
                if (document.getElementById('operator-overlay')) return;

                const style = document.createElement('style');
                style.textContent = animParams;
                document.head.appendChild(style);

                const overlay = document.createElement('div');
                overlay.id = 'operator-overlay';
                overlay.style.cssText = styles;

                overlay.innerHTML = `
                    <div style="font-size: 24px; margin-bottom: 10px;">🌐</div>
                    <h3 style="margin: 0 0 10px 0; color: #1a202c; font-size: 16px; font-weight: 600;">Müdahale Bekleniyor</h3>
                    <p style="color: #4a5568; margin-bottom: 15px; font-size: 13px; line-height: 1.4;">${msg}</p>
                    <button id="btn-ready" style="
                        width: 100%;
                        padding: 12px;
                        font-size: 14px;
                        font-weight: 600;
                        background: #4299e1;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        transition: all 0.2s;
                    ">hazır (DEVAM ET)</button>
                `;
                document.body.appendChild(overlay);

                // Global değişkeni koru/oluştur
                if (window.__operatorReady === undefined) {
                    window.__operatorReady = false;
                }

                document.getElementById('btn-ready').onclick = () => {
                    window.__operatorReady = true;
                    overlay.innerHTML = '<p style="color: #3182ce; font-weight: 600;">🔄 İşlem Devam Ediyor...</p>';
                };
            }, taskDescription, UI_STYLES, ANIMATION_STYLE);
        } catch (e) {
            // Sayfa o an yükleniyor olabilir, yutalım
        }
    };

    // İlk injection
    await injectOverlay();

    // Polling döngüsü
    while (true) {
        try {
            // 1. Durumu kontrol et
            const ready = await page.evaluate(() => window.__operatorReady);
            if (ready) {
                await new Promise(r => setTimeout(r, 1000));
                return true;
            }

            // 2. Overlay yerinde mi? Değilse (sayfa yenilendi vs) tekrar ekle
            const hasOverlay = await page.evaluate(() => !!document.getElementById('operator-overlay'));
            if (!hasOverlay) {
                await injectOverlay();
            }

        } catch (e) {
            // Context kaybolmuş olabilir (sayfa değişiyor), bekle ve devam et
        }

        await new Promise(r => setTimeout(r, 2000)); // 2 saniyede bir kontrol (context error toleransı için artırıldı)
    }
}

/**
 * Overlay'i temizle
 */
async function clearOverlay(page) {
    try {
        await page.evaluate(() => {
            const el = document.getElementById('operator-overlay');
            if (el) el.remove();
        });
    } catch (e) { }
}

module.exports = {
    askForStatus,
    waitForReady,
    clearOverlay
};
