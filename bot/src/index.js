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

const JobOrchestrator = require('./taskHandler');

/**
 * Görevi işle (Orchestrator Wrapper)
 */
async function processTask(task, threadId) {
    // 1. Özel Görev: Senkronizasyon (Tarayıcı gerektirmez)
    if (task.taskType === 'sync_profiles') {
        try {
            // Senkronizasyon başladı logu
            await sendLog('info', 'SYNC_START', `Profil senkronizasyonu başlatıldı (Görev #${task.id})`, { taskId: task.id });

            const profiles = await listProfiles();
            if (profiles.length > 0) {
                const success = await pushProfiles(profiles);
                if (success) {
                    await reportTaskResult(task.id, 'completed', `${profiles.length} profil senkronize edildi`);
                    // Başarı logu
                    await sendLog('success', 'SYNC_COMPLETE', `Profil senkronizasyonu tamamlandı: ${profiles.length} profil güncellendi`, { taskId: task.id, profileCount: profiles.length });
                } else {
                    await reportTaskResult(task.id, 'failed', 'Panel\'e profil gönderilemedi');
                    await sendLog('error', 'SYNC_FAILED', `Profil senkronizasyonu başarısız: Panel'e veri gönderilemedi`, { taskId: task.id });
                }
            } else {
                await reportTaskResult(task.id, 'failed', 'Vision API\'dan profil alınamadı');
                // Hata logu
                await sendLog('error', 'SYNC_FAILED', `Profil senkronizasyonu başarısız: Vision API'dan profil alınamadı`, { taskId: task.id });
            }
        } catch (err) {
            await reportTaskResult(task.id, 'failed', err.message);
            // Hata logu
            await sendLog('error', 'SYNC_FAILED', `Profil senkronizasyonu hatası: ${err.message}`, { taskId: task.id, error: err.message });
        }
        return;
    }

    // 2. Browser Tabanlı Görevler (Like, Comment, Boost vb.)
    const job = new JobOrchestrator(task, threadId);

    try {
        // Kaynakları hazırla (Proxy kilitleri)
        const ready = await job.prepareResources(waitForProfileSlot);
        if (!ready) return;

        // Tarayıcıyı başlat ve Facebook'u doğrula
        await job.initBrowser();
        await job.validateLogin();

        // Aksiyonu gerçekleştir
        const success = await job.runAction();

        // Başarıyla bitir
        if (success) {
            await job.complete();
        } else {
            await job.fail(new Error('İşlem Facebook tarafında başarısız oldu.'));
        }

    } catch (error) {
        // Operasyonel hataları raporla
        await job.fail(error);
    } finally {
        // Her durumda kaynakları temizle (Kritik!)
        await job.releaseResources();
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
