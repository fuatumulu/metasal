const ACTION_DELAY = parseInt(process.env.ACTION_DELAY) || 3000;
const { sendLog } = require('./api');

/**
 * Belirtilen süre kadar bekle
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cookie ile Facebook'a giriş yap
 */
async function loginWithCookie(page, cookieBase64) {
    try {
        console.log('Cookie ile giriş yapılıyor...');

        // Base64'ten cookie'leri decode et
        const cookieJson = Buffer.from(cookieBase64, 'base64').toString('utf-8');
        const cookies = JSON.parse(cookieJson);

        // Facebook'a git (cookie set etmeden önce domain gerekli)
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
        await sleep(1000);

        // Cookie'leri set et
        for (const cookie of cookies) {
            try {
                await page.setCookie({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain || '.facebook.com',
                    path: cookie.path || '/',
                    httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : true,
                    secure: cookie.secure !== undefined ? cookie.secure : true,
                    expires: cookie.expirationDate ? Math.floor(cookie.expirationDate / 1000) : undefined
                });
            } catch (e) {
                // Cookie set hatası, devam et
            }
        }

        // Sayfayı yenile
        await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
        await sleep(2000);

        // Giriş kontrolü
        const url = page.url();
        if (url.includes('login') || url.includes('checkpoint')) {
            console.log('Cookie ile giriş başarısız');
            return false;
        }

        console.log('Cookie ile giriş başarılı');
        return true;
    } catch (error) {
        console.error('Cookie login hatası:', error.message);
        return false;
    }
}

/**
 * Facebook'a giriş yap (cookie veya kullanıcı adı/şifre ile)
 */
async function login(page, username, password, cookie = null) {
    // Önce cookie ile dene
    if (cookie) {
        const cookieSuccess = await loginWithCookie(page, cookie);
        if (cookieSuccess) {
            return true;
        }
        console.log('Cookie başarısız, kullanıcı adı/şifre deneniyor...');
    }

    // Cookie yoksa veya başarısız olduysa kullanıcı adı/şifre ile dene
    if (!username || !password) {
        console.log('Kullanıcı adı veya şifre yok');
        return false;
    }

    try {
        console.log(`Facebook girişi yapılıyor: ${username}`);

        await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
        await sleep(2000);

        // Cookie popup varsa kapat (TR/EN)
        try {
            await page.evaluate(() => {
                const acceptTexts = ['tümünü kabul et', 'accept all', 'allow all', 'kabul et', 'accept'];
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                for (const btn of buttons) {
                    const text = btn.textContent?.toLowerCase().trim();
                    if (acceptTexts.some(t => text?.includes(t))) {
                        btn.click();
                        break;
                    }
                }
            });
            await sleep(1000);
        } catch (e) { }

        // Email/Username alanını bul ve yaz
        // Selector alternatifleri: #email (ID), input[name="email"], data-testid
        const emailSelector = '#email, input[name="email"], input[data-testid="royal-email"]';
        await page.waitForSelector(emailSelector, { timeout: 10000 });
        await page.type(emailSelector, username, { delay: 100 });

        // Password alanını bul ve yaz
        const passSelector = '#pass, input[name="pass"], input[data-testid="royal-pass"]';
        await page.waitForSelector(passSelector, { timeout: 5000 });
        await page.type(passSelector, password, { delay: 100 });
        await sleep(500);

        // Login butonuna tıkla
        // Selector alternatifleri: name="login", data-testid, veya metin bazlı
        const loginClicked = await page.evaluate(() => {
            // Önce name veya data-testid ile dene
            const loginBtn = document.querySelector('button[name="login"], button[data-testid="royal-login-button"]');
            if (loginBtn) {
                loginBtn.click();
                return true;
            }
            // Metin bazlı arama (TR/EN)
            const loginTexts = ['giriş yap', 'log in', 'login', 'sign in'];
            const buttons = Array.from(document.querySelectorAll('button[type="submit"], button'));
            for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase().trim();
                if (loginTexts.some(t => text?.includes(t))) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!loginClicked) {
            // Fallback: eski yöntem
            await page.click('[name="login"]');
        }

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);

        // Giriş başarılı mı kontrol et
        const url = page.url();
        if (url.includes('login') || url.includes('checkpoint')) {
            console.log('Giriş başarısız veya doğrulama gerekiyor');
            return false;
        }

        console.log('Giriş başarılı');
        return true;
    } catch (error) {
        console.error('Login hatası:', error.message);
        return false;
    }
}


/**
 * Facebook popuplarını (bildirimler, çerezler vb.) kapatmaya çalış
 */
