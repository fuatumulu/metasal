const ACTION_DELAY = parseInt(process.env.ACTION_DELAY) || 3000;

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

        // Cookie popup varsa kapat
        try {
            const cookieBtn = await page.$('[data-cookiebanner="accept_button"]');
            if (cookieBtn) {
                await cookieBtn.click();
                await sleep(1000);
            }
        } catch (e) { }

        // Login form
        await page.type('#email', username, { delay: 100 });
        await page.type('#pass', password, { delay: 100 });
        await sleep(500);

        await page.click('[name="login"]');
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
                'decline', 'reddet'
            ];

            // Tüm butonları ve tıklanabilir metinleri tara
            const buttons = Array.from(document.querySelectorAll('div[role="button"], span, b, button'));
            for (const btn of buttons) {
                const text = btn.textContent.trim().toLowerCase();
                if (popupButtons.includes(text)) {
                    btn.click();
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
                    console.log('Tıklandı, doğrulanıyor...');
                    await sleep(4000); // Facebook'un durumu güncellemesi için biraz daha fazla bekle

                    // DOĞRULAMA: Metin değişti mi?
                    current = await getStatus();
                    if (current.status === 'active') {
                        console.log(`Başarılı! Yeni durum: ${current.text}`);
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
                    console.log('Tıklandı, doğrulanıyor...');
                    await sleep(4000);

                    current = await getStatus();
                    if (current.status === 'active') {
                        console.log(`Başarılı! Yeni durum: ${current.text}`);
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
 * Kelimeye göre gönderi bul
 */
async function findPostByKeyword(page, keyword) {
    try {
        console.log(`Gönderi aranıyor: "${keyword}"`);

        // Ana sayfaya git
        await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
        await sleep(2000);

        // Sayfayı birkaç kez scroll et ve gönderi ara
        for (let i = 0; i < 10; i++) {
            // Sayfadaki tüm gönderileri tara
            const found = await page.evaluate((searchText) => {
                const posts = document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"], div[dir="auto"]');
                for (const post of posts) {
                    if (post.textContent.toLowerCase().includes(searchText.toLowerCase())) {
                        // Gönderiyi bulduk, tıklanabilir elementi bul
                        const postContainer = post.closest('[role="article"]') || post.closest('div[data-pagelet]');
                        if (postContainer) {
                            postContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            return true;
                        }
                    }
                }
                return false;
            }, keyword);

            if (found) {
                console.log('Gönderi bulundu');
                await sleep(1000);
                return true;
            }

            // Scroll et
            await page.evaluate(() => {
                window.scrollBy(0, 800);
            });
            await sleep(2000);
        }

        console.log('Gönderi bulunamadı');
        return false;
    } catch (error) {
        console.error('Gönderi arama hatası:', error.message);
        return false;
    }
}

/**
 * Mevcut gönderiyi beğen (scroll sonrası görünür gönderi)
 */
async function likeCurrentPost(page) {
    try {
        console.log('Gönderi beğeniliyor...');

        const liked = await page.evaluate(() => {
            // Görünür alandaki Like butonunu bul
            const likeButtons = document.querySelectorAll('[aria-label*="Like"], [aria-label*="Beğen"]');
            for (const btn of likeButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.top > 0 && rect.top < window.innerHeight) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (liked) {
            await sleep(2000);
            console.log('Gönderi beğenildi');
            return true;
        }

        console.log('Beğen butonu bulunamadı');
        return false;
    } catch (error) {
        console.error('Gönderi beğenme hatası:', error.message);
        return false;
    }
}

/**
 * Mevcut gönderiye yorum yap
 */
async function commentCurrentPost(page, commentText) {
    try {
        console.log('Yorum yapılıyor...');

        // Yorum butonuna tıkla
        const clicked = await page.evaluate(() => {
            const commentButtons = document.querySelectorAll('[aria-label*="Comment"], [aria-label*="Yorum"]');
            for (const btn of commentButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.top > 0 && rect.top < window.innerHeight) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) {
            console.log('Yorum butonu bulunamadı');
            return false;
        }

        await sleep(1500);

        // Yorum alanına yaz
        const commentBox = await page.$('[contenteditable="true"][role="textbox"]');
        if (commentBox) {
            await commentBox.click();
            await sleep(500);
            await page.keyboard.type(commentText, { delay: 50 });
            await sleep(500);
            await page.keyboard.press('Enter');
            await sleep(2000);
            console.log('Yorum yapıldı');
            return true;
        }

        console.log('Yorum alanı bulunamadı');
        return false;
    } catch (error) {
        console.error('Yorum hatası:', error.message);
        return false;
    }
}

/**
 * Mevcut gönderiyi paylaş
 */
async function shareCurrentPost(page) {
    try {
        console.log('Gönderi paylaşılıyor...');

        // Share butonuna tıkla
        const clicked = await page.evaluate(() => {
            const shareButtons = document.querySelectorAll('[aria-label*="Share"], [aria-label*="Paylaş"]');
            for (const btn of shareButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.top > 0 && rect.top < window.innerHeight) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) {
            console.log('Paylaş butonu bulunamadı');
            return false;
        }

        await sleep(1500);

        // "Share now" seçeneğine tıkla
        const shared = await page.evaluate(() => {
            const items = document.querySelectorAll('[role="menuitem"], [role="button"]');
            for (const item of items) {
                const text = item.textContent.toLowerCase();
                if (text.includes('share now') || text.includes('şimdi paylaş') || text.includes('share to feed')) {
                    item.click();
                    return true;
                }
            }
            return false;
        });

        if (shared) {
            await sleep(2000);
            console.log('Gönderi paylaşıldı');
            return true;
        }

        console.log('Paylaş seçeneği bulunamadı');
        return false;
    } catch (error) {
        console.error('Paylaşma hatası:', error.message);
        return false;
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

module.exports = {
    sleep,
    login,
    likeTarget,
    findPostByKeyword,
    likeCurrentPost,
    commentCurrentPost,
    shareCurrentPost,
    likePost,
    commentPost,
    sharePost
};
