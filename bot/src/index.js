require('dotenv').config();

const express = require('express');
const { getPendingTask, reportTaskResult, pushProfiles } = require('./api');
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
        console.log('Oturum sabitlendi, işleme geçiliyor.');

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
                    // Kelimeye göre gönderi bul
                    const found = await findPostByKeyword(page, task.postTask.searchKeyword);

                    if (!found) {
                        await reportTaskResult(task.id, 'failed', 'Gönderi bulunamadı');
                        return;
                    }

                    // Action tipini botTask.result'tan al (Panel görev oluştururken oraya yazdı)
                    const action = task.result; // like, comment, share
                    console.log(`Aksiyon gerçekleştiriliyor: ${action}`);

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
                                    return;
                                }
                            } catch (e) {
                                console.error('Yorum çekilemedi:', e.message);
                                await reportTaskResult(task.id, 'failed', 'Yorum havuzuna ulaşılamadı');
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

        if (success) {
            // Başarılı işlem sonrası 10 sn bekleyip tarayıcıyı kapat
            console.log('\n--- OTOMATİK TARAYICI KAPATMA ---');
            console.log('Görev başarıyla tamamlandı. Tarayıcı 10 saniye içinde kapatılacak...');
            await sleep(10000);
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