async function handlePopups(page) {
    try {
        await page.evaluate(() => {
            const popupButtons = [
                'not now', 'şimdi değil', 'close', 'kapat',
                'accept all', 'tümünü kabul et', 'allow', 'izin ver',
                'decline', 'reddet',
                'block', 'engelle', 'dismiss', 'reddet',
                'skip', 'geç', 'maybe later', 'belki sonra'
            ];

            // Tüm butonları ve tıklanabilir metinleri tara
            const buttons = Array.from(document.querySelectorAll('div[role="button"], span, b, button, a[role="button"]'));
            for (const btn of buttons) {
                const text = btn.textContent.trim().toLowerCase();
                // Tam eşleşme veya içeriyorsa (daha agresif kapatma)
                if (popupButtons.some(p => text === p || (text.length < 20 && text.includes(p)))) {
                    try { btn.click(); } catch (e) { }
                }
            }
        });
        await sleep(1500);
    } catch (e) { }
}

/**
 * Sayfa veya grubu beğen/takip et
 */
async function likeTarget(page, targetUrl, targetType) {
    try {
        console.log(`Hedef inceleniyor: ${targetUrl}`);
        await sendLog('info', targetType === 'page' ? 'PAGE_CHECK' : 'GROUP_CHECK', `Hedef inceleniyor: ${targetUrl}`, { url: targetUrl, type: targetType });

        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        await sleep(ACTION_DELAY);

        // Önce popupları temizle
        await handlePopups(page);

        // Sayfa için Like/Follow butonu
        if (targetType === 'page') {
            const getStatus = async () => {
                return await page.evaluate(() => {
                    const targets = {
                        action: ['follow', 'takip et', 'like', 'beğen'],
                        active: ['following', 'takip ediliyor', 'liked', 'beğendin', 'beğendiniz']
                    };
                    const allElements = Array.from(document.querySelectorAll('span, div, b, div[role="button"]'));
                    const active = allElements.find(el => targets.active.some(t => el.textContent.trim().toLowerCase() === t));
                    if (active) return { status: 'active', text: active.textContent.trim() };
                    const action = allElements.find(el => targets.action.some(t => el.textContent.trim().toLowerCase() === t));
                    if (action) return { status: 'action', text: action.textContent.trim() };
                    return { status: 'not_found' };
                });
            };

            let current = await getStatus();

            if (current.status === 'active') {
                console.log(`Zaten aktif (${current.text}). İşlem atlanıyor.`);
                await sendLog('success', 'PAGE_LIKE_SKIP', `Sayfa zaten aktif/beğenilmiş: ${current.text}`);
                return true;
            }

            if (current.status === 'action') {
                console.log(`"${current.text}" butonu bulundu, tıklanıyor...`);

                const element = await page.evaluateHandle((text) => {
                    const el = Array.from(document.querySelectorAll('*')).find(e => e.textContent.trim() === text);
                    return el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;
                }, current.text);

                if (element) {
                    await element.asElement()?.click();
                    console.log('Tıklandı, doğrulanıyor (10sn bekleniyor)...');
                    await sleep(10000); // Facebook'un durumu güncellemesi için 10 saniye bekle

                    // DOĞRULAMA: Metin değişti mi?
                    current = await getStatus();
                    if (current.status === 'active') {
                        console.log(`Başarılı! Yeni durum: ${current.text}`);
                        await sendLog('success', 'PAGE_LIKE_SUCCESS', `Sayfa başarıyla beğenildi/takip edildi: ${current.text}`);
                        return true;
                    } else {
                        console.log('HATA: Butona tıklandı ancak durum değişmedi (Follow -> Following olmadı). Popupları tekrar deniyoruz...');
                        await handlePopups(page);
                        await sleep(1000);
                        current = await getStatus();
                        if (current.status === 'active') return true;
                        return false;
                    }
                }
            }
        }

        // Grup için Katıl butonu
        if (targetType === 'group') {
            const getStatus = async () => {
                return await page.evaluate(() => {
                    const targets = {
                        action: ['join group', 'gruba katıl', 'join', 'katıl'],
                        active: ['joined', 'katıldın', 'visit group', 'grubu ziyaret et', 'gruba göz at', 'visit', 'ziyaret et', 'cancel request', 'isteği iptal et']
                    };
                    const allElements = Array.from(document.querySelectorAll('span, div, b, div[role="button"]'));
                    const active = allElements.find(el => targets.active.some(t => el.textContent.trim().toLowerCase() === t));
                    if (active) return { status: 'active', text: active.textContent.trim() };
                    const action = allElements.find(el => targets.action.some(t => el.textContent.trim().toLowerCase() === t));
                    if (action) return { status: 'action', text: action.textContent.trim() };
                    return { status: 'not_found' };
                });
            };

            let current = await getStatus();

            if (current.status === 'active') {
                console.log(`Zaten gruptasınız veya istek gönderilmiş (${current.text}).`);
                await sendLog('success', 'GROUP_JOIN_SKIP', `Zaten gruptasınız veya istek gönderilmiş: ${current.text}`);
                return true;
            }

            if (current.status === 'action') {
                console.log(`"${current.text}" butonu bulundu, gruba katılınıyor...`);
                const element = await page.evaluateHandle((text) => {
                    const el = Array.from(document.querySelectorAll('*')).find(e => e.textContent.trim() === text);
                    return el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;
                }, current.text);

                if (element) {
                    await element.asElement()?.click();
                    console.log('Tıklandı, doğrulanıyor (10sn bekleniyor)...');
                    await sleep(10000);

                    current = await getStatus();
                    if (current.status === 'active') {
                        console.log(`Başarılı! Yeni durum: ${current.text}`);
                        await sendLog('success', 'GROUP_JOIN_SUCCESS', `Gruba başarıyla katılma isteği gönderildi: ${current.text}`);
                        return true;
                    } else {
                        console.log('HATA: Katıl butonu tıklandı ama durum değişmedi.');
                        return false;
                    }
                }
            }
        }

        console.log('Uygun buton bulunamadı veya etkileşim bir engel nedeniyle yapılamadı.');
        return false;
    } catch (error) {
        console.error('Etkileşim hatası:', error.message);
        return false;
    }
}

