require('dotenv').config();

const express = require('express');
const { getPendingTask, reportTaskResult, pushProfiles, sendLog, heartbeat } = require('./api');
const { listProfiles, startProfile, stopProfile, updateProfileStatus } = require('./vision');
const { sleep, likeTarget, boostTarget, findPostByKeyword, likeCurrentPost, commentCurrentPost, shareCurrentPost, simulateHumanBrowsing, ensureMaximized } = require('./facebook');
const { loadProxyConfig, tryLockCarrier, unlockCarrier, changeIP, getTotalCarrierCount, getDefaultProxyHost } = require('./proxyManager');
const axios = require('axios');

// Timestamp helper - tüm loglar zaman etiketli olacak
const originalLog = console.log;
const originalError = console.error;
const getTimestamp = () => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
console.log = (...args) => originalLog(`[${getTimestamp()}]`, ...args);
console.error = (...args) => originalError(`[${getTimestamp()}]`, ...args);

const TASK_CHECK_INTERVAL = parseInt(process.env.TASK_CHECK_INTERVAL) || 10000;
const PORT = process.env.BOT_PORT || 3001;
const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

// Thread ayarları - carrier sayısına göre dinamik olarak belirlenir
let THREAD_COUNT = 1; // Başlangıç değeri, loadProxyConfig sonrası güncellenir
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
        // ... (Sync logic remains simplified or same, but for consistency let's keep it clean)
        try {
            const profiles = await listProfiles();
            if (profiles.length > 0) {
                const success = await pushProfiles(profiles);
                if (success) {
                    await reportTaskResult(task.id, 'completed', `${profiles.length} profil senkronize edildi`);
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
    const proxyHost = profile.proxyHost || getDefaultProxyHost() || 'DEFAULT';

    let browser = null;
    let isCarrierLocked = false;
    let shouldRotateIP = false;

    try {
        // 1. Carrier Lock
        if (!tryLockCarrier(proxyHost, visionId)) {
            console.log(`[Thread-${threadId}] Carrier ${proxyHost} meşgul, görev tekrar pending yapılıyor...`);
            await reportTaskResult(task.id, 'pending', 'Carrier meşgul - yeniden kuyrukta');
            return;
        }
        isCarrierLocked = true;

        // 2. Wait for Slot
        await waitForProfileSlot(threadId);

        // 3. Start Browser
        let startAttempts = 0;
        const maxStartAttempts = 3;
        while (startAttempts < maxStartAttempts) {
            startAttempts++;
            browser = await startProfile(folderId, visionId);
            if (browser) break;
            if (startAttempts < maxStartAttempts) await sleep(5000);
        }

        if (!browser) {
            throw new Error('Browser başlatılamadı veya Vision profil meşgul');
        }

        shouldRotateIP = true; // Tarayıcı açıldıysa artık IP değişmeli
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        await ensureMaximized(page);

        // 4. Facebook Check
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(10000);
        try { await page.reload({ waitUntil: 'networkidle2', timeout: 60000 }); } catch (e) { }

        const hasSession = await page.evaluate(() => {
            const labels = ['bildirimler', 'notifications', 'messenger', 'mesajlar'];
            return Array.from(document.querySelectorAll('[aria-label]'))
                .some(el => labels.includes(el.getAttribute('aria-label').toLowerCase()));
        });

        if (!hasSession) {
            await updateProfileStatus(folderId, visionId, 'ERROR');
            throw new Error('Oturum doğrulaması başarısız: Facebook girişi aktif değil');
        }

        // 5. Task Logic
        let success = false;
        switch (task.taskType) {
            case 'like_target':
                success = await likeTarget(page, task.target.url, task.target.type);
                break;
            case 'post_action':
                const found = await findPostByKeyword(page, task.postTask.searchKeyword);
                if (!found) {
                    await reportTaskResult(task.id, 'failed', 'Gönderi bulunamadı - devrediliyor');
                    return; // finally bloğu IP rotasyonunu ve kilit açmayı yapacak
                }
                const action = task.result;
                switch (action) {
                    case 'like': success = await likeCurrentPost(page); break;
                    case 'comment':
                        const commentRes = await axios.get(`${PANEL_URL}/api/comments/random`);
                        const commentText = commentRes.data.comment?.text;
                        if (commentText) success = await commentCurrentPost(page, commentText);
                        break;
                    case 'share': success = await shareCurrentPost(page); break;
                }
                break;
            case 'boost_target':
                const postCount = parseInt(task.result) || 4;
                success = await boostTarget(page, task.target.url, postCount);
                break;
        }

        if (success) await simulateHumanBrowsing(page);
        await reportTaskResult(task.id, success ? 'completed' : 'failed', success ? 'Başarılı' : 'İşlem başarısız');
        await sendLog(success ? 'success' : 'error', 'TASK_END', `Görev #${task.id} ${success ? 'tamamlandı' : 'başarısız'}`, { taskId: task.id, threadId });

    } catch (error) {
        console.error(`[Thread-${threadId}] Hata:`, error.message);
        await reportTaskResult(task.id, 'failed', error.message);
        await sendLog('error', 'TASK_ERROR', `Hata: ${error.message}`, { taskId: task.id, threadId });
    } finally {
        if (browser) {
            try {
                console.log(`[Thread-${threadId}] Tarayıcı kapatılıyor...`);
                await stopProfile(folderId, visionId);
                await browser.disconnect();
            } catch (e) { }
        }

        if (shouldRotateIP) {
            console.log(`[Thread-${threadId}] --- PROXY IP DEĞİŞTİRİLİYOR ---`);
            await changeIP(proxyHost);
        }

        if (isCarrierLocked) {
            console.log(`[Thread-${threadId}] Carrier kilidi açılıyor.`);
            unlockCarrier(proxyHost);
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

    // Proxy config'lerini yükle ve thread sayısını belirle
    const proxyCount = loadProxyConfig();
    // Thread sayısı = carrier sayısı (minimum 1)
    THREAD_COUNT = Math.max(1, proxyCount);

    console.log(`Proxy Config: ${proxyCount} carrier tanımlı`);
    console.log(`Thread Count: ${THREAD_COUNT} (carrier sayısına göre)`);
    console.log(`Thread Delay: ${THREAD_DELAY / 1000} saniye`);
    console.log('========================================\n');

    // Heartbeat interval - Her 10 dakikada bir panel ile haberleşme
    // Bot'un uzun süre görevsiz kaldığında uykuya dalmasını engeller
    const HEARTBEAT_INTERVAL = 10 * 60 * 1000; // 10 dakika
    setInterval(async () => {
        const result = await heartbeat();
        if (result) {
            console.log(`[Heartbeat] Panel bağlantısı aktif - ${new Date().toLocaleTimeString('tr-TR')}`);
        }
    }, HEARTBEAT_INTERVAL);

    // İlk heartbeat'i hemen gönder
    heartbeat().then(result => {
        if (result) {
            console.log('[Heartbeat] İlk bağlantı kuruldu');
        }
    });

    startAllThreads().catch(console.error);
});
