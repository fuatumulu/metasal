const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Bekleyen görevleri al
router.get('/tasks/pending', async (req, res) => {
    try {
        const task = await prisma.botTask.findFirst({
            where: { status: 'pending' },
            include: {
                profile: true,
                target: true,
                postTask: true
            },
            orderBy: { createdAt: 'asc' }
        });

        if (!task) {
            return res.json({ task: null });
        }

        // Görevi processing olarak işaretle
        await prisma.botTask.update({
            where: { id: task.id },
            data: { status: 'processing' }
        });

        // Profil varsa lastRunAt güncelle
        if (task.profileId) {
            await prisma.visionProfile.update({
                where: { id: task.profileId },
                data: { lastRunAt: new Date() }
            });
        }

        res.json({ task });
    } catch (error) {
        console.error('Get pending task error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Görev sonucunu bildir
router.post('/tasks/:id/result', async (req, res) => {
    const { id } = req.params;
    const { status, result } = req.body;

    if (!status || !['completed', 'failed'].includes(status)) {
        return res.status(400).json({ error: 'Geçersiz durum' });
    }

    try {
        // Önce görevin orijinal halini (özellikle result içindeki action tipini) alalım
        const originalTask = await prisma.botTask.findUnique({
            where: { id: parseInt(id) }
        });

        if (!originalTask) {
            return res.status(404).json({ error: 'Görev bulunamadı' });
        }

        const task = await prisma.botTask.update({
            where: { id: parseInt(id) },
            data: { status, result: result || null },
            include: { profile: true, target: true, postTask: true }
        });

        // Hedef beğeni başarılıysa ProfileLikedTarget ekle
        if (task.taskType === 'like_target' && status === 'completed' && task.targetId) {
            try {
                await prisma.profileLikedTarget.upsert({
                    where: {
                        profileId_targetId: {
                            profileId: task.profileId,
                            targetId: task.targetId
                        }
                    },
                    update: {},
                    create: {
                        profileId: task.profileId,
                        targetId: task.targetId
                    }
                });
            } catch (e) {
                console.error('ProfileLikedTarget update error:', e);
            }
        }

        // Hedef durumunu güncelle (Genel durum)
        if (task.taskType === 'like_target' && task.targetId) {
            const completedCount = await prisma.botTask.count({
                where: { targetId: task.targetId, status: 'completed' }
            });

            if (completedCount > 0) {
                await prisma.target.update({
                    where: { id: task.targetId },
                    data: { status: 'completed' }
                });
            }
        }

        // Gönderi durumunu güncelle
        if (task.taskType === 'post_action' && task.postTaskId) {
            // Tamamlanan görevin action tipini bul
            // Bot action tipini report ederken result'ın sonuna ekleyebilir veya başından beri result alanında duruyor olabilir
            // Bizim sistemimizde action tipi görev oluşturulurken result alanına yazılıyor. 
            // Bot report ederken result alanını ezebilir. Bu yüzden action tipini bir yerde tutmamız lazım.
            // Ama Prisma şemamızda BotTask modelinde action tipi için ayrı alan yok. 
            // Bot'un gönderdiği JSON içindeki action'ı alalım veya görevin orijinal halinden bakalım.

            // Not: BotTask.result alanını görev oluştururken action tipi için kullandık. 
            // Bot report ederken status: 'completed' gönderdiğinde biz o action tipini originalTask'tan almalıyız.
            const action = originalTask.result; // like, comment, share

            const updateData = {};
            if (action === 'like') updateData.doneLikes = { increment: 1 };
            else if (action === 'comment') updateData.doneComments = { increment: 1 };
            else if (action === 'share') updateData.doneShares = { increment: 1 };

            if (status === 'completed' && Object.keys(updateData).length > 0) {
                await prisma.postTask.update({
                    where: { id: task.postTaskId },
                    data: updateData
                });
            }

            // Genel durumu kontrol et
            const pendingCount = await prisma.botTask.count({
                where: { postTaskId: task.postTaskId, status: { in: ['pending', 'processing'] } }
            });

            if (pendingCount === 0) {
                const postTask = await prisma.postTask.findUnique({ where: { id: task.postTaskId } });
                const allDone = postTask.doneLikes >= postTask.targetLikes &&
                    postTask.doneComments >= postTask.targetComments &&
                    postTask.doneShares >= postTask.targetShares;

                await prisma.postTask.update({
                    where: { id: task.postTaskId },
                    data: { status: allDone ? 'completed' : 'failed' }
                });
            } else {
                await prisma.postTask.update({
                    where: { id: task.postTaskId },
                    data: { status: 'in_progress' }
                });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Task result error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Profilleri senkronize et (Bot tarafından gönderilir)
router.post('/profiles/push', async (req, res) => {
    const { profiles } = req.body;

    if (!Array.isArray(profiles)) {
        return res.status(400).json({ error: 'Geçersiz profil listesi' });
    }

    try {
        let addedCount = 0;
        let updatedCount = 0;

        for (const vp of profiles) {
            const existing = await prisma.visionProfile.findUnique({
                where: { visionId: vp.visionId }
            });

            let profile;
            if (existing) {
                profile = await prisma.visionProfile.update({
                    where: { id: existing.id },
                    data: {
                        name: vp.name || vp.visionId,
                        folderId: vp.folderId,
                        lastSyncedAt: new Date()
                    }
                });
                updatedCount++;
            } else {
                profile = await prisma.visionProfile.create({
                    data: {
                        visionId: vp.visionId,
                        folderId: vp.folderId,
                        name: vp.name || vp.visionId,
                        status: 'active', // Yeni profiller varsayılan olarak aktif
                        lastSyncedAt: new Date()
                    }
                });
                addedCount++;
            }
        }

        res.json({ success: true, addedCount, updatedCount });
    } catch (error) {
        console.error('Profile push error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Bot logu kaydet
router.post('/logs', async (req, res) => {
    const { level, type, message, details } = req.body;

    try {
        await prisma.botLog.create({
            data: {
                level: level || 'info',
                type: type || 'SYSTEM',
                message: message || '',
                details: details ? JSON.stringify(details) : null
            }
        });

        // OTOMATİK TEMİZLEME: En güncel 50 logu tut, gerisini sil
        const logCount = await prisma.botLog.count();
        if (logCount > 50) {
            const lastLogs = await prisma.botLog.findMany({
                take: 50,
                orderBy: { createdAt: 'desc' },
                select: { id: true }
            });

            const idsToKeep = lastLogs.map(l => l.id);

            await prisma.botLog.deleteMany({
                where: {
                    id: { notIn: idsToKeep }
                }
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Log save error:', error);
        res.status(500).json({ error: 'Log kaydedilemedi' });
    }
});

// API: Rastgele yorum getir (bot için - yetkilendirme gerektirmez)
router.get('/comments/random', async (req, res) => {
    try {
        const count = await prisma.comment.count();
        if (count === 0) {
            return res.json({ comment: null });
        }

        const skip = Math.floor(Math.random() * count);
        const comment = await prisma.comment.findFirst({
            skip,
            take: 1
        });

        // Kullanım sayısını artır
        if (comment) {
            await prisma.comment.update({
                where: { id: comment.id },
                data: { usedCount: { increment: 1 } }
            });
        }

        res.json({ comment });
    } catch (error) {
        console.error('Random comment error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

module.exports = router;