/**
 * Mouse'u ekran ortasına getir
 */
async function moveToCenterOfScreen(page) {
    const viewport = await page.viewport();
    const centerX = viewport ? viewport.width / 2 : 960;
    const centerY = viewport ? viewport.height / 2 : 540;
    await page.mouse.move(centerX, centerY);
    console.log(`Mouse ekran ortasına getirildi: (${centerX}, ${centerY})`);
}

/**
 * Belirli süre boyunca human-like scroll yaparak arama kelimesini ara
 * @param {object} page - Puppeteer page
 * @param {string} keyword - Aranacak kelime
 * @param {number} durationSeconds - Arama süresi (saniye)
 * @returns {boolean} - Bulundu mu
 */
async function scrollAndSearchForDuration(page, keyword, durationSeconds) {
    const startTime = Date.now();
    const endTime = startTime + (durationSeconds * 1000);
    let scrollCount = 0;

    console.log(`${durationSeconds} saniye boyunca "${keyword}" aranıyor...`);

    while (Date.now() < endTime) {
        // Sayfadaki tüm gönderileri tara - Daha güvenilir seçiciler
        const found = await page.evaluate((searchText) => {
            // Yöntem 1: role="article" container'larını bul ve içindeki mesaj elementlerini ara
            const articles = document.querySelectorAll('[role="article"]');
            for (const article of articles) {
                // Article içindeki mesaj elementlerini bul
                const messageEl = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
                if (messageEl) {
                    const text = messageEl.innerText || messageEl.textContent || '';
                    if (text.toLowerCase().includes(searchText.toLowerCase())) {
                        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return true;
                    }
                }

                // Fallback: Article içindeki tüm dir="auto" divleri kontrol et (sadece ilk birkaç seviye)
                const dirAutoDivs = article.querySelectorAll('div[dir="auto"]');
                for (const div of dirAutoDivs) {
                    const text = div.innerText || div.textContent || '';
                    // Çok kısa metinleri atla (tarih, isim gibi)
                    if (text.length > 30 && text.toLowerCase().includes(searchText.toLowerCase())) {
                        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        return true;
                    }
                }
            }

            // Yöntem 2: Doğrudan mesaj elementlerini ara (article dışında kalmış olabilir)
            const directMessages = document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
            for (const msg of directMessages) {
                const text = msg.innerText || msg.textContent || '';
                if (text.toLowerCase().includes(searchText.toLowerCase())) {
                    const container = msg.closest('[role="article"]') || msg.closest('div[data-pagelet]') || msg;
                    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return true;
                }
            }

            return false;
        }, keyword);

        if (found) {
            console.log(`Gönderi bulundu! (${scrollCount} scroll sonrası)`);
            // Gönderi bulunduğunda butonların görünmesi için biraz daha aşağı kaydır (Kullanıcı isteği: 300px)
            await page.evaluate(() => {
                window.scrollBy({
                    top: 300,
                    behavior: 'smooth'
                });
            });
            await sleep(1500);
            return true;
        }

        // Human-like scroll: rastgele miktar ve yön
        const scrollAmount = Math.floor(Math.random() * 400) + 300; // 300-700px arası
        const shouldScrollUp = Math.random() < 0.08; // %8 ihtimalle yukarı scroll

        await page.evaluate((amount, up) => {
            const direction = up ? -1 : 1;
            window.scrollBy({
                top: amount * direction,
                left: 0,
                behavior: 'smooth'
            });
        }, scrollAmount, shouldScrollUp);
        scrollCount++;

        // Human-like bekleme: 1.5-3 saniye arası rastgele
        const waitTime = Math.floor(Math.random() * 1500) + 1500;
        await sleep(waitTime);
    }

    console.log(`${durationSeconds} saniye doldu, gönderi bulunamadı (${scrollCount} scroll yapıldı)`);
    return false;
}

