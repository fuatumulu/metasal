const ACTION_DELAY = parseInt(process.env.ACTION_DELAY) || 3000;

/**
 * Belirtilen süre kadar bekle
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Facebook'a giriş yap
 */
async function login(page, username, password) {
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
 * Sayfa veya grubu beğen
 */
async function likeTarget(page, targetUrl, targetType) {
    try {
        console.log(`Hedef beğeniliyor: ${targetUrl}`);

        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        await sleep(ACTION_DELAY);

        // Sayfa için Like butonu
        if (targetType === 'page') {
            // "Beğen" veya "Like" butonu ara
            const likeBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('[role="button"]'));
                return buttons.find(btn => {
                    const text = btn.textContent.toLowerCase();
                    return text.includes('like') || text.includes('beğen') || text.includes('follow') || text.includes('takip');
                });
            });

            if (likeBtn) {
                await likeBtn.asElement()?.click();
                await sleep(2000);
                console.log('Sayfa beğenildi');
                return true;
            }
        }

        // Grup için Katıl butonu
        if (targetType === 'group') {
            const joinBtn = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('[role="button"]'));
                return buttons.find(btn => {
                    const text = btn.textContent.toLowerCase();
                    return text.includes('join') || text.includes('katıl');
                });
            });

            if (joinBtn) {
                await joinBtn.asElement()?.click();
                await sleep(2000);
                console.log('Gruba katılım isteği gönderildi');
                return true;
            }
        }

        console.log('Beğen/Katıl butonu bulunamadı');
        return false;
    } catch (error) {
        console.error('Hedef beğenme hatası:', error.message);
        return false;
    }
}

/**
 * Gönderi beğen
 */
async function likePost(page, postUrl) {
    try {
        console.log(`Gönderi beğeniliyor: ${postUrl}`);

        await page.goto(postUrl, { waitUntil: 'networkidle2' });
        await sleep(ACTION_DELAY);

        // Like butonu
        const likeBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('[aria-label*="Like"], [aria-label*="Beğen"]'));
            return buttons[0];
        });

        if (likeBtn) {
            await likeBtn.asElement()?.click();
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
 * Gönderiye yorum yap
 */
async function commentPost(page, postUrl, commentText) {
    try {
        console.log(`Yorum yapılıyor: ${postUrl}`);

        await page.goto(postUrl, { waitUntil: 'networkidle2' });
        await sleep(ACTION_DELAY);

        // Yorum alanına tıkla
        const commentBox = await page.evaluateHandle(() => {
            const inputs = Array.from(document.querySelectorAll('[contenteditable="true"]'));
            return inputs.find(inp => {
                const placeholder = inp.getAttribute('aria-placeholder') || inp.getAttribute('placeholder') || '';
                return placeholder.toLowerCase().includes('yorum') || placeholder.toLowerCase().includes('comment');
            });
        });

        if (commentBox) {
            await commentBox.asElement()?.click();
            await sleep(1000);
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
 * Gönderiyi paylaş
 */
async function sharePost(page, postUrl) {
    try {
        console.log(`Gönderi paylaşılıyor: ${postUrl}`);

        await page.goto(postUrl, { waitUntil: 'networkidle2' });
        await sleep(ACTION_DELAY);

        // Share butonu
        const shareBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('[aria-label*="Share"], [aria-label*="Paylaş"]'));
            return buttons[0];
        });

        if (shareBtn) {
            await shareBtn.asElement()?.click();
            await sleep(1500);

            // "Share now" veya "Şimdi paylaş" seçeneği
            const shareNowBtn = await page.evaluateHandle(() => {
                const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"]'));
                return items.find(item => {
                    const text = item.textContent.toLowerCase();
                    return text.includes('share now') || text.includes('şimdi paylaş') || text.includes('share to feed');
                });
            });

            if (shareNowBtn) {
                await shareNowBtn.asElement()?.click();
                await sleep(2000);
                console.log('Gönderi paylaşıldı');
                return true;
            }
        }

        console.log('Paylaş butonu bulunamadı');
        return false;
    } catch (error) {
        console.error('Paylaşma hatası:', error.message);
        return false;
    }
}

module.exports = {
    sleep,
    login,
    likeTarget,
    likePost,
    commentPost,
    sharePost
};
