const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Hedef listesi
router.get('/', async (req, res) => {
    try {
        const targets = await prisma.target.findMany({
            orderBy: { createdAt: 'desc' }
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

        // Tüm aktif hesaplar için beğeni görevi oluştur
        const accounts = await prisma.facebookAccount.findMany({
            where: { status: 'logged_in' }
        });

        for (const account of accounts) {
            await prisma.botTask.create({
                data: {
                    accountId: account.id,
                    taskType: 'like_target',
                    targetId: target.id,
                    status: 'pending'
                }
            });
        }

        const targets = await prisma.target.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('targets', { targets, error: null, success: 'Hedef eklendi' });
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

// Yeniden beğen
router.post('/retry/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.target.update({
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
                    taskType: 'like_target',
                    targetId: parseInt(id),
                    status: 'pending'
                }
            });
        }

        res.redirect('/targets');
    } catch (error) {
        console.error('Target retry error:', error);
        res.redirect('/targets');
    }
});

module.exports = router;
