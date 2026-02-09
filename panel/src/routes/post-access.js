const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Gönderi Erişim Takibi sayfası
router.get('/', async (req, res) => {
    try {
        // Telegram config al
        const telegramConfig = await prisma.telegramConfig.findFirst();

        // Takip edilen URL'leri al
        const tracks = await prisma.postAccessTrack.findMany({
            include: {
                profile: {
                    select: { id: true, name: true, visionId: true, folderId: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.render('post-access', {
            telegramConfig,
            tracks: tracks.map(track => ({
                ...track,
                lastCheckedAt: track.lastCheckedAt
                    ? new Date(track.lastCheckedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
                    : 'Henüz kontrol edilmedi',
                createdAt: new Date(track.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
            }))
        });
    } catch (error) {
        console.error('Post Access page error:', error);
        res.status(500).send('Sunucu hatası');
    }
});

// Telegram konfigürasyonunu kaydet
router.post('/telegram-config', async (req, res) => {
    const { botToken, chatId, isActive } = req.body;

    try {
        const existing = await prisma.telegramConfig.findFirst();

        if (existing) {
            await prisma.telegramConfig.update({
                where: { id: existing.id },
                data: {
                    botToken: botToken || existing.botToken,
                    chatId: chatId || existing.chatId,
                    isActive: isActive === 'true' || isActive === true
                }
            });
        } else {
            await prisma.telegramConfig.create({
                data: {
                    botToken,
                    chatId,
                    isActive: isActive === 'true' || isActive === true
                }
            });
        }

        res.redirect('/post-access');
    } catch (error) {
        console.error('Telegram config save error:', error);
        res.redirect('/post-access');
    }
});

// Vision profilleri al (folder ID'ye göre)
router.get('/profiles/:folderId', async (req, res) => {
    const { folderId } = req.params;

    try {
        const profiles = await prisma.visionProfile.findMany({
            where: { folderId },
            select: { id: true, name: true, visionId: true, status: true },
            orderBy: { name: 'asc' }
        });

        res.json({ success: true, profiles });
    } catch (error) {
        console.error('Get profiles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Yeni URL ekle
router.post('/add', async (req, res) => {
    const { url, profileId } = req.body;

    if (!url || !profileId) {
        return res.redirect('/post-access?error=missing_fields');
    }

    try {
        await prisma.postAccessTrack.create({
            data: {
                url,
                profileId: parseInt(profileId)
            }
        });

        res.redirect('/post-access');
    } catch (error) {
        console.error('Add URL error:', error);
        // Unique constraint hatası
        if (error.code === 'P2002') {
            return res.redirect('/post-access?error=url_exists');
        }
        res.redirect('/post-access?error=server_error');
    }
});

// URL durumunu değiştir
router.post('/:id/toggle-status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        await prisma.postAccessTrack.update({
            where: { id: parseInt(id) },
            data: { status }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Link eklendi işaretle
router.post('/:id/mark-link-added', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.postAccessTrack.update({
            where: { id: parseInt(id) },
            data: { status: 'link_added' }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Mark link added error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// URL sil
router.post('/:id/delete', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.postAccessTrack.delete({
            where: { id: parseInt(id) }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Delete URL error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