/**
 * Kelimeye göre gönderi bul - Retry mekanizması ile
 * Akış: 40sn ara -> bulamazsa yenile + 30sn ara -> bulamazsa yenile + 30sn ara -> başarısız
 */
async function findPostByKeyword(page, keyword) {
    try {
        console.log(`\\n========================================`);
        console.log(`Gönderi aranıyor: "${keyword}"`);
        console.log(`========================================`);
        await sendLog('info', 'POST_SEARCH_START', `Gönderi aranıyor: "${keyword}"`, { keyword });

        // Mouse'u ekran ortasına getir
        await moveToCenterOfScreen(page);

        // 1. Deneme: 40 saniye boyunca ara
        console.log('\\n--- 1. ARAMA DENEMESİ (40 saniye) ---');
        let found = await scrollAndSearchForDuration(page, keyword, 40);

        if (found) {
            await sleep(1000);
            await sendLog('success', 'POST_FOUND', `Gönderi bulundu: "${keyword}"`, { keyword, attempt: 1 });
            return true;
        }

        // 2. Deneme: Sayfa yenile + 30 saniye ara
        console.log('\\n--- 2. ARAMA DENEMESİ (Sayfa yenileniyor + 30 saniye) ---');
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(3000);
        await moveToCenterOfScreen(page);

        found = await scrollAndSearchForDuration(page, keyword, 30);

        if (found) {
            await sleep(1000);
            await sendLog('success', 'POST_FOUND', `Gönderi bulundu: "${keyword}"`, { keyword, attempt: 2 });
            return true;
        }

        // 3. Deneme: Sayfa yenile + 30 saniye ara
        console.log('\\n--- 3. ARAMA DENEMESİ (Sayfa yenileniyor + 30 saniye) ---');
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(3000);
        await moveToCenterOfScreen(page);

        found = await scrollAndSearchForDuration(page, keyword, 30);

        if (found) {
            await sleep(1000);
            await sendLog('success', 'POST_FOUND', `Gönderi bulundu: "${keyword}"`, { keyword, attempt: 3 });
            return true;
        }

        // Tüm denemeler başarısız
        console.log('\\n--- TÜM DENEMELER BAŞARISIZ ---');
        console.log('Gönderi bulunamadı. Görev başka profile devredilecek.');
        await sendLog('warning', 'POST_NOT_FOUND', `Gönderi bulunamadı: "${keyword}" (3 deneme sonrası)`, { keyword });
        return false;
    } catch (error) {
        console.error('Gönderi arama hatası:', error.message);
        await sendLog('error', 'POST_SEARCH_ERROR', `Gönderi arama hatası: ${error.message}`, { keyword, error: error.message });
        return false;
    }
}

/**
 * Post altındaki Like/Comment/Share butonlarını bul (metin tabanlı arama)
 * @returns {object} - { likeBtn, commentBtn, shareBtn } elementleri
 */
