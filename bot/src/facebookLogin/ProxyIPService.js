/**
 * Proxy IP Change Service - Mobil proxy IP değiştirme
 * SRP: Sadece proxy IP değiştirme işlemleri
 * 
 * Değişim nedeni: Proxy sağlayıcısı API'si değişirse
 * 
 * Not: Ana bot'un proxyManager.js modülünü kullanır
 */

const axios = require('axios');
const { loadProxyConfig, getChangeUrlByHost } = require('../proxyManager');

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
 * @param {string} proxyIP - Proxy IP adresi (sadece HOST, port olmadan)
 * @returns {object} - { success: boolean, waitSeconds?: number }
 */
async function changeProxyIP(proxyIP) {
    initialize();

    // IP|HOST ayrımı
    let hostOnly;
    if (proxyIP.includes('|')) {
        // Eğer | varsa, sağ taraf (HOST) change işlemi için kullanılır
        hostOnly = proxyIP.split('|')[1];
    } else {
        // Yoksa sol taraf (IP) portsuz olarak kullanılır
        hostOnly = proxyIP.split(':')[0];
    }

    // Change URL bul (manuel host veya IP ile)
    const changeUrl = getChangeUrlByHost(hostOnly);

    if (!changeUrl) {
        console.log(`[FBLogin:ProxyIP] ${hostOnly} için change URL bulunamadı, IP değişimi atlanıyor`);
        return { success: true, ignored: true }; // Config yoksa başarılı kabul et
    }

    console.log(`[FBLogin:ProxyIP] IP değiştiriliyor: ${hostOnly}`);
    console.log(`[FBLogin:ProxyIP] Change URL: ${changeUrl}`);

    try {
        const response = await axios.get(changeUrl, { timeout: 60000 });

        const data = response.data;
        console.log(`[FBLogin:ProxyIP] Yanıt:`, JSON.stringify(data));

        if (data.result === 'success') {
            console.log(`[FBLogin:ProxyIP] ✅ IP başarıyla değiştirildi`);
            console.log(`[FBLogin:ProxyIP] Eski: ${data.EXT_IP1} -> Yeni: ${data.EXT_IP2 || data.ext_ip}`);
            return { success: true };
        } else {
            console.log(`[FBLogin:ProxyIP] ⚠️ IP değişimi başarısız: ${data.message || JSON.stringify(data)}`);

            // Wait süresi analizi
            let waitSeconds = 0;
            if (data.message && data.message.includes('MINIMUM_TIME_BETWEEN_ROTATIONS')) {
                // "stop_reason, MINIMUM_TIME_BETWEEN_ROTATIONS 60, TIME_SINCE_LAST_ROTATION 31, retry later"
                try {
                    const minTime = parseInt(data.message.match(/MINIMUM_TIME_BETWEEN_ROTATIONS (\d+)/)[1]);
                    const lastTime = parseInt(data.message.match(/TIME_SINCE_LAST_ROTATION (\d+)/)[1]);
                    if (!isNaN(minTime) && !isNaN(lastTime)) {
                        waitSeconds = (minTime - lastTime) + 5; // +5 saniye güvenlik payı
                    }
                } catch (e) {
                    waitSeconds = 30; // Parse hatası olursa varsayılan 30sn
                }
            }

            return { success: false, message: data.message, waitSeconds };
        }
    } catch (error) {
        console.error(`[FBLogin:ProxyIP] IP değiştirme hatası: ${error.message}`);
        return { success: false, message: error.message };
    }
}

module.exports = {
    initialize,
    changeProxyIP
};
