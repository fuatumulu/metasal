/**
 * Mobil Proxy IP Değiştirme Yöneticisi
 * 
 * ENV'den proxy config yükler ve carrier bazlı IP değişikliği yönetir.
 * Aynı carrier'ı kullanan profiller aynı anda çalışamaz.
 */

const axios = require('axios');

// ENV'den yüklenen proxy config (host:port -> changeUrl)
const proxyConfig = new Map();

// Carrier durumları (host:port -> { locked, lastChangeTime, changePending })
const carrierState = new Map();

// Ayarlar
const CHANGE_TIMEOUT = parseInt(process.env.PROXY_CHANGE_TIMEOUT) || 60000;
const CHANGE_COOLDOWN = parseInt(process.env.PROXY_CHANGE_COOLDOWN) || 30000;
const CHANGE_RETRY_WAIT = 60000; // Failure sonrası bekleme

/**
 * ENV'den proxy config'lerini yükle
 * Format: PROXY_CHANGE_X=host:port|change_url
 */
function loadProxyConfig() {
    proxyConfig.clear();

    // PROXY_CHANGE_ ile başlayan tüm env değişkenlerini bul
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('PROXY_CHANGE_') && value && value.includes('|')) {
            const [hostPort, changeUrl] = value.split('|');
            if (hostPort && changeUrl) {
                proxyConfig.set(hostPort.trim(), changeUrl.trim());
                console.log(`[ProxyManager] Config yüklendi: ${hostPort} -> ${changeUrl}`);
            }
        }
    }

    console.log(`[ProxyManager] Toplam ${proxyConfig.size} proxy config yüklendi`);
    return proxyConfig.size;
}

/**
 * Varsayılan proxy host'u getir (tek carrier varsa onu kullan)
 */
function getDefaultProxyHost() {
    if (proxyConfig.size === 0) {
        return null;
    }
    // İlk config'i döndür
    const firstKey = proxyConfig.keys().next().value;
    console.log(`[ProxyManager] Varsayılan carrier: ${firstKey}`);
    return firstKey;
}

/**
 * Proxy host için change URL getir
 */
function getChangeUrl(proxyHost) {
    return proxyConfig.get(proxyHost) || null;
}

/**
 * Carrier durumunu getir (yoksa oluştur)
 */
function getCarrierState(proxyHost) {
    if (!carrierState.has(proxyHost)) {
        carrierState.set(proxyHost, {
            locked: false,
            lastChangeTime: 0,
            changePending: false,
            activeProfileId: null
        });
    }
    return carrierState.get(proxyHost);
}

/**
 * Carrier müsait mi kontrol et
 * - Kilitli değilse VE cooldown geçmişse müsait
 */
function isCarrierAvailable(proxyHost) {
    const state = getCarrierState(proxyHost);

    if (state.locked || state.changePending) {
        return false;
    }

    const timeSinceLastChange = Date.now() - state.lastChangeTime;
    if (state.lastChangeTime > 0 && timeSinceLastChange < CHANGE_COOLDOWN) {
        const remaining = Math.ceil((CHANGE_COOLDOWN - timeSinceLastChange) / 1000);
        console.log(`[ProxyManager] Carrier ${proxyHost} cooldown'da, ${remaining}sn kaldı`);
        return false;
    }

    return true;
}

/**
 * Carrier'ı kilitle - ATOMIK: kontrol ve kilitleme tek seferde
 * Race condition'ı önler
 * @returns {boolean} Başarılı ise true, carrier meşgulse false
 */
function tryLockCarrier(proxyHost, profileId) {
    const state = getCarrierState(proxyHost);

    // Zaten kilitli veya change pending ise başarısız
    if (state.locked || state.changePending) {
        console.log(`[ProxyManager] Carrier ${proxyHost} zaten kilitli (Aktif profil: ${state.activeProfileId})`);
        return false;
    }

    // Cooldown kontrolü
    const timeSinceLastChange = Date.now() - state.lastChangeTime;
    if (state.lastChangeTime > 0 && timeSinceLastChange < CHANGE_COOLDOWN) {
        const remaining = Math.ceil((CHANGE_COOLDOWN - timeSinceLastChange) / 1000);
        console.log(`[ProxyManager] Carrier ${proxyHost} cooldown'da, ${remaining}sn kaldı`);
        return false;
    }

    // Kilitle (atomik - await yok araya giremez)
    state.locked = true;
    state.activeProfileId = profileId;
    console.log(`[ProxyManager] Carrier kilitlendi: ${proxyHost} (Profil: ${profileId})`);
    return true;
}

