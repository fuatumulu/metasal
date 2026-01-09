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

// Vision profillerini senkronize et (Görev oluşturur)
router.post('/sync', async (req, res) => {
    try {
        // Zaten bekleyen bir senkronizasyon görevi var mı kontrol et
        const existingTask = await prisma.botTask.findFirst({
            where: {
                taskType: 'sync_profiles',
                status: { in: ['pending', 'processing'] }
            }
        });

        if (!existingTask) {
            await prisma.botTask.create({
                data: {
                    taskType: 'sync_profiles',
                    status: 'pending'
                }
            });
        }

        const profiles = await prisma.visionProfile.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedTargets: true, tasks: true } } }
        });

        res.render('profiles', {
            profiles,
            error: null,
            success: 'Senkronizasyon görevi oluşturuldu. Botun işleme alması bekleniyor...'
        });
    } catch (error) {
        console.error('Sync task creation error:', error);
        res.redirect('/profiles');
    }
});

// Kuyruğu Optimize Et (Eksik beğeni görevlerini topluca oluşturur)
router.post('/optimize', async (req, res) => {
    try {
        // 1. Tüm aktif profilleri ve hedefleri al
        const profiles = await prisma.visionProfile.findMany({ where: { status: 'active' } });
        const targets = await prisma.target.findMany();

        let createdCount = 0;

        for (const target of targets) {
            // Bu hedefi zaten beğenmiş profil ID'lerini al
            const alreadyLiked = await prisma.profileLikedTarget.findMany({
                where: { targetId: target.id },
                select: { profileId: true }
            });
            const likedIds = alreadyLiked.map(al => al.profileId);

            for (const profile of profiles) {
                // Eğer profil bu hedefi beğenmemişse
                if (!likedIds.includes(profile.id)) {
                    // Ve bekleyen/işlenen bir görevi yoksa
                    const existingTask = await prisma.botTask.findFirst({
                        where: {
                            profileId: profile.id,
                            targetId: target.id,
                            taskType: 'like_target',
                            status: { in: ['pending', 'processing'] }
                        }
                    });

                    if (!existingTask) {
                        await prisma.botTask.create({
                            data: {
                                profileId: profile.id,
                                targetId: target.id,
                                taskType: 'like_target',
                                status: 'pending'
                            }
                        });
                        createdCount++;
                    }
                }
            }
        }

        const allProfiles = await prisma.visionProfile.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedTargets: true, tasks: true } } }
        });

        res.render('profiles', {
            profiles: allProfiles,
            error: null,
            success: `Kuyruk optimize edildi. ${createdCount} adet eksik görev oluşturuldu.`
        });
    } catch (error) {
        console.error('Queue optimize error:', error);
        res.redirect('/profiles');
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
