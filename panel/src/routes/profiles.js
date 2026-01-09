const express = require('express');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const router = express.Router();
const prisma = new PrismaClient();

// Bot API URL (bot'un çalıştığı adres)
const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3001';

// Profil listesi
router.get('/', async (req, res) => {
    try {
        const profiles = await prisma.visionProfile.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { likedTargets: true, tasks: true }
                }
            }
        });
        res.render('profiles', { profiles, error: null, success: null });
    } catch (error) {
        console.error('Profiles list error:', error);
        res.render('profiles', { profiles: [], error: 'Profiller yüklenemedi', success: null });
    }
});

// Vision profillerini senkronize et
router.post('/sync', async (req, res) => {
    try {
        // Bot'tan Vision profillerini al
        const response = await axios.get(`${BOT_API_URL}/vision-profiles`, { timeout: 30000 });
        const visionProfiles = response.data.profiles || [];

        if (visionProfiles.length === 0) {
            const profiles = await prisma.visionProfile.findMany({
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { likedTargets: true, tasks: true } } }
            });
            return res.render('profiles', { profiles, error: 'Vision\'da profil bulunamadı', success: null });
        }

        let addedCount = 0;
        let updatedCount = 0;

        for (const vp of visionProfiles) {
            const existing = await prisma.visionProfile.findUnique({
                where: { visionId: vp.uuid }
            });

            if (existing) {
                // Güncelle
                await prisma.visionProfile.update({
                    where: { id: existing.id },
                    data: {
                        name: vp.name || vp.uuid,
                        lastSyncedAt: new Date()
                    }
                });
                updatedCount++;
            } else {
                // Yeni ekle
                await prisma.visionProfile.create({
                    data: {
                        visionId: vp.uuid,
                        name: vp.name || vp.uuid,
                        lastSyncedAt: new Date()
                    }
                });
                addedCount++;
            }
        }

        const profiles = await prisma.visionProfile.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedTargets: true, tasks: true } } }
        });

        const message = `Senkronizasyon tamamlandı: ${addedCount} yeni, ${updatedCount} güncellendi`;
        res.render('profiles', { profiles, error: null, success: message });
    } catch (error) {
        console.error('Sync error:', error);
        const profiles = await prisma.visionProfile.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedTargets: true, tasks: true } } }
        });

        let errorMsg = 'Senkronizasyon başarısız';
        if (error.code === 'ECONNREFUSED') {
            errorMsg = 'Bot\'a bağlanılamadı. Bot çalışıyor mu?';
        }

        res.render('profiles', { profiles, error: errorMsg, success: null });
    }
});

// Profil durumunu değiştir (aktif/devre dışı)
router.post('/toggle/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const profile = await prisma.visionProfile.findUnique({
            where: { id: parseInt(id) }
        });

        if (profile) {
            await prisma.visionProfile.update({
                where: { id: parseInt(id) },
                data: {
                    status: profile.status === 'active' ? 'disabled' : 'active'
                }
            });
        }
        res.redirect('/profiles');
    } catch (error) {
        console.error('Toggle error:', error);
        res.redirect('/profiles');
    }
});

// Profil sil
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.visionProfile.delete({
            where: { id: parseInt(id) }
        });
        res.redirect('/profiles');
    } catch (error) {
        console.error('Profile delete error:', error);
        res.redirect('/profiles');
    }
});

// Profilin beğendiği hedefleri görüntüle
router.get('/:id/likes', async (req, res) => {
    const { id } = req.params;

    try {
        const profile = await prisma.visionProfile.findUnique({
            where: { id: parseInt(id) },
            include: {
                likedTargets: {
                    include: { target: true },
                    orderBy: { likedAt: 'desc' }
                }
            }
        });

        if (!profile) {
            return res.redirect('/profiles');
        }

        res.render('profile-likes', { profile, error: null });
    } catch (error) {
        console.error('Profile likes error:', error);
        res.redirect('/profiles');
    }
});

module.exports = router;
