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
    const { postUrl, action, commentText } = req.body;

    if (!postUrl || !action) {
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('posts', { posts, error: 'Gönderi URL ve eylem gerekli', success: null });
    }

    if (action === 'comment' && !commentText) {
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('posts', { posts, error: 'Yorum metni gerekli', success: null });
    }

    try {
        const post = await prisma.postTask.create({
            data: {
                postUrl,
                action,
                commentText: action === 'comment' ? commentText : null
            }
        });

        // Tüm aktif hesaplar için görev oluştur
        const accounts = await prisma.facebookAccount.findMany({
            where: { status: 'logged_in' }
        });

        for (const account of accounts) {
            await prisma.botTask.create({
                data: {
                    accountId: account.id,
                    taskType: 'post_action',
                    postTaskId: post.id,
                    status: 'pending'
                }
            });
        }

        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', { posts, error: null, success: 'Gönderi görevi eklendi' });
    } catch (error) {
        console.error('Post add error:', error);
        const posts = await prisma.postTask.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('posts', { posts, error: 'Gönderi eklenemedi', success: null });
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

// Yeniden çalıştır
router.post('/retry/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.postTask.update({
            where: { id: parseInt(id) },
            data: { status: 'pending' }
        });

        const accounts = await prisma.facebookAccount.findMany({
            where: { status: 'logged_in' }
        });

        for (const account of accounts) {
            await prisma.botTask.create({
                data: {
                    accountId: account.id,
                    taskType: 'post_action',
                    postTaskId: parseInt(id),
                    status: 'pending'
                }
            });
        }

        res.redirect('/posts');
    } catch (error) {
        console.error('Post retry error:', error);
        res.redirect('/posts');
    }
});

module.exports = router;