/**
 * Carrier'ı kilitle (eski API - geriye uyumluluk)
 */
function lockCarrier(proxyHost, profileId) {
    const state = getCarrierState(proxyHost);
    state.locked = true;
    state.activeProfileId = profileId;
    console.log(`[ProxyManager] Carrier kilitlendi: ${proxyHost} (Profil: ${profileId})`);
}

/**
 * Carrier kilidini aç
 */
function unlockCarrier(proxyHost) {
    const state = getCarrierState(proxyHost);
    state.locked = false;
    state.activeProfileId = null;
    console.log(`[ProxyManager] Carrier kilidi açıldı: ${proxyHost}`);
}

/**
 * IP değiştir - GET isteği at ve sonucu kontrol et
 * Success olana kadar retry yapar (60sn aralıkla)
 */
async function changeIP(proxyHost) {
    const changeUrl = getChangeUrl(proxyHost);

    if (!changeUrl) {
        console.log(`[ProxyManager] ${proxyHost} için change URL tanımlı değil, atlanıyor`);
        return true; // Config yoksa başarılı kabul et
    }

    const state = getCarrierState(proxyHost);
    state.changePending = true;
    // Cooldown'u IP change başlarken başlat (IP change süresi cooldown'a dahil olsun)
    state.lastChangeTime = Date.now();

    console.log(`[ProxyManager] IP değiştirme başlatıldı: ${proxyHost}`);
    console.log(`[ProxyManager] Change URL: ${changeUrl}`);

    let success = false;
    let attempts = 0;

    while (!success) {
        attempts++;
        console.log(`[ProxyManager] Change denemesi #${attempts}...`);

        try {
            const response = await axios.get(changeUrl, {
                timeout: CHANGE_TIMEOUT
            });

            const data = response.data;
            console.log(`[ProxyManager] Change yanıtı:`, JSON.stringify(data));

            if (data.result === 'success') {
                console.log(`[ProxyManager] ✓ IP değiştirildi: ${data.EXT_IP1} -> ${data.EXT_IP2}`);
                console.log(`[ProxyManager] Yeni IP: ${data.ext_ip}, Süre: ${data.total_time}sn`);
                success = true;
                // Başarılı olunca lastChangeTime'ı güncelle (cooldown tam olarak şu andan itibaren)
                state.lastChangeTime = Date.now();
            } else {
                // Failure - 60sn bekle ve tekrar dene
                console.log(`[ProxyManager] ✗ Change başarısız: ${data.message}`);
                console.log(`[ProxyManager] 60 saniye sonra tekrar denenecek...`);
                await sleep(CHANGE_RETRY_WAIT);
            }
        } catch (error) {
            console.error(`[ProxyManager] Change hatası: ${error.message}`);
            console.log(`[ProxyManager] 60 saniye sonra tekrar denenecek...`);
            await sleep(CHANGE_RETRY_WAIT);
        }
    }

    state.changePending = false;
    return success;
}

/**
 * Müsait carrier sayısını getir (dinamik thread sayısı için)
 */
function getAvailableCarrierCount() {
    let count = 0;
    for (const [host] of proxyConfig) {
        if (isCarrierAvailable(host)) {
            count++;
        }
    }
    return count;
}

/**
 * Toplam carrier sayısını getir
 */
function getTotalCarrierCount() {
    return proxyConfig.size;
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    loadProxyConfig,
    getChangeUrl,
    getDefaultProxyHost,
    isCarrierAvailable,
    tryLockCarrier,
    lockCarrier,
    unlockCarrier,
    changeIP,
    getAvailableCarrierCount,
    getTotalCarrierCount
};
