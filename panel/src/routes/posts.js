const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Gönderi listesi
router.get('/', async (req, res) => {
    try {
        const posts = await prisma.postTask.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.render('posts', { posts, error: null, success: null });
    } catch (error) {
        console.error('Posts list error:', error);
        res.render('posts', { posts: [], error: 'Gönderiler yüklenemedi', success: null });
    }
});

// Gönderi görevi ekleme
router.post('/add', async (req, res) => {
    const { searchKeyword, targetLikes, targetComments, targetShares } = req.body;

    if (!searchKeyword || !searchKeyword.trim()) {
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('posts', { posts, error: 'Arama kelimesi gerekli', success: null });
    }

    const likes = parseInt(targetLikes) || 0;
    const comments = parseInt(targetComments) || 0;
    const shares = parseInt(targetShares) || 0;

    if (likes === 0 && comments === 0 && shares === 0) {
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('posts', { posts, error: 'En az bir hedef sayısı girilmeli', success: null });
    }

    // Yorum hedefi varsa yorum havuzunda yorum olmalı
    if (comments > 0) {
        const commentCount = await prisma.comment.count();
        if (commentCount === 0) {
            const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
            return res.render('posts', { posts, error: 'Yorum hedefi için önce Yorumlar sayfasından yorum ekleyin', success: null });
        }
    }

    try {
        // En az bir hedef beğenmiş aktif profilleri bul
        const eligibleProfiles = await prisma.visionProfile.findMany({
            where: {
                status: 'active',
                likedTargets: { some: {} }
            },
            orderBy: [{ lastRunAt: 'asc' }]
        });

        const profileCount = eligibleProfiles.length;
        if (profileCount === 0) {
            const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
            return res.render('posts', {
                posts,
                error: 'Gönderi görevleri için en az bir profilin en az bir sayfa/grup beğenmiş olması gerekir.',
                success: null
            });
        }

        // Kapasite Kontrolü: Tekil aksiyon sayısı profil sayısını aşamaz
        if (likes > profileCount || comments > profileCount || shares > profileCount) {
            const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
            return res.render('posts', {
                posts,
                error: `Kapasite aşımı! En fazla ${profileCount} beğeni, ${profileCount} yorum ve ${profileCount} paylaşım girebilirsiniz. (Toplam ${profileCount} aktif profiliniz var)`,
                success: null
            });
        }

        // Ana görevi oluştur
        const post = await prisma.postTask.create({
            data: {
                searchKeyword: searchKeyword.trim(),
                targetLikes: likes,
                targetComments: comments,
                targetShares: shares
            }
        });

        // AKILLI DAĞITIM ALGORİTMASI
        let tasksCreated = 0;

        // 1. Beğenileri Dağıt (0-index'ten başla)
        for (let i = 0; i < likes; i++) {
            const profile = eligibleProfiles[i];
            await createBotTask(post.id, profile.id, 'like');
            tasksCreated++;
        }

        // 2. Yorumları Dağıt (Beğenilerin bittiği yerden başla - çaprazlama için)
        for (let i = 0; i < comments; i++) {
            const profile = eligibleProfiles[(likes + i) % profileCount];
            await createBotTask(post.id, profile.id, 'comment');
            tasksCreated++;
        }

        // 3. Paylaşımları Dağıt (Yorumların bittiği yerden başla)
        for (let i = 0; i < shares; i++) {
            const profile = eligibleProfiles[(likes + comments + i) % profileCount];
            await createBotTask(post.id, profile.id, 'share');
            tasksCreated++;
        }

        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', {
            posts,
            error: null,
            success: `Görev oluşturuldu: ${likes} beğeni, ${comments} yorum, ${shares} paylaşım hedefi (${tasksCreated} görev ${profileCount} profile çakışmasız dağıtıldı)`
        });
    } catch (error) {
        console.error('Post add error:', error);
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', { posts, error: 'Görev eklenemedi', success: null });
    }
});

// Helper: Bot görevi oluştur
async function createBotTask(postTaskId, profileId, action) {
    return await prisma.botTask.create({
        data: {
            profileId,
            taskType: 'post_action',
            postTaskId,
            status: 'pending',
            result: action
        }
    });
}

// Görevi yeniden gönder (requeue)
router.post('/requeue/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const post = await prisma.postTask.findUnique({
            where: { id: parseInt(id) }
        });

        if (!post) {
            return res.redirect('/posts');
        }

        // Mevcut bot görevlerini sil
        await prisma.botTask.deleteMany({
            where: { postTaskId: parseInt(id) }
        });

        // Sayaçları sıfırla
        await prisma.postTask.update({
            where: { id: parseInt(id) },
            data: {
                doneLikes: 0,
                doneComments: 0,
                doneShares: 0,
                status: 'pending'
            }
        });

        // En az bir hedef beğenmiş aktif profilleri bul
        const eligibleProfiles = await prisma.visionProfile.findMany({
            where: {
                status: 'active',
                likedTargets: { some: {} }
            },
            orderBy: [{ lastRunAt: 'asc' }]
        });

        const profileCount = eligibleProfiles.length;
        if (profileCount === 0) {
            return res.redirect('/posts');
        }

        // Görevleri yeniden oluştur
        const likes = post.targetLikes;
        const comments = post.targetComments;
        const shares = post.targetShares;

        // 1. Beğenileri Dağıt
        for (let i = 0; i < likes && i < profileCount; i++) {
            const profile = eligibleProfiles[i];
            await createBotTask(post.id, profile.id, 'like');
        }

        // 2. Yorumları Dağıt
        for (let i = 0; i < comments && i < profileCount; i++) {
            const profile = eligibleProfiles[(likes + i) % profileCount];
            await createBotTask(post.id, profile.id, 'comment');
        }

        // 3. Paylaşımları Dağıt
        for (let i = 0; i < shares && i < profileCount; i++) {
            const profile = eligibleProfiles[(likes + comments + i) % profileCount];
            await createBotTask(post.id, profile.id, 'share');
        }

        res.redirect('/posts');
    } catch (error) {
        console.error('Post requeue error:', error);
        res.redirect('/posts');
    }
});

// Gönderi silme
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.postTask.delete({
            where: { id: parseInt(id) }
        });
        res.redirect('/posts');
    } catch (error) {
        console.error('Post delete error:', error);
        res.redirect('/posts');
    }
});

module.exports = router;
