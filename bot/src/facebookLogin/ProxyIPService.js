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
 * @returns {boolean} - Başarılı mı
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
        return true; // Config yoksa başarılı kabul et (sabit IP proxy olabilir)
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
            return true;
        } else {
            console.log(`[FBLogin:ProxyIP] ⚠️ IP değişimi yanıtı: ${data.message || JSON.stringify(data)}`);
            return true; // Yine de devam et
        }
    } catch (error) {
        console.error(`[FBLogin:ProxyIP] IP değiştirme hatası: ${error.message}`);
        return false;
    }
}

module.exports = {
    initialize,
    changeProxyIP
};
