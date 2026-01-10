const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Yorum listesi
router.get('/', async (req, res) => {
    try {
        const comments = await prisma.comment.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.render('comments', { comments, error: null, success: null });
    } catch (error) {
        console.error('Comments list error:', error);
        res.render('comments', { comments: [], error: 'Yorumlar yüklenemedi', success: null });
    }
});

// Tek yorum ekleme
router.post('/add', async (req, res) => {
    const { text } = req.body;

    if (!text || !text.trim()) {
        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('comments', { comments, error: 'Yorum metni gerekli', success: null });
    }

    try {
        await prisma.comment.create({
            data: { text: text.trim() }
        });

        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('comments', { comments, error: null, success: 'Yorum eklendi' });
    } catch (error) {
        console.error('Comment add error:', error);
        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('comments', { comments, error: 'Yorum eklenemedi', success: null });
    }
});

// Toplu yorum ekleme
router.post('/bulk-add', async (req, res) => {
    const { bulkComments } = req.body;

    if (!bulkComments || !bulkComments.trim()) {
        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('comments', { comments, error: 'Yorum listesi boş', success: null });
    }

    try {
        const lines = bulkComments.trim().split('\n');
        let addedCount = 0;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            await prisma.comment.create({
                data: { text: trimmedLine }
            });
            addedCount++;
        }

        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('comments', { comments, error: null, success: `${addedCount} yorum eklendi` });
    } catch (error) {
        console.error('Bulk add error:', error);
        const comments = await prisma.comment.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('comments', { comments, error: 'Toplu ekleme başarısız', success: null });
    }
});

// Yorum silme
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.comment.delete({
            where: { id: parseInt(id) }
        });
        res.redirect('/comments');
    } catch (error) {
        console.error('Comment delete error:', error);
        res.redirect('/comments');
    }
});

// Tümünü sil
router.post('/delete-all', async (req, res) => {
    try {
        await prisma.comment.deleteMany({});
        res.redirect('/comments');
    } catch (error) {
        console.error('Delete all error:', error);
        res.redirect('/comments');
    }
});

module.exports = router;
