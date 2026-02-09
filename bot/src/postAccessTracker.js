const axios = require('axios');

const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

// Panel'den aktif gönderi erişim track'lerini al
async function getActiveTracks() {
    try {
        const response = await axios.get(`${PANEL_URL}/api/post-access/active`);

        if (response.data.success) {
            return response.data.tracks;
        }

        console.error('[PostAccessTracker] Aktif track\'ler alınamadı:', response.data.message);
        return [];
    } catch (error) {
        console.error('[PostAccessTracker] Aktif track\'ler alınırken hata:', error.message);
        return [];
    }
}

// Erişim sayısını panele gönder
async function updateReachOnPanel(trackId, reach) {
    try {
        const response = await axios.post(`${PANEL_URL}/api/post-access/${trackId}/update-reach`, {
            reach
        });

        if (response.data.success) {
            console.log(`[PostAccessTracker] Erişim güncellendi - Track ID: ${trackId}, Reach: ${reach}`);
        } else {
            console.error('[PostAccessTracker] Erişim güncellenemedi:', response.data.error);
        }
    } catch (error) {
        console.error('[PostAccessTracker] Erişim güncellerken hata:', error.message);
    }
}

// Sayfadan erişim sayısını çek (XPath ile polling)
async function extractReachFromPage(page) {
    try {
        console.log('[DEBUG] XPath ile erişim sayısı aranıyor...');

        // Facebook Insights sayfasındaki erişim sayısının XPath'i
        const xpath = '/html/body/div[1]/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div/div[1]/div/div/div/div/div[2]/div/div[2]';

        // Polling: Element render olana kadar bekle (max 30 saniye, 15 deneme x 2 saniye)
        for (let attempt = 1; attempt <= 15; attempt++) {
            console.log(`[DEBUG] Deneme ${attempt}/15 - XPath elementi aranıyor...`);

            const reach = await page.evaluate((xpath) => {
                // XPath ile elementi bul
                const element = document.evaluate(
                    xpath,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                ).singleNodeValue;

                if (element) {
                    const text = element.textContent.trim();
                    console.log(`[DEBUG] XPath elementi bulundu, içerik: "${text}"`);

                    // Virgüllü sayıyı + K/M/B kısaltmalarını bul: 23,738 veya 102,4K veya 1.2M
                    const match = text.match(/[\d,.]+[KMB]?/i);
                    if (match) {
                        let numStr = match[0];
                        let multiplier = 1;

                        // K, M, B kısaltmalarını kontrol et
                        if (/[Kk]$/.test(numStr)) {
                            multiplier = 1000;
                            numStr = numStr.slice(0, -1); // K'yi çıkar
                            console.log(`[DEBUG] "K" kısaltması tespit edildi, çarpan: 1000`);
                        } else if (/[Mm]$/.test(numStr)) {
                            multiplier = 1000000;
                            numStr = numStr.slice(0, -1); // M'yi çıkar
                            console.log(`[DEBUG] "M" kısaltması tespit edildi, çarpan: 1000000`);
                        } else if (/[Bb]$/.test(numStr)) {
                            multiplier = 1000000000;
                            numStr = numStr.slice(0, -1); // B'yi çıkar
                            console.log(`[DEBUG] "B" kısaltması tespit edildi, çarpan: 1000000000`);
                        }

                        console.log(`[DEBUG] "${match[0]}" kısaltma tespit edildi, çarpan: ${multiplier}`);

                        let number;

                        if (multiplier > 1) {
                            // DURUM 1: Kısaltma VAR (K, M, B)
                            // Bu durumda virgül/nokta ondalık ayraçtır.
                            // Örn: 102,4K -> 102.4  |  1.2M -> 1.2
                            // Tüm virgülleri noktaya çevirip float yapıyoruz
                            const cleanNum = numStr.replace(/,/g, '.');
                            number = parseFloat(cleanNum);
                        } else {
                            // DURUM 2: Kısaltma YOK (Tam Sayı)
                            // Bu durumda virgül/nokta binlik ayraçtır.
                            // Örn: 23,738 -> 23738  |  23.738 -> 23738
                            // Tüm noktalama işaretlerini silip saf sayı yapıyoruz
                            const cleanNum = numStr.replace(/[,.]/g, '');
                            number = parseFloat(cleanNum);
                        }

                        // Çarpma işlemini yap
                        number = Math.round(number * multiplier);

                        console.log(`[DEBUG] Final Sayı: ${number} (Raw: ${match[0]})`);

                        // Geçerli bir sayı mı kontrol et
                        if (number > 0 && number < 10000000000) {
                            return number;
                        }
                    } else {
                        console.log('[DEBUG] Metin içinde sayı formatı bulunamadı');
                    }
                } else {
                    console.log('[DEBUG] XPath elementi henüz render olmamış');
                }

                return null;
            }, xpath);

            if (reach !== null && reach > 0) {
                console.log(`[DEBUG] ✅ Erişim sayısı bulundu: ${reach}`);
                return reach;
            }

            // 2 saniye bekle ve tekrar dene
            if (attempt < 15) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log('[DEBUG] ❌ 30 saniye sonra erişim sayısı bulunamadı');
        return 0;

    } catch (error) {
        console.error('[PostAccessTracker] Erişim sayısı çekilirken hata:', error.message);
        return 0;
    }
}

// Tek bir URL'yi kontrol et (profil zaten açık)
async function checkSingleURL(track, browser, sleep) {
    const { id, url } = track;

    console.log(`[PostAccessTracker] URL kontrol ediliyor - Track ID: ${id}`);

    try {
        // Yeni sayfa aç
        const page = await browser.newPage();

        // Browser console'u Node.js console'a bağla
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (text.includes('[DEBUG]')) {
                console.log(`[Browser Console] ${text}`);
            }
        });

        // URL'ye git
        console.log(`[PostAccessTracker] URL: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Erişim sayısını çek (extractReachFromPage içinde 30 saniye polling var)
        const reach = await extractReachFromPage(page);
        console.log(`[PostAccessTracker] Track ID ${id} - Erişim: ${reach}`);

        // Eğer reach 0 ise, debug için sayfa bilgilerini kaydet
        if (reach === 0) {
            try {
                const pageTitle = await page.title();
                console.log(`[DEBUG] Sayfa başlığı: ${pageTitle}`);

                // Sayfa URL'ini kontrol et (yönlendirme olmuş olabilir)
                const currentUrl = page.url();
                console.log(`[DEBUG] Geçerli URL: ${currentUrl}`);

                // İlk 10 span içeriğini logla
                const spanContents = await page.evaluate(() => {
                    const spans = Array.from(document.querySelectorAll('span'));
                    return spans.slice(0, 10).map(s => s.textContent.trim()).filter(t => t.length > 0);
                });
                console.log(`[DEBUG] İlk 10 span içeriği:`, spanContents);
            } catch (debugErr) {
                console.error('[DEBUG] Sayfa debug hatası:', debugErr.message);
            }
        }

        // Panele gönder
        await updateReachOnPanel(id, reach);

        // Sayfayı kapat
        await page.close();

        console.log(`[PostAccessTracker] Track ID ${id} tamamlandı`);

    } catch (error) {
        console.error(`[PostAccessTracker] Track ID ${id} kontrol hatası:`, error.message);
    }
}

// Tüm aktif track'leri kontrol et
async function checkAllActiveTracks(startProfile, stopProfile, sleep) {
    console.log('[PostAccessTracker] Aktif track\'ler kontrol ediliyor...');

    const tracks = await getActiveTracks();

    if (tracks.length === 0) {
        console.log('[PostAccessTracker] Kontrol edilecek aktif track yok');
        return;
    }

    console.log(`[PostAccessTracker] ${tracks.length} aktif track bulundu`);

    // Profil bilgilerini al (hepsi aynı profili kullanıyor)
    const { profile } = tracks[0];
    let browser = null;

    try {
        // Profili bir kez başlat
        console.log(`[PostAccessTracker] Profil başlatılıyor: ${profile.name}`);
        browser = await startProfile(profile.folderId, profile.visionId);

        if (!browser) {
            console.error(`[PostAccessTracker] Profil başlatılamadı: ${profile.name}`);
            return;
        }

        // İlk açılışta her şeyin yerine oturması için bekle
        console.log('[PostAccessTracker] Profil hazırlanıyor (20 saniye)...');
        await sleep(20000);

        // Tüm URL'leri sırayla kontrol et
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];

            console.log(`[PostAccessTracker] İşleniyor: ${i + 1}/${tracks.length}`);
            await checkSingleURL(track, browser, sleep);

            // URL'ler arası bekleme (son URL değilse)
            if (i < tracks.length - 1) {
                await sleep(3000);
            }
        }

        console.log('[PostAccessTracker] Tüm track\'ler kontrol edildi');

    } catch (error) {
        console.error('[PostAccessTracker] Genel hata:', error.message);

    } finally {
        // Her durumda profili kapat
        if (browser) {
            try {
                console.log(`[PostAccessTracker] Profil kapatılıyor: ${profile.name}`);
                await stopProfile(profile.folderId, profile.visionId);
                console.log('[PostAccessTracker] Profil kapatıldı');
            } catch (stopError) {
                console.error('[PostAccessTracker] Profil kapatılırken hata:', stopError.message);
            }
        }
    }
}

module.exports = {
    checkAllActiveTracks,
    getActiveTracks,
    updateReachOnPanel,
    extractReachFromPage
};
