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
                account: true,
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
        const task = await prisma.botTask.update({
            where: { id: parseInt(id) },
            data: { status, result: result || null },
            include: { account: true, target: true, postTask: true }
        });

        // Hesap login durumunu güncelle
        if (task.taskType === 'login') {
            await prisma.facebookAccount.update({
                where: { id: task.accountId },
                data: {
                    status: status === 'completed' ? 'logged_in' : 'failed',
                    lastChecked: new Date()
                }
            });
        }

        // Hedef durumunu güncelle
        if (task.taskType === 'like_target' && task.targetId) {
            const failedCount = await prisma.botTask.count({
                where: { targetId: task.targetId, status: 'failed' }
            });
            const completedCount = await prisma.botTask.count({
                where: { targetId: task.targetId, status: 'completed' }
            });

            if (completedCount > 0) {
                await prisma.target.update({
                    where: { id: task.targetId },
                    data: { status: 'liked' }
                });
            } else if (failedCount > 0) {
                await prisma.target.update({
                    where: { id: task.targetId },
                    data: { status: 'failed' }
                });
            }
        }

        // Gönderi durumunu güncelle
        if (task.taskType === 'post_action' && task.postTaskId) {
            const failedCount = await prisma.botTask.count({
                where: { postTaskId: task.postTaskId, status: 'failed' }
            });
            const completedCount = await prisma.botTask.count({
                where: { postTaskId: task.postTaskId, status: 'completed' }
            });

            if (completedCount > 0) {
                await prisma.postTask.update({
                    where: { id: task.postTaskId },
                    data: { status: 'completed' }
                });
            } else if (failedCount > 0) {
                await prisma.postTask.update({
                    where: { id: task.postTaskId },
                    data: { status: 'failed' }
                });
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Task result error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Hesap listesi
router.get('/accounts', async (req, res) => {
    try {
        const accounts = await prisma.facebookAccount.findMany({
            select: {
                id: true,
                username: true,
                password: true,
                status: true,
                visionProfileId: true
            }
        });
        res.json({ accounts });
    } catch (error) {
        console.error('Get accounts error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Hesap durumu güncelle
router.post('/accounts/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, visionProfileId } = req.body;

    try {
        await prisma.facebookAccount.update({
            where: { id: parseInt(id) },
            data: {
                status,
                visionProfileId: visionProfileId || undefined,
                lastChecked: new Date()
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Update account status error:', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

module.exports = router;
