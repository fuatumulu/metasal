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
        // En uzun süredir çalışmamış profil önce seçilsin (lastRunAt null olanlar en başta)
        const eligibleProfiles = await prisma.visionProfile.findMany({
            where: {
                status: 'active',
                likedTargets: {
                    some: {} // En az bir tane varsa
                }
            },
            orderBy: [
                { lastRunAt: 'asc' }  // En eski (null dahil) en başta
            ]
        });

        if (eligibleProfiles.length === 0) {
            const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
            return res.render('posts', {
                posts,
                error: 'Gönderi görevleri için en az bir profilin en az bir sayfa/grup beğenmiş olması gerekir.',
                success: null
            });
        }

        const post = await prisma.postTask.create({
            data: {
                searchKeyword: searchKeyword.trim(),
                targetLikes: likes,
                targetComments: comments,
                targetShares: shares
            }
        });

        // Toplam görev sayısını hesapla
        const totalTasks = likes + comments + shares;
        let tasksCreated = 0;

        // Görevleri profillere dağıt
        for (let i = 0; i < totalTasks; i++) {
            const profile = eligibleProfiles[i % eligibleProfiles.length];

            let action = 'like';
            if (i < likes) {
                action = 'like';
            } else if (i < likes + comments) {
                action = 'comment';
            } else {
                action = 'share';
            }

            await prisma.botTask.create({
                data: {
                    profileId: profile.id,
                    taskType: 'post_action',
                    postTaskId: post.id,
                    status: 'pending',
                    result: action // Action tipini result'ta sakla
                }
            });
            tasksCreated++;
        }

        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', {
            posts,
            error: null,
            success: `Görev oluşturuldu: ${likes} beğeni, ${comments} yorum, ${shares} paylaşım hedefi (${tasksCreated} görev ${eligibleProfiles.length} profile dağıtıldı)`
        });
    } catch (error) {
        console.error('Post add error:', error);
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', { posts, error: 'Görev eklenemedi', success: null });
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