async function findPostActionButtons(page) {
    return await page.evaluate(() => {
        const result = { likeBtn: null, commentBtn: null, shareBtn: null };

        // Like butonları: "Like" veya "Beğen" yazısını ara
        const likeTexts = ['like', 'beğen'];
        // Comment butonları: "Comment" veya "Yorum yap" yazısını ara
        const commentTexts = ['comment', 'yorum yap', 'yorum'];
        // Share butonları: "Share" veya "Paylaş" yazısını ara
        const shareTexts = ['share', 'paylaş'];

        // Görünür alandaki tüm butonları ve role="button" elementlerini tara
        const allElements = Array.from(document.querySelectorAll('div[role="button"], span, div[tabindex="0"]'));

        for (const el of allElements) {
            const text = el.textContent.trim().toLowerCase();
            const rect = el.getBoundingClientRect();

            // Görünür alanda mı?
            if (rect.top < 0 || rect.top > window.innerHeight) continue;

            // Like butonu mu?
            if (!result.likeBtn && likeTexts.some(t => text === t)) {
                result.likeBtn = el;
            }

            // Comment butonu mu?
            if (!result.commentBtn && commentTexts.some(t => text === t)) {
                result.commentBtn = el;
            }

            // Share butonu mu?
            if (!result.shareBtn && shareTexts.some(t => text === t)) {
                result.shareBtn = el;
            }
        }

        return {
            hasLike: !!result.likeBtn,
            hasComment: !!result.commentBtn,
            hasShare: !!result.shareBtn
        };
    });
}

/**
 * Mevcut gönderiyi beğen - Metin tabanlı arama ("Like" / "Beğen")
 */
async function likeCurrentPost(page) {
    try {
        console.log('Gönderi beğeniliyor...');
        await sendLog('info', 'POST_LIKE_ATTEMPT', 'Beğeni butonu aranıyor...');

        const liked = await page.evaluate(() => {
            const likeTexts = ['like', 'beğen'];
            const allElements = Array.from(document.querySelectorAll('div[role="button"], span, div[tabindex="0"]'));

            for (const el of allElements) {
                const text = el.textContent.trim().toLowerCase();

                if (likeTexts.some(t => text === t)) {
                    // Tıklanabilir elementi bul
                    const clickable = el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;

                    // Görünür alana getir ve tıkla
                    clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    clickable.click();
                    return true;
                }
            }
            return false;
        });

        if (liked) {
            await sleep(2000);
            console.log('Gönderi beğenildi');
            await sendLog('success', 'POST_LIKE_SUCCESS', 'Gönderi başarıyla beğenildi');
            return true;
        }

        console.log('Beğen butonu bulunamadı');
        await sendLog('warning', 'POST_LIKE_NOT_FOUND', 'Beğen butonu bulunamadı');
        return false;
    } catch (error) {
        console.error('Gönderi beğenme hatası:', error.message);
        await sendLog('error', 'POST_LIKE_ERROR', `Beğeni hatası: ${error.message}`);
        return false;
    }
}

/**
 * Mevcut gönderiye yorum yap - İframe/popup desteği ile
 * "Write a public comment" / "Herkese açık yorum yazın" alanını arar
 */
