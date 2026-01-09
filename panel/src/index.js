require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const accountsRoutes = require('./routes/accounts');
const targetsRoutes = require('./routes/targets');
const postsRoutes = require('./routes/posts');
const commentsRoutes = require('./routes/comments');
const apiRoutes = require('./routes/api');

const { requireAuth, requireSetup } = require('./middleware/auth');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'default-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 saat
    }
}));

// Local variables for views
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
});

// Routes
app.use('/', authRoutes);
app.use('/accounts', requireSetup, requireAuth, accountsRoutes);
app.use('/targets', requireSetup, requireAuth, targetsRoutes);
app.use('/posts', requireSetup, requireAuth, postsRoutes);
app.use('/comments', requireSetup, requireAuth, commentsRoutes);
app.use('/api', apiRoutes);

// Dashboard
app.get('/dashboard', requireSetup, requireAuth, async (req, res) => {
    try {
        const [
            totalAccounts,
            loggedInAccounts,
            failedAccounts,
            pendingTasks,
            totalTargets,
            totalPosts
        ] = await Promise.all([
            prisma.facebookAccount.count(),
            prisma.facebookAccount.count({ where: { status: 'logged_in' } }),
            prisma.facebookAccount.count({ where: { status: 'failed' } }),
            prisma.botTask.count({ where: { status: 'pending' } }),
            prisma.target.count(),
            prisma.postTask.count()
        ]);

        res.render('dashboard', {
            stats: {
                totalAccounts,
                loggedInAccounts,
                failedAccounts,
                pendingTasks,
                totalTargets,
                totalPosts
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Sunucu hatası');
    }
});

// Home redirect
app.get('/', async (req, res) => {
    const admin = await prisma.admin.findFirst();
    if (!admin) {
        return res.redirect('/setup');
    }
    if (req.session.adminId) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// Start server
app.listen(PORT, () => {
    console.log(`Panel çalışıyor: http://localhost:${PORT}`);
});
