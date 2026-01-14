const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Hedef listesi
router.get('/', async (req, res) => {
    try {
        const targets = await prisma.target.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: { likedBy: true }
                }
            }
        });
        res.render('targets', { targets, error: null, success: null });
    } catch (error) {
        console.error('Targets list error:', error);
        res.render('targets', { targets: [], error: 'Hedefler yüklenemedi', success: null });
    }
});

// Hedef ekleme
router.post('/add', async (req, res) => {
    const { type, url, name } = req.body;

    if (!type || !url) {
        const targets = await prisma.target.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('targets', { targets, error: 'Tip ve URL gerekli', success: null });
    }

    try {
        const target = await prisma.target.create({
            data: { type, url, name: name || null }
        });

        // Tüm aktif profiller için beğeni görevi oluştur
        const profiles = await prisma.visionProfile.findMany({
            where: { status: 'active' }
        });

        for (const profile of profiles) {
            await prisma.botTask.create({
                data: {
                    profileId: profile.id,
                    taskType: 'like_target',
                    targetId: target.id,
                    status: 'pending'
                }
            });
        }

        const targets = await prisma.target.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedBy: true } } }
        });
        res.render('targets', { targets, error: null, success: `Hedef eklendi, ${profiles.length} profil için görev oluşturuldu.` });
    } catch (error) {
        console.error('Target add error:', error);
        const targets = await prisma.target.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('targets', { targets, error: 'Hedef eklenemedi', success: null });
    }
});

// Hedef silme
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.target.delete({
            where: { id: parseInt(id) }
        });
        res.redirect('/targets');
    } catch (error) {
        console.error('Target delete error:', error);
        res.redirect('/targets');
    }
});

// Hedef durumunu değiştir (aktif/pasif)
router.post('/toggle/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const target = await prisma.target.findUnique({
            where: { id: parseInt(id) }
        });

        if (target) {
            await prisma.target.update({
                where: { id: parseInt(id) },
                data: {
                    isActive: !target.isActive
                }
            });
        }
        res.redirect('/targets');
    } catch (error) {
        console.error('Target toggle error:', error);
        res.redirect('/targets');
    }
});

// Yeniden beğen (Sadece bu hedefi henüz beğenmemiş olan aktif profiller için)
router.post('/retry/:id', async (req, res) => {
    const { id } = req.params;
    const targetId = parseInt(id);

    try {
        // Bu hedefi zaten beğenmiş profilleri bul
        const alreadyLiked = await prisma.profileLikedTarget.findMany({
            where: { targetId },
            select: { profileId: true }
        });
        const likedProfileIds = alreadyLiked.map(al => al.profileId);

        // Henüz beğenmemiş aktif profilleri bul
        const profilesToTask = await prisma.visionProfile.findMany({
            where: {
                status: 'active',
                id: { notIn: likedProfileIds }
            }
        });

        for (const profile of profilesToTask) {
            // Bekleyen aynı görev varsa mükerrer oluşturma
            const existingTask = await prisma.botTask.findFirst({
                where: {
                    profileId: profile.id,
                    taskType: 'like_target',
                    targetId: targetId,
                    status: 'pending'
                }
            });

            if (!existingTask) {
                await prisma.botTask.create({
                    data: {
                        profileId: profile.id,
                        taskType: 'like_target',
                        targetId: targetId,
                        status: 'pending'
                    }
                });
            }
        }

        res.redirect('/targets');
    } catch (error) {
        console.error('Target retry error:', error);
        res.redirect('/targets');
    }
});

// Boost - Bu hedefi beğenmiş tüm profiller için boost görevi oluştur
router.post('/boost/:id', async (req, res) => {
    const targetId = parseInt(req.params.id);
    const postCount = parseInt(req.body.postCount) || 4;

    try {
        // Bu hedefi beğenmiş profilleri bul
        const likedProfiles = await prisma.profileLikedTarget.findMany({
            where: { targetId },
            include: { profile: true }
        });

        if (likedProfiles.length === 0) {
            const targets = await prisma.target.findMany({
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { likedBy: true } } }
            });
            return res.render('targets', {
                targets,
                error: 'Bu hedefi henüz beğenmiş profil yok!',
                success: null
            });
        }

        let createdCount = 0;
        for (const liked of likedProfiles) {
            // Aktif profiller için görev oluştur
            if (liked.profile.status === 'active') {
                // Aynı görev zaten pending ise tekrar oluşturma
                const existingTask = await prisma.botTask.findFirst({
                    where: {
                        profileId: liked.profileId,
                        taskType: 'boost_target',
                        targetId: targetId,
                        status: 'pending'
                    }
                });

                if (!existingTask) {
                    await prisma.botTask.create({
                        data: {
                            profileId: liked.profileId,
                            taskType: 'boost_target',
                            targetId: targetId,
                            status: 'pending',
                            result: postCount.toString() // postCount'u result alanında sakla
                        }
                    });
                    createdCount++;
                }
            }
        }

        const targets = await prisma.target.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { likedBy: true } } }
        });
        res.render('targets', {
            targets,
            error: null,
            success: `Boost başlatıldı! ${createdCount} profil için görev oluşturuldu (${postCount} gönderi/profil).`
        });
    } catch (error) {
        console.error('Target boost error:', error);
        const targets = await prisma.target.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('targets', { targets, error: 'Boost görevi oluşturulamadı', success: null });
    }
});

module.exports = router;

