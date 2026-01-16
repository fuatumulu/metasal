/**
 * Proxy IP Change Service - Mobil proxy IP değiştirme
 * SRP: Sadece proxy IP değiştirme işlemleri
 * 
 * Değişim nedeni: Proxy sağlayıcısı API'si değişirse
 * 
 * Not: Ana bot'un proxyManager.js modülünü kullanır
 */

const { loadProxyConfig, getChangeUrl, changeIP } = require('../proxyManager');

// Proxy config cache
let configLoaded = false;

/**
 * Proxy config'leri yükle (bir kere çağrılmalı)
 */
function initialize() {
    if (!configLoaded) {
        loadProxyConfig();
        configLoaded = true;
    }
}

/**
 * Verilen proxy IP'si için IP değiştir
 * @param {string} proxyIP - Proxy IP adresi (host veya host:port)
 * @returns {boolean} - Başarılı mı
 */
async function changeProxyIP(proxyIP) {
    initialize();

    // host:port formatına çevir (port yoksa ekle)
    let proxyHost = proxyIP;
    if (!proxyHost.includes(':')) {
        // Varsayılan port ekle (genellikle mobil proxy'ler için)
        proxyHost = `${proxyIP}:80`;
    }

    // Change URL var mı kontrol et
    const changeUrl = getChangeUrl(proxyHost);

    if (!changeUrl) {
        // Port olmadan dene
        const hostOnly = proxyIP.split(':')[0];
        // Tüm port kombinasyonlarını dene
        const ports = ['80', '8080', '3128', ''];

        for (const port of ports) {
            const tryHost = port ? `${hostOnly}:${port}` : hostOnly;
            const tryUrl = getChangeUrl(tryHost);
            if (tryUrl) {
                proxyHost = tryHost;
                break;
            }
        }
    }

    const finalChangeUrl = getChangeUrl(proxyHost);
    if (!finalChangeUrl) {
        console.log(`[FBLogin:ProxyIP] ${proxyIP} için change URL bulunamadı, IP değişimi atlanıyor`);
        return true; // Config yoksa başarılı kabul et (sabit IP proxy olabilir)
    }

    console.log(`[FBLogin:ProxyIP] IP değiştiriliyor: ${proxyHost}`);

    try {
        const success = await changeIP(proxyHost);
        if (success) {
            console.log(`[FBLogin:ProxyIP] ✅ IP başarıyla değiştirildi: ${proxyHost}`);
        }
        return success;
    } catch (error) {
        console.error(`[FBLogin:ProxyIP] IP değiştirme hatası: ${error.message}`);
        return false;
    }
}

module.exports = {
    initialize,
    changeProxyIP
};
