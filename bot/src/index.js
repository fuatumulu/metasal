require('dotenv').config();

const express = require('express');
const { getPendingTask, reportTaskResult, pushProfiles, sendLog } = require('./api');
const { listProfiles, startProfile, stopProfile } = require('./vision');
const { sleep, likeTarget, findPostByKeyword, likeCurrentPost, commentCurrentPost, shareCurrentPost } = require('./facebook');
const axios = require('axios');

const TASK_CHECK_INTERVAL = parseInt(process.env.TASK_CHECK_INTERVAL) || 10000;
const PORT = process.env.BOT_PORT || 3001;
const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

// Thread ayarları
const THREAD_COUNT = parseInt(process.env.THREAD_COUNT) || 1;
const THREAD_DELAY = parseInt(process.env.THREAD_DELAY) || 35000; // Thread'ler arası bekleme (ms)

// Global: Son profil başlatma zamanı (thread'ler arası delay için)
let lastProfileStartTime = 0;
let profileStartLock = false;

const app = express();
app.use(express.json());

/**
 * Profil başlatmadan önce delay kontrolü yap
 * Thread'ler arası 35 sn delay sağlar
 */
async function waitForProfileSlot(threadId) {
    while (profileStartLock) {
        console.log(`[Thread-${threadId}] Başka bir thread profil başlatıyor, bekleniyor...`);
        await sleep(1000);
    }

    profileStartLock = true;

    const now = Date.now();
    const timeSinceLastStart = now - lastProfileStartTime;

    if (lastProfileStartTime > 0 && timeSinceLastStart < THREAD_DELAY) {
        const waitTime = THREAD_DELAY - timeSinceLastStart;
        console.log(`[Thread-${threadId}] Son profil ${Math.round(timeSinceLastStart / 1000)}sn önce açıldı. ${Math.round(waitTime / 1000)}sn bekleniyor...`);
        await sleep(waitTime);
    }

    lastProfileStartTime = Date.now();
    profileStartLock = false;
}

/**
 * Vision profillerini listele (Panel tarafından çağrılır)
 */
