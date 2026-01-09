const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, redirectIfAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Setup sayfası
router.get('/setup', async (req, res) => {
    const admin = await prisma.admin.findFirst();
    if (admin) {
        return res.redirect('/login');
    }
    res.render('setup', { error: null });
});

// Setup işlemi
router.post('/setup', async (req, res) => {
    const admin = await prisma.admin.findFirst();
    if (admin) {
        return res.redirect('/login');
    }

    const { username, password, confirmPassword } = req.body;

    if (!username || !password) {
        return res.render('setup', { error: 'Kullanıcı adı ve şifre gerekli' });
    }

    if (password !== confirmPassword) {
        return res.render('setup', { error: 'Şifreler eşleşmiyor' });
    }

    if (password.length < 6) {
        return res.render('setup', { error: 'Şifre en az 6 karakter olmalı' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.admin.create({
            data: {
                username,
                password: hashedPassword
            }
        });
        res.redirect('/login');
    } catch (error) {
        console.error('Setup error:', error);
        res.render('setup', { error: 'Bir hata oluştu' });
    }
});

// Login sayfası
router.get('/login', redirectIfAuth, async (req, res) => {
    const admin = await prisma.admin.findFirst();
    if (!admin) {
        return res.redirect('/setup');
    }
    res.render('login', { error: null });
});

// Login işlemi
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const admin = await prisma.admin.findUnique({
            where: { username }
        });

        if (!admin) {
            return res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
        }

        const validPassword = await bcrypt.compare(password, admin.password);
        if (!validPassword) {
            return res.render('login', { error: 'Geçersiz kullanıcı adı veya şifre' });
        }

        req.session.adminId = admin.id;
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'Bir hata oluştu' });
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;
