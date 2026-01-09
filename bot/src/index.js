require('dotenv').config();

const { getPendingTask, reportTaskResult, updateAccountStatus } = require('./api');
const { getOrCreateProfile, startProfile, stopProfile } = require('./vision');
const { sleep, login, likeTarget, likePost, commentPost, sharePost } = require('./facebook');

const TASK_CHECK_INTERVAL = parseInt(process.env.TASK_CHECK_INTERVAL) || 10000;

/**
 * Görevi işle
 */
async function processTask(task) {
    console.log(`\n========================================`);
    console.log(`Görev #${task.id} işleniyor: ${task.taskType}`);
    console.log(`========================================`);

    const account = task.account;
    let browser = null;
    let profileId = null;

    try {
        // Profil al veya oluştur
        profileId = await getOrCreateProfile(account.id, account.visionProfileId);
        if (!profileId) {
            console.error('Profil oluşturulamadı');
            await reportTaskResult(task.id, 'failed', 'Profil oluşturulamadı');
            return;
        }

        // Profil ID'yi kaydet
        if (profileId !== account.visionProfileId) {
            await updateAccountStatus(account.id, account.status, profileId);
        }

        // Browser'ı başlat
        browser = await startProfile(profileId);
        if (!browser) {
            console.error('Browser başlatılamadı');
            await reportTaskResult(task.id, 'failed', 'Browser başlatılamadı');
            return;
        }

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();

        // Görev tipine göre işlem yap
        let success = false;

        switch (task.taskType) {
            case 'login':
                success = await login(page, account.username, account.password);
                if (success) {
                    await updateAccountStatus(account.id, 'logged_in', profileId);
                } else {
                    await updateAccountStatus(account.id, 'failed', profileId);
                }
                break;

            case 'like_target':
                if (task.target) {
                    // Önce login kontrolü
                    await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
                    const url = page.url();

                    if (url.includes('login')) {
                        // Giriş yapılmamış, önce login yap
                        const loginSuccess = await login(page, account.username, account.password);
                        if (!loginSuccess) {
                            await reportTaskResult(task.id, 'failed', 'Giriş yapılamadı');
                            await updateAccountStatus(account.id, 'failed', profileId);
                            return;
                        }
                    }

                    success = await likeTarget(page, task.target.url, task.target.type);
                }
                break;

            case 'post_action':
                if (task.postTask) {
                    // Önce login kontrolü
                    await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
                    const url = page.url();

                    if (url.includes('login')) {
                        const loginSuccess = await login(page, account.username, account.password);
                        if (!loginSuccess) {
                            await reportTaskResult(task.id, 'failed', 'Giriş yapılamadı');
                            await updateAccountStatus(account.id, 'failed', profileId);
                            return;
                        }
                    }

                    switch (task.postTask.action) {
                        case 'like':
                            success = await likePost(page, task.postTask.postUrl);
                            break;
                        case 'comment':
                            success = await commentPost(page, task.postTask.postUrl, task.postTask.commentText);
                            break;
                        case 'share':
                            success = await sharePost(page, task.postTask.postUrl);
                            break;
                    }
                }
                break;
        }

        // Sonucu bildir
        await reportTaskResult(task.id, success ? 'completed' : 'failed', success ? 'Başarılı' : 'Başarısız');

    } catch (error) {
        console.error('Görev işleme hatası:', error);
        await reportTaskResult(task.id, 'failed', error.message);
    } finally {
        // Browser'ı kapat
        if (browser) {
            try {
                await browser.disconnect();
            } catch (e) { }
        }

        // Profili durdur
        if (profileId) {
            await stopProfile(profileId);
        }
    }
}

/**
 * Ana bot döngüsü
 */
async function main() {
    console.log('========================================');
    console.log('MetaSal Bot Başlatıldı');
    console.log(`Panel URL: ${process.env.PANEL_URL || 'http://localhost:3000'}`);
    console.log(`Vision API: ${process.env.VISION_API_URL || 'http://localhost:35599'}`);
    console.log(`Kontrol aralığı: ${TASK_CHECK_INTERVAL}ms`);
    console.log('========================================\n');

    while (true) {
        try {
            const task = await getPendingTask();

            if (task) {
                await processTask(task);
            } else {
                console.log('Bekleyen görev yok, bekleniyor...');
            }
        } catch (error) {
            console.error('Ana döngü hatası:', error);
        }

        await sleep(TASK_CHECK_INTERVAL);
    }
}

// Botu başlat
main().catch(console.error);
