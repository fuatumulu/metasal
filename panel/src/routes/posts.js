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
    const { searchKeyword, targetLikes, targetComments, targetShares, commentText } = req.body;

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

    if (comments > 0 && (!commentText || !commentText.trim())) {
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('posts', { posts, error: 'Yorum hedefi için yorum metni gerekli', success: null });
    }

    try {
        const post = await prisma.postTask.create({
            data: {
                searchKeyword: searchKeyword.trim(),
                targetLikes: likes,
                targetComments: comments,
                targetShares: shares,
                commentText: comments > 0 ? commentText.trim() : null
            }
        });

        // Aktif hesaplar için görevler oluştur
        const accounts = await prisma.facebookAccount.findMany({
            where: { status: 'logged_in' }
        });

        // Toplam görev sayısını hesapla
        const totalTasks = likes + comments + shares;
        let tasksCreated = 0;

        // Görevleri hesaplara dağıt
        for (let i = 0; i < totalTasks && accounts.length > 0; i++) {
            const account = accounts[i % accounts.length];

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
                    accountId: account.id,
                    taskType: 'post_action',
                    postTaskId: post.id,
                    status: 'pending',
                    result: action // Action'ı result'ta sakla
                }
            });
            tasksCreated++;
        }

        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', {
            posts,
            error: null,
            success: `Görev oluşturuldu: ${likes} beğeni, ${comments} yorum, ${shares} paylaşım hedefi (${tasksCreated} görev queue'ye eklendi)`
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
