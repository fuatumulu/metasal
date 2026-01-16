const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Facebook Login sayfası
router.get('/', async (req, res) => {
    try {
        const accounts = await prisma.facebookAccount.findMany({
            orderBy: { createdAt: 'desc' }
        });

        // Durum istatistikleri
        const stats = {
            pending: accounts.filter(a => a.status === 'pending').length,
            processing: accounts.filter(a => a.status === 'processing').length,
            success: accounts.filter(a => a.status === 'success').length,
            failed: accounts.filter(a => ['cookie_failed', 'login_failed'].includes(a.status)).length,
            needsVerify: accounts.filter(a => a.status === 'needs_verify').length
        };

        res.render('fb-login', { accounts, stats });
    } catch (error) {
        console.error('FB Login sayfası hatası:', error);
        res.status(500).send('Sunucu hatası');
    }
});

// Toplu hesap ekleme
router.post('/bulk-add', async (req, res) => {
    try {
        const { accountsText } = req.body;

        if (!accountsText || !accountsText.trim()) {
            return res.redirect('/fb-login?error=empty');
        }

        const lines = accountsText.trim().split('\n').filter(line => line.trim());
        const addedAccounts = [];
        const errors = [];

        for (const line of lines) {
            const parts = line.trim().split(':');

            // Minimum: kullanıcı:şifre::IP veya kullanıcı:şifre:cookie:IP
            if (parts.length < 4) {
                errors.push(`Geçersiz format: ${line.substring(0, 30)}...`);
                continue;
            }

            const [username, password, cookie, proxyIP] = parts;

            if (!username || !password || !proxyIP) {
                errors.push(`Eksik bilgi: ${username || 'kullanıcı yok'}`);
                continue;
            }

            // Aynı kullanıcı adı var mı kontrol et
            const existing = await prisma.facebookAccount.findFirst({
                where: { username: username.trim() }
            });

            if (existing) {
                errors.push(`Zaten var: ${username}`);
                continue;
            }

            const account = await prisma.facebookAccount.create({
                data: {
                    username: username.trim(),
                    password: password.trim(),
                    cookie: cookie && cookie.trim() ? cookie.trim() : null,
                    proxyIP: proxyIP.trim(),
                    status: 'pending'
                }
            });

            addedAccounts.push(account);
        }

        const message = `${addedAccounts.length} hesap eklendi${errors.length > 0 ? `, ${errors.length} hata` : ''}`;
        res.redirect(`/fb-login?success=${encodeURIComponent(message)}`);
    } catch (error) {
        console.error('Toplu hesap ekleme hatası:', error);
        res.redirect('/fb-login?error=server');
    }
});

// Hesap silme
router.post('/delete/:id', async (req, res) => {
    try {
        await prisma.facebookAccount.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.redirect('/fb-login');
    } catch (error) {
        console.error('Hesap silme hatası:', error);
        res.redirect('/fb-login?error=delete');
    }
});

// Tek hesabı yeniden dene
router.post('/retry/:id', async (req, res) => {
    try {
        await prisma.facebookAccount.update({
            where: { id: parseInt(req.params.id) },
            data: {
                status: 'pending',
                errorMessage: null
            }
        });
        res.redirect('/fb-login');
    } catch (error) {
        console.error('Yeniden deneme hatası:', error);
        res.redirect('/fb-login?error=retry');
    }
});

// Tüm hatalı hesapları yeniden dene
router.post('/retry-all-failed', async (req, res) => {
    try {
        await prisma.facebookAccount.updateMany({
            where: {
                status: { in: ['cookie_failed', 'login_failed'] }
            },
            data: {
                status: 'pending',
                errorMessage: null
            }
        });
        res.redirect('/fb-login');
    } catch (error) {
        console.error('Toplu yeniden deneme hatası:', error);
        res.redirect('/fb-login?error=retry');
    }
});

// Tüm hesapları temizle
router.post('/clear-all', async (req, res) => {
    try {
        await prisma.facebookAccount.deleteMany({});
        res.redirect('/fb-login');
    } catch (error) {
        console.error('Temizleme hatası:', error);
        res.redirect('/fb-login?error=clear');
    }
});

// ==================== API Endpoints (Bot için) ====================

// Sonraki bekleyen hesabı al (Bot tarafından çağrılır)
router.get('/api/next-pending', async (req, res) => {
    try {
        const account = await prisma.facebookAccount.findFirst({
            where: { status: 'pending' },
            orderBy: { createdAt: 'asc' }
        });

        if (!account) {
            return res.json({ success: false, message: 'Bekleyen hesap yok' });
        }

        // İşleniyor olarak işaretle
        await prisma.facebookAccount.update({
            where: { id: account.id },
            data: { status: 'processing' }
        });

        res.json({ success: true, account });
    } catch (error) {
        console.error('API hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Hesap durumunu güncelle (Bot tarafından çağrılır)
router.post('/api/update-status', async (req, res) => {
    try {
        const { accountId, status, visionId, folderId, errorMessage } = req.body;

        const updateData = { status };

        if (visionId) updateData.visionId = visionId;
        if (folderId) updateData.folderId = folderId;
        if (errorMessage) updateData.errorMessage = errorMessage;

        if (['cookie_failed', 'login_failed'].includes(status)) {
            // Hata durumunda retry count artır
            await prisma.facebookAccount.update({
                where: { id: accountId },
                data: {
                    ...updateData,
                    retryCount: { increment: 1 }
                }
            });
        } else {
            await prisma.facebookAccount.update({
                where: { id: accountId },
                data: updateData
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Status güncelleme hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// İşlem başlatma sinyali (Panel'den bota)
router.post('/api/start-processing', async (req, res) => {
    try {
        const pendingCount = await prisma.facebookAccount.count({
            where: { status: 'pending' }
        });

        if (pendingCount === 0) {
            return res.json({ success: false, message: 'Bekleyen hesap yok' });
        }

        // Bot bu endpoint'i polling ile kontrol edecek
        res.json({ success: true, pendingCount, command: 'start' });
    } catch (error) {
        console.error('Start processing hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// İşlem durumu (Bot için polling)
router.get('/api/should-process', async (req, res) => {
    try {
        const pendingCount = await prisma.facebookAccount.count({
            where: { status: 'pending' }
        });

        const processingCount = await prisma.facebookAccount.count({
            where: { status: 'processing' }
        });

        res.json({
            success: true,
            shouldProcess: pendingCount > 0 && processingCount === 0,
            pendingCount,
            processingCount
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Operatör müdahalesi tamamlandı bildirimi
router.post('/api/operator-done/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { success, errorMessage } = req.body;

        await prisma.facebookAccount.update({
            where: { id: parseInt(id) },
            data: {
                status: success ? 'success' : 'login_failed',
                errorMessage: errorMessage || null
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Operatör tamamlama hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