app.get('/vision-profiles', async (req, res) => {
    try {
        const profiles = await listProfiles();
        res.json({ profiles });
    } catch (error) {
        console.error('Vision profiles endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Görevi işle
 */
async function processTask(task, threadId) {
    console.log(`\n[Thread-${threadId}] ========================================`);
    console.log(`[Thread-${threadId}] Görev #${task.id} işleniyor: ${task.taskType}`);
    console.log(`[Thread-${threadId}] ========================================`);
    await sendLog('info', 'TASK_START', `[Thread-${threadId}] Görev #${task.id} başlatıldı`, { taskId: task.id, type: task.taskType, threadId });

    if (task.taskType === 'sync_profiles') {
        console.log(`[Thread-${threadId}] Profil senkronizasyonu başlatılıyor...`);
        try {
            const profiles = await listProfiles();
            if (profiles.length > 0) {
                const success = await pushProfiles(profiles);
                if (success) {
                    await reportTaskResult(task.id, 'completed', `${profiles.length} profil senkronize edildi`);
                    console.log(`[Thread-${threadId}] Senkronizasyon başarılı: ${profiles.length} profil.`);
                } else {
                    await reportTaskResult(task.id, 'failed', 'Profiler panele gönderilemedi');
                }
            } else {
                await reportTaskResult(task.id, 'failed', 'Vision API\'dan profil alınamadı');
            }
        } catch (err) {
            console.error(`[Thread-${threadId}] Sync error:`, err.message);
            await reportTaskResult(task.id, 'failed', err.message);
        }
        return;
    }

    const profile = task.profile;
    const visionId = profile.visionId;
    const folderId = profile.folderId;
    let browser = null;

    try {
        // Profil açmadan önce delay kontrolü
        await waitForProfileSlot(threadId);

        console.log(`[Thread-${threadId}] Profil başlatılıyor: ${profile.name}`);

        // Browser'ı başlat
        browser = await startProfile(folderId, visionId);
        if (!browser) {
            console.error(`[Thread-${threadId}] Browser başlatılamadı`);
            await reportTaskResult(task.id, 'failed', 'Browser başlatılamadı veya Vision profil meşgul');
            return;
        }

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();

        // Facebook'a git ve oturumun oturmasını bekle
        console.log(`[Thread-${threadId}] Facebook ana sayfası açılıyor...`);
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

        // Facebook Stabilizasyonu: Saçma yenilemeleri engellemek için bekle ve reload et
        console.log(`[Thread-${threadId}] Facebook oturumu sabitleniyor (10 sn bekleme + reload)...`);
        await sleep(10000);
        try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch (e) {
            console.log(`[Thread-${threadId}] Reload uyarısı (devam ediliyor):`, e.message);
        }
        console.log(`[Thread-${threadId}] Oturum sabitlendi, doğrulama yapılıyor...`);

        // Oturum Doğrulaması: Bildirimler butonu var mı?
        const hasSession = await page.evaluate(() => {
            const labels = [
                'bildirimler', 'notifications',
                'notifications button', 'bildirimler butonu',
                'messenger', 'mesajlar' // Alternatif kontrol noktaları
            ];
            const elements = Array.from(document.querySelectorAll('[aria-label]'));
            return elements.some(el => {
                const label = el.getAttribute('aria-label').toLowerCase();
                return labels.includes(label);
            });
        });
        if (!hasSession) {
            await sendLog('error', 'SESSION_ERROR', `[Thread-${threadId}] Oturum doğrulaması başarısız: Profile: ${profile.name}`, { visionId, threadId });
            console.error(`[Thread-${threadId}] HATA: Oturum doğrulaması başarısız! (Bildirimler/Messenger butonu bulunamadı)`);
            await reportTaskResult(task.id, 'failed', 'Oturum doğrulaması başarısız: Facebook girişi aktif değil');

            // Tarayıcıyı kapat ve sonlandır
            console.log(`[Thread-${threadId}] Oturum geçersiz olduğu için tarayıcı kapatılıyor...`);
            await stopProfile(folderId, visionId);
            return;
        }

        console.log(`[Thread-${threadId}] Oturum doğrulandı, işleme geçiliyor.`);

        // Görev tipine göre işlem yap
        let success = false;

        switch (task.taskType) {
            case 'like_target':
                if (task.target) {
                    // Hedef sayfaya git
                    success = await likeTarget(page, task.target.url, task.target.type);
                }
                break;

            case 'post_action':
                if (task.postTask) {
                    // === POST ACTION AKIŞI ===
                    // 1. Stabilizasyon: 10 saniye bekle ve sayfayı yenile
                    console.log(`[Thread-${threadId}] --- POST ACTION: Stabilizasyon başlatılıyor ---`);
                    console.log(`[Thread-${threadId}] 10 saniye bekleniyor...`);
                    await sleep(10000);

                    console.log(`[Thread-${threadId}] Sayfa yenileniyor...`);
                    try {
                        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                    } catch (e) {
                        console.log(`[Thread-${threadId}] Reload uyarısı (devam ediliyor):`, e.message);
                    }
                    await sleep(2000);

                    // 2. Kelimeye göre gönderi bul (40sn + 30sn + 30sn retry mekanizması)
                    console.log(`[Thread-${threadId}] --- POST ACTION: Gönderi aranıyor ---`);
                    const found = await findPostByKeyword(page, task.postTask.searchKeyword);

                    if (!found) {
                        // Gönderi bulunamadı - profili kapat ve görevi başka profile devret
                        console.log(`[Thread-${threadId}] --- GÖREV DEVRİ ---`);
                        console.log(`[Thread-${threadId}] Gönderi bulunamadı. Profil kapatılıyor ve görev başka profile devredilecek.`);

                        // Görevi failed olarak işaretle (başka profil devralacak)
                        await reportTaskResult(task.id, 'failed', 'Gönderi bulunamadı - başka profile devrediliyor');

                        // Tarayıcıyı kapat
                        console.log(`[Thread-${threadId}] Tarayıcı kapatılıyor...`);
                        await stopProfile(folderId, visionId);
                        return;
                    }

                    // 3. Gönderi bulundu - Action tipini al ve işlemi gerçekleştir
                    const action = task.result; // like, comment, share
                    console.log(`[Thread-${threadId}] --- POST ACTION: ${action.toUpperCase()} işlemi yapılıyor ---`);
                    await sendLog('info', 'POST_ACTION_START', `[Thread-${threadId}] ${action} işlemi başlatılıyor`, { action, postTaskId: task.postTaskId, threadId });

                    switch (action) {
                        case 'like':
                            success = await likeCurrentPost(page);
                            break;

                        case 'comment':
                            // Panelden rastgele yorum çek
                            try {
                                const commentRes = await axios.get(`${PANEL_URL}/api/comments/random`);
                                const commentText = commentRes.data.comment ? commentRes.data.comment.text : null;
                                if (commentText) {
                                    success = await commentCurrentPost(page, commentText);
                                } else {
                                    console.error(`[Thread-${threadId}] Yorum havuzu boş`);
                                    await reportTaskResult(task.id, 'failed', 'Yorum havuzu boş');
                                    console.log(`[Thread-${threadId}] Hata nedeniyle 5 saniye içinde kapatılacak...`);
                                    await sleep(5000);
                                    await stopProfile(folderId, visionId);
                                    return;
                                }
                            } catch (e) {
                                console.error(`[Thread-${threadId}] Yorum çekilemedi:`, e.message);
                                await reportTaskResult(task.id, 'failed', 'Yorum havuzuna ulaşılamadı');
                                console.log(`[Thread-${threadId}] Hata nedeniyle 5 saniye içinde kapatılacak...`);
                                await sleep(5000);
                                await stopProfile(folderId, visionId);
                                return;
                            }
                            break;

                        case 'share':
                            success = await shareCurrentPost(page);
                            break;
                    }
                }
                break;
        }

        // Sonucu bildir
        await reportTaskResult(task.id, success ? 'completed' : 'failed', success ? 'Başarılı' : 'Başarısız');
        await sendLog(success ? 'success' : 'error', 'TASK_END', `[Thread-${threadId}] Görev #${task.id} ${success ? 'başarıyla tamamlandı' : 'başarısız oldu'}`, { taskId: task.id, success, threadId });

        if (success) {
            if (task.taskType === 'like_target') {
                // Beğeni işlemi sonrası 5 sn bekleyip ana sayfaya dön, sonra kapat
                console.log(`[Thread-${threadId}] --- BEĞENİ SONRASI YÖNLENDİRME ---`);
                console.log(`[Thread-${threadId}] İşlem başarılı. 5 saniye bekleniyor...`);
                await sleep(5000);

                console.log(`[Thread-${threadId}] Facebook ana sayfasına dönülüyor...`);
                await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
                await sleep(2000);
            } else {
                // Diğer başarılı işlemler için mevcut 10 sn bekleme
                console.log(`[Thread-${threadId}] Görev başarıyla tamamlandı. 10 saniye içinde tarayıcı kapatılacak...`);
                await sleep(10000);
            }

            console.log(`[Thread-${threadId}] --- OTOMATİK TARAYICI KAPATMA ---`);
            await stopProfile(folderId, visionId);
        }

    } catch (error) {
        console.error(`[Thread-${threadId}] Görev işleme hatası:`, error);
        await reportTaskResult(task.id, 'failed', error.message);
    } finally {
        // Bağlantıyı kopar (Vision profili stopProfile ile zaten kapandıysa hata vermez)
        if (browser) {
            try {
                await browser.disconnect();
            } catch (e) { }
        }
    }
}

/**
 * Thread worker döngüsü
 */
async function threadWorker(threadId) {
    console.log(`[Thread-${threadId}] Worker başlatıldı`);

    // Thread'ler arası başlangıç delay'i (ilk thread hariç)
    if (threadId > 1) {
        const startupDelay = (threadId - 1) * THREAD_DELAY;
        console.log(`[Thread-${threadId}] Başlangıç için ${Math.round(startupDelay / 1000)}sn bekleniyor...`);
        await sleep(startupDelay);
    }

    while (true) {
        try {
            const task = await getPendingTask();

            if (task) {
                await processTask(task, threadId);
            }
        } catch (error) {
            console.error(`[Thread-${threadId}] Worker loop error:`, error);
        }

        await sleep(TASK_CHECK_INTERVAL);
    }
}

/**
 * Tüm thread'leri başlat
 */
async function startAllThreads() {
    console.log(`\n========================================`);
    console.log(`Thread sistemi başlatılıyor...`);
    console.log(`Thread sayısı: ${THREAD_COUNT}`);
    console.log(`Thread arası delay: ${THREAD_DELAY / 1000} saniye`);
    console.log(`========================================\n`);

    await sendLog('info', 'SYSTEM_START', `Bot başlatıldı: ${THREAD_COUNT} thread, ${THREAD_DELAY / 1000}sn delay`, { threadCount: THREAD_COUNT, threadDelay: THREAD_DELAY });

    // Thread'leri paralel başlat
    const threads = [];
    for (let i = 1; i <= THREAD_COUNT; i++) {
        threads.push(threadWorker(i));
    }

    // Tüm thread'lerin bitmesini bekle (asla bitmeyecek, sonsuz döngü)
    await Promise.all(threads);
}

// Sunucuyu başlat ve worker'ları çalıştır
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`MetaSal Bot API çalışıyor: port ${PORT}`);
    console.log(`Panel URL: ${PANEL_URL}`);
    console.log(`Vision Local API: ${process.env.VISION_LOCAL_API || 'http://127.0.0.1:3030'}`);
    console.log(`Thread Count: ${THREAD_COUNT}`);
    console.log(`Thread Delay: ${THREAD_DELAY / 1000} saniye`);
    console.log('========================================\n');

    startAllThreads().catch(console.error);
});
