const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Hesap listesi
router.get('/', async (req, res) => {
    try {
        const accounts = await prisma.facebookAccount.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.render('accounts', { accounts, error: null, success: null });
    } catch (error) {
        console.error('Accounts list error:', error);
        res.render('accounts', { accounts: [], error: 'Hesaplar yüklenemedi', success: null });
    }
});

// Hesap ekleme
router.post('/add', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        const accounts = await prisma.facebookAccount.findMany({ orderBy: { createdAt: 'desc' } });
        return res.render('accounts', { accounts, error: 'Kullanıcı adı ve şifre gerekli', success: null });
    }

    try {
        const account = await prisma.facebookAccount.create({
            data: { username, password }
        });

        // Login görevi oluştur
        await prisma.botTask.create({
            data: {
                accountId: account.id,
                taskType: 'login',
                status: 'pending'
            }
        });

        const accounts = await prisma.facebookAccount.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('accounts', { accounts, error: null, success: 'Hesap eklendi' });
    } catch (error) {
        console.error('Account add error:', error);
        const accounts = await prisma.facebookAccount.findMany({ orderBy: { createdAt: 'desc' } });
        res.render('accounts', { accounts, error: 'Hesap eklenemedi', success: null });
    }
});

// Hesap silme
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.facebookAccount.delete({
            where: { id: parseInt(id) }
        });
        res.redirect('/accounts');
    } catch (error) {
        console.error('Account delete error:', error);
        res.redirect('/accounts');
    }
});

// Giriş yeniden dene
router.post('/retry/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await prisma.facebookAccount.update({
            where: { id: parseInt(id) },
            data: { status: 'pending' }
        });

        await prisma.botTask.create({
            data: {
                accountId: parseInt(id),
                taskType: 'login',
                status: 'pending'
            }
        });

        res.redirect('/accounts');
    } catch (error) {
        console.error('Account retry error:', error);
        res.redirect('/accounts');
    }
});

module.exports = router;
