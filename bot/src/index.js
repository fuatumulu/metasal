require('dotenv').config();

const express = require('express');
const { getPendingTask, reportTaskResult, pushProfiles, sendLog } = require('./api');
const { listProfiles, startProfile, stopProfile } = require('./vision');
const { sleep, likeTarget, findPostByKeyword, likeCurrentPost, commentCurrentPost, shareCurrentPost } = require('./facebook');
const axios = require('axios');

const TASK_CHECK_INTERVAL = parseInt(process.env.TASK_CHECK_INTERVAL) || 10000;
const PORT = process.env.BOT_PORT || 3001;
const PANEL_URL = process.env.PANEL_URL || 'http://localhost:3000';

const app = express();
app.use(express.json());

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
async function processTask(task) {
    console.log(`\n========================================`);
    console.log(`Görev #${task.id} işleniyor: ${task.taskType}`);
    console.log(`========================================`);
    await sendLog('info', 'TASK_START', `Görev #${task.id} başlatıldı`, { taskId: task.id, type: task.taskType });

    if (task.taskType === 'sync_profiles') {
        console.log('Profil senkronizasyonu başlatılıyor...');
        try {
            const profiles = await listProfiles();
            if (profiles.length > 0) {
                const success = await pushProfiles(profiles);
                if (success) {
                    await reportTaskResult(task.id, 'completed', `${profiles.length} profil senkronize edildi`);
                    console.log(`Senkronizasyon başarılı: ${profiles.length} profil.`);
                } else {
                    await reportTaskResult(task.id, 'failed', 'Profiler panele gönderilemedi');
                }
            } else {
                await reportTaskResult(task.id, 'failed', 'Vision API\'dan profil alınamadı');
            }
        } catch (err) {
            console.error('Sync error:', err.message);
            await reportTaskResult(task.id, 'failed', err.message);
        }
        return;
    }

    const profile = task.profile;
    const visionId = profile.visionId;
    const folderId = profile.folderId;
    let browser = null;

    try {
        // Browser'ı başlat
        browser = await startProfile(folderId, visionId);
        if (!browser) {
            console.error('Browser başlatılamadı');
            await reportTaskResult(task.id, 'failed', 'Browser başlatılamadı veya Vision profil meşgul');
            return;
        }

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();

        // Facebook'a git ve oturumun oturmasını bekle
        console.log('Facebook ana sayfası açılıyor...');
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

        // Facebook Stabilizasyonu: Saçma yenilemeleri engellemek için bekle ve reload et
        console.log('Facebook oturumu sabitleniyor (10 sn bekleme + reload)...');
        await sleep(10000);
        try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        } catch (e) {
            console.log('Reload uyarısı (devam ediliyor):', e.message);
        }
        console.log('Oturum sabitlendi, doğrulama yapılıyor...');

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
            await sendLog('error', 'SESSION_ERROR', `Oturum doğrulaması başarısız: Profile: ${profile.name}`, { visionId });
            console.error('HATA: Oturum doğrulaması başarısız! (Bildirimler/Messenger butonu bulunamadı)');
            await reportTaskResult(task.id, 'failed', 'Oturum doğrulaması başarısız: Facebook girişi aktif değil');

            // Tarayıcıyı kapat ve sonlandır
            console.log('Oturum geçersiz olduğu için tarayıcı kapatılıyor...');
            await stopProfile(folderId, visionId);
            return;
        }

        console.log('Oturum doğrulandı, işleme geçiliyor.');

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
                    console.log('\\n--- POST ACTION: Stabilizasyon başlatılıyor ---');
                    console.log('10 saniye bekleniyor...');
                    await sleep(10000);

                    console.log('Sayfa yenileniyor...');
                    try {
                        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                    } catch (e) {
                        console.log('Reload uyarısı (devam ediliyor):', e.message);
                    }
                    await sleep(2000);

                    // 2. Kelimeye göre gönderi bul (40sn + 30sn + 30sn retry mekanizması)
                    console.log('\\n--- POST ACTION: Gönderi aranıyor ---');
                    const found = await findPostByKeyword(page, task.postTask.searchKeyword);

                    if (!found) {
                        // Gönderi bulunamadı - profili kapat ve görevi başka profile devret
                        console.log('\\n--- GÖREV DEVRİ ---');
                        console.log('Gönderi bulunamadı. Profil kapatılıyor ve görev başka profile devredilecek.');

                        // Görevi pending'e çevir (başka profil devralacak)
                        await reportTaskResult(task.id, 'failed', 'Gönderi bulunamadı - başka profile devrediliyor');

                        // Tarayıcıyı kapat
                        console.log('Tarayıcı kapatılıyor...');
                        await stopProfile(folderId, visionId);
                        return;
                    }

                    // 3. Gönderi bulundu - Action tipini al ve işlemi gerçekleştir
                    const action = task.result; // like, comment, share
                    console.log(`\\n--- POST ACTION: ${action.toUpperCase()} işlemi yapılıyor ---`);
                    await sendLog('info', 'POST_ACTION_START', `${action} işlemi başlatılıyor`, { action, postTaskId: task.postTaskId });

                    switch (action) {
                        case 'like':
                            success = await likeCurrentPost(page);
                            break;

                        case 'comment':
                            // Panelden rastgele yorum çek
                            try {
                                const commentRes = await axios.get(`${PANEL_URL}/comments/random`);
                                const commentText = commentRes.data.comment ? commentRes.data.comment.text : null;
                                if (commentText) {
                                    success = await commentCurrentPost(page, commentText);
                                } else {
                                    console.error('Yorum havuzu boş');
                                    await reportTaskResult(task.id, 'failed', 'Yorum havuzu boş');
                                    await stopProfile(folderId, visionId);
                                    return;
                                }
                            } catch (e) {
                                console.error('Yorum çekilemedi:', e.message);
                                await reportTaskResult(task.id, 'failed', 'Yorum havuzuna ulaşılamadı');
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
        await sendLog(success ? 'success' : 'error', 'TASK_END', `Görev #${task.id} ${success ? 'başarıyla tamamlandı' : 'başarısız oldu'}`, { taskId: task.id, success });

        if (success) {
            if (task.taskType === 'like_target') {
                // Beğeni işlemi sonrası 5 sn bekleyip ana sayfaya dön, sonra kapat
                console.log('\n--- BEĞENİ SONRASI YÖNLENDİRME ---');
                console.log('İşlem başarılı. 5 saniye bekleniyor...');
                await sleep(5000);

                console.log('Facebook ana sayfasına dönülüyor...');
                await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
                await sleep(2000);
            } else {
                // Diğer başarılı işlemler için mevcut 10 sn bekleme
                console.log('Görev başarıyla tamamlandı. 10 saniye içinde tarayıcı kapatılacak...');
                await sleep(10000);
            }

            console.log('\n--- OTOMATİK TARAYICI KAPATMA ---');
            await stopProfile(folderId, visionId);
        }

    } catch (error) {
        console.error('Görev işleme hatası:', error);
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
 * Ana bot döngüsü
 */
async function workerLoop() {
    console.log('Worker döngüsü başlatıldı...');

    while (true) {
        try {
            const task = await getPendingTask();

            if (task) {
                await processTask(task);
            }
        } catch (error) {
            console.error('Worker loop error:', error);
        }

        await sleep(TASK_CHECK_INTERVAL);
    }
}

// Sunucuyu başlat ve worker'ı çalıştır
app.listen(PORT, () => {
    console.log('========================================');
    console.log(`MetaSal Bot API çalışıyor: port ${PORT}`);
    console.log(`Panel URL: ${PANEL_URL}`);
    console.log(`Vision Local API: ${process.env.VISION_LOCAL_API || 'http://127.0.0.1:3030'}`);
    console.log('========================================\n');

    workerLoop().catch(console.error);
});