async function commentCurrentPost(page, commentText) {
    try {
        console.log('Yorum yapılıyor...');
        await sendLog('info', 'POST_COMMENT_ATTEMPT', `Yorum butonu aranıyor... Yorum: "${commentText}"`);

        // Yorum butonuna tıkla (metin tabanlı)
        const clicked = await page.evaluate(() => {
            const commentTexts = ['comment', 'yorum yap', 'yorum'];
            const allElements = Array.from(document.querySelectorAll('div[role="button"], span, div[tabindex="0"]'));

            for (const el of allElements) {
                const text = el.textContent.trim().toLowerCase();

                if (commentTexts.some(t => text === t)) {
                    const clickable = el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;
                    clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    clickable.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) {
            console.log('Yorum butonu bulunamadı');
            await sendLog('warning', 'POST_COMMENT_NOT_FOUND', 'Yorum butonu bulunamadı');
            return false;
        }

        // Butona tıkladıktan sonra 1 saniye bekle (popup/iframe açılması için)
        console.log('Yorum alanı açılıyor, 1 saniye bekleniyor...');
        await sleep(1000);

        // "Write a public comment" alanını ara (TR: "Herkese açık yorum yazın")
        const commentInputFound = await page.evaluate(() => {
            const placeholderTexts = [
                'write a public comment',
                'herkese açık yorum yazın',
                'write a comment',
                'yorum yazın',
                'yorum yap'
            ];

            // Önce iframe kontrolü
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const inputs = iframeDoc.querySelectorAll('[contenteditable="true"], input, textarea');
                    for (const input of inputs) {
                        const placeholder = (input.getAttribute('placeholder') || input.getAttribute('aria-placeholder') || '').toLowerCase();
                        if (placeholderTexts.some(p => placeholder.includes(p))) {
                            input.focus();
                            input.click();
                            return { found: true, isIframe: true };
                        }
                    }
                } catch (e) {
                    // Cross-origin iframe, atlaniıyor
                }
            }

            // Normal sayfa içinde ara
            const allInputs = document.querySelectorAll('[contenteditable="true"][role="textbox"], [placeholder*="comment"], [placeholder*="yorum"], [aria-placeholder*="comment"], [aria-placeholder*="yorum"]');
            for (const input of allInputs) {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                input.focus();
                input.click();
                return { found: true, isIframe: false };
            }

            // Fallback: herhangi bir contenteditable textbox
            const fallback = document.querySelector('[contenteditable="true"][role="textbox"]');
            if (fallback) {
                fallback.focus();
                fallback.click();
                return { found: true, isIframe: false, fallback: true };
            }

            return { found: false };
        });

        if (!commentInputFound.found) {
            console.log('Yorum alanı bulunamadı');
            await sendLog('warning', 'POST_COMMENT_INPUT_NOT_FOUND', 'Yorum giriş alanı bulunamadı');
            return false;
        }

        console.log(`Yorum alanı bulundu (iframe: ${commentInputFound.isIframe}, fallback: ${commentInputFound.fallback || false})`);
        await sleep(500);

        // Yorumu insansı bir hızda yaz
        console.log('Yorum insansı hızda yazılıyor...');
        for (const char of commentText) {
            await page.keyboard.type(char, { delay: Math.floor(Math.random() * 150) + 100 }); // 100-250ms arası rastgele gecikme
        }

        console.log('Yorum yazıldı, Enter ile gönderiliyor...');
        await sleep(1000);

        // Enter tuşuna bas
        await page.keyboard.press('Enter');

        // Yorumun oturması için 8-10 saniye bekle
        const commentWaitTime = Math.floor(Math.random() * 2000) + 8000; // 8000-10000ms arası
        console.log(`Yorum gönderildi, ${Math.round(commentWaitTime / 1000)} saniye bekleniyor (yorumun oturması için)...`);
        await sleep(commentWaitTime);

        console.log('Yorum yapıldı');
        await sendLog('success', 'POST_COMMENT_SUCCESS', `Yorum başarıyla yapıldı: "${commentText}"`);
        return true;
    } catch (error) {
        console.error('Yorum hatası:', error.message);
        await sendLog('error', 'POST_COMMENT_ERROR', `Yorum hatası: ${error.message}`);
        return false;
    }
}

/**
 * Mevcut gönderiyi paylaş - Metin tabanlı arama ("Share" / "Paylaş")
 */
async function shareCurrentPost(page) {
    try {
        console.log('Gönderi paylaşılıyor...');
        await sendLog('info', 'POST_SHARE_ATTEMPT', 'Paylaş butonu aranıyor...');

        // Share butonuna tıkla (metin tabanlı)
        const clicked = await page.evaluate(() => {
            const shareTexts = ['share', 'paylaş'];
            const allElements = Array.from(document.querySelectorAll('div[role="button"], span, div[tabindex="0"]'));

            for (const el of allElements) {
                const text = el.textContent.trim().toLowerCase();

                if (shareTexts.some(t => text === t)) {
                    const clickable = el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;
                    clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    clickable.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) {
            console.log('Paylaş butonu bulunamadı');
            await sendLog('warning', 'POST_SHARE_NOT_FOUND', 'Paylaş butonu bulunamadı');
            return false;
        }

        await sleep(1500);

        // "Share now" / "Şimdi paylaş" seçeneğine tıkla
        const shared = await page.evaluate(() => {
            const shareNowTexts = [
                'share now', 'şimdi paylaş', 'share to feed',
                'share to your feed', 'hemen paylaş', 'duvarına paylaş'
            ];
            const items = document.querySelectorAll('[role="menuitem"], [role="button"], div[tabindex="0"]');

            for (const item of items) {
                const text = item.textContent.toLowerCase().trim();
                if (shareNowTexts.some(t => text.includes(t))) {
                    item.click();
                    return true;
                }
            }
            return false;
        });

        if (shared) {
            await sleep(2000);
            console.log('Gönderi paylaşıldı');
            await sendLog('success', 'POST_SHARE_SUCCESS', 'Gönderi başarıyla paylaşıldı');
            return true;
        }

        console.log('Paylaş seçeneği bulunamadı');
        await sendLog('warning', 'POST_SHARE_OPTION_NOT_FOUND', 'Paylaş menü seçeneği bulunamadı');
        return false;
    } catch (error) {
        console.error('Paylaşma hatası:', error.message);
        await sendLog('error', 'POST_SHARE_ERROR', `Paylaşma hatası: ${error.message}`);
        return false;
    }
}

/**
 * Tarayıcı penceresinin durumunu kontrol eder ve küçükse tam ekran yapar
 */
async function ensureMaximized(page) {
    try {
        const session = await page.target().createCDPSession();
        const { windowId, bounds } = await session.send('Browser.getWindowForTarget');

        if (bounds.windowState !== 'maximized') {
            console.log(`[Browser] Mevcut pencere durumu: ${bounds.windowState}. Tam ekran yapılıyor...`);
            await session.send('Browser.setWindowBounds', {
                windowId,
                bounds: { windowState: 'maximized' }
            });
            await sleep(1000); // Değişikliğin işlemesi için kısa bir bekleme
        } else {
            console.log('[Browser] Pencere zaten tam ekran.');
        }
    } catch (error) {
        console.log('[Browser] CDP ile pencere büyütülemedi, viewport ayarlanıyor:', error.message);
        try {
            await page.setViewport({ width: 1920, height: 1080 });
        } catch (e) {
            console.error('[Browser] Viewport ayarlama hatası:', e.message);
        }
    }
}

// Eski fonksiyonlar (geriye uyumluluk için)
async function likePost(page, postUrl) {
    await page.goto(postUrl, { waitUntil: 'networkidle2' });
    await sleep(ACTION_DELAY);
    return await likeCurrentPost(page);
}

async function commentPost(page, postUrl, commentText) {
    await page.goto(postUrl, { waitUntil: 'networkidle2' });
    await sleep(ACTION_DELAY);
    return await commentCurrentPost(page, commentText);
}

async function sharePost(page, postUrl) {
    await page.goto(postUrl, { waitUntil: 'networkidle2' });
    await sleep(ACTION_DELAY);
    return await shareCurrentPost(page);
}

/**
 * İşlem sonrası doğal gezinme (Cool-down)
 * Ana sayfada 20-30 saniye rastgele gezer
 */
async function simulateHumanBrowsing(page) {
    try {
        console.log('--- DOĞAL GEZİNME (COOL-DOWN) BAŞLATILDI ---');
        await sendLog('info', 'COOL_DOWN_START', 'İşlem sonrası doğal gezinme başlatıldı (20-30sn)');

        // Ana sayfaya git
        console.log('Facebook ana sayfasına gidiliyor...');
        await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3000);

        const duration = Math.floor(Math.random() * 10000) + 20000; // 20-30 saniye arası
        const startTime = Date.now();

        console.log(`${Math.round(duration / 1000)} saniye boyunca rastgele gezilecek...`);

        while (Date.now() - startTime < duration) {
            // Rastgele miktar aşağı kaydır (200-600px)
            const scrollAmount = Math.floor(Math.random() * 400) + 200;

            await page.evaluate((amount) => {
                window.scrollBy({ top: amount, behavior: 'smooth' });
            }, scrollAmount);

            // Rastgele bekle (1.5-3.5 saniye)
            const waitTime = Math.floor(Math.random() * 2000) + 1500;
            await sleep(waitTime);

            // %20 ihtimalle biraz yukarı kaydır (rastgelelik katmak için)
            if (Math.random() < 0.2) {
                const upScroll = Math.floor(Math.random() * 200) + 100;
                await page.evaluate((amount) => {
                    window.scrollBy({ top: -amount, behavior: 'smooth' });
                }, upScroll);
                await sleep(1000);
            }
        }

        console.log('Doğal gezinme tamamlandı.');
        await sendLog('info', 'COOL_DOWN_END', 'Doğal gezinme tamamlandı');
        return true;
    } catch (error) {
        console.error('Doğal gezinme hatası:', error.message);
        return false;
    }
}

/**
 * Hedef sayfa/grubun gönderilerini beğen (Boost)
 * Bu işlem, hedefin gönderilerinin bot profilinin feed'inde görünmesini sağlar
 * @param {object} page - Puppeteer page
 * @param {string} targetUrl - Hedef sayfa/grup URL'si
 * @param {number} postCount - Beğenilecek gönderi sayısı (varsayılan: 4)
 * @returns {boolean} - Başarılı mı
 */
async function boostTarget(page, targetUrl, postCount = 4) {
    try {
        console.log(`\n========================================`);
        console.log(`BOOST İŞLEMİ BAŞLATILIYOR`);
        console.log(`Hedef: ${targetUrl}`);
        console.log(`Beğenilecek gönderi: ${postCount}`);
        console.log(`========================================`);
        await sendLog('info', 'BOOST_START', `Boost işlemi başlatılıyor: ${targetUrl}`, { url: targetUrl, postCount });

        // Hedef sayfaya git
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3000);

        // Mouse'u ortaya getir
        await moveToCenterOfScreen(page);

        let likedCount = 0;
        let scrollCount = 0;
        const maxScrolls = 25; // Maksimum scroll sayısı
        const likedElements = new Set(); // Zaten beğenilen elementleri takip et

        while (likedCount < postCount && scrollCount < maxScrolls) {
            // Görünür alandaki Like butonlarını bul ve tıkla (likeCurrentPost mantığı ile aynı)
            const likeResult = await page.evaluate((alreadyLiked) => {
                const likeTexts = ['like', 'beğen'];
                const allElements = Array.from(document.querySelectorAll('div[role="button"], span, div[tabindex="0"]'));

                for (const el of allElements) {
                    const text = el.textContent.trim().toLowerCase();
                    const rect = el.getBoundingClientRect();

                    // Görünür alanda mı? (ekranın üst 1/3 - alt 2/3 arasında)
                    if (rect.top < 100 || rect.top > window.innerHeight - 100) continue;

                    // Like butonu mu? (tam eşleşme)
                    if (likeTexts.some(t => text === t)) {
                        // Bu elementin benzersiz konumu
                        const elementKey = `${Math.round(rect.top)}-${Math.round(rect.left)}`;

                        // Daha önce beğenilmedi mi?
                        if (!alreadyLiked.includes(elementKey)) {
                            // Tıklanabilir elementi bul
                            const clickable = el.closest('[role="button"]') || el.closest('div[tabindex="0"]') || el;
                            clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            clickable.click();
                            return { success: true, elementKey };
                        }
                    }
                }
                return { success: false };
            }, Array.from(likedElements));

            if (likeResult.success) {
                likedCount++;
                likedElements.add(likeResult.elementKey);
                console.log(`[BOOST] ${likedCount}/${postCount} gönderi beğenildi`);
                await sendLog('info', 'BOOST_LIKE', `Boost: ${likedCount}/${postCount} gönderi beğenildi`);

                // Beğeni sonrası human-like bekleme (2-4 saniye)
                const waitTime = 2000 + Math.random() * 2000;
                await sleep(waitTime);
            }

            // Aşağı doğru human-like scroll yap
            const scrollAmount = Math.floor(Math.random() * 300) + 250; // 250-550px
            await page.evaluate((amount) => {
                window.scrollBy({ top: amount, behavior: 'smooth' });
            }, scrollAmount);

            scrollCount++;

            // Scroll sonrası bekleme (1-2 saniye)
            await sleep(1000 + Math.random() * 1000);

            // %10 ihtimalle küçük bir yukarı scroll (doğal davranış)
            if (Math.random() < 0.1) {
                const upScroll = Math.floor(Math.random() * 100) + 50;
                await page.evaluate((amount) => {
                    window.scrollBy({ top: -amount, behavior: 'smooth' });
                }, upScroll);
                await sleep(500);
            }
        }

        if (likedCount >= postCount) {
            console.log(`\n[BOOST] TAMAMLANDI: ${likedCount} gönderi beğenildi`);
            await sendLog('success', 'BOOST_SUCCESS', `Boost tamamlandı: ${likedCount} gönderi beğenildi`, { likedCount });
            return true;
        } else if (likedCount > 0) {
            console.log(`\n[BOOST] KISMİ BAŞARI: ${likedCount}/${postCount} gönderi beğenildi`);
            await sendLog('warning', 'BOOST_PARTIAL', `Boost kısmi: ${likedCount}/${postCount} gönderi beğenildi`, { likedCount, expected: postCount });
            return true; // En az 1 beğeni yapıldıysa başarılı say
        } else {
            console.log(`\n[BOOST] BAŞARISIZ: Hiç gönderi beğenilemedi`);
            await sendLog('error', 'BOOST_FAILED', 'Boost başarısız: Beğenilebilecek gönderi bulunamadı');
            return false;
        }
    } catch (error) {
        console.error('[BOOST] Hata:', error.message);
        await sendLog('error', 'BOOST_ERROR', `Boost hatası: ${error.message}`, { error: error.message });
        return false;
    }
}

module.exports = {
    sleep,
    login,
    likeTarget,
    boostTarget,
    moveToCenterOfScreen,
    scrollAndSearchForDuration,
    findPostByKeyword,
    findPostActionButtons,
    likeCurrentPost,
    commentCurrentPost,
    shareCurrentPost,
    likePost,
    commentPost,
    sharePost,
    simulateHumanBrowsing,
    ensureMaximized,
    handlePopups
};
