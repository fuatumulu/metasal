require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const profilesRoutes = require('./routes/profiles');
const targetsRoutes = require('./routes/targets');
const postsRoutes = require('./routes/posts');
const commentsRoutes = require('./routes/comments');
const apiRoutes = require('./routes/api');
const fbLoginRoutes = require('./routes/fb-login');

const { requireAuth, requireSetup } = require('./middleware/auth');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Trust proxy (EasyPanel/Traefik için HTTPS desteği)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session
if (!process.env.SESSION_SECRET) {
    console.warn('UYARI: SESSION_SECRET ayarlanmamış! Güvenlik için lütfen .env dosyasında tanımlayın.');
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-extremely-long-and-random-secret-for-dev-only-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Üretim ortamında sadece HTTPS
        httpOnly: true, // XSS koruması
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
app.use('/profiles', requireSetup, requireAuth, profilesRoutes);
app.use('/targets', requireSetup, requireAuth, targetsRoutes);
app.use('/posts', requireSetup, requireAuth, postsRoutes);
app.use('/comments', requireSetup, requireAuth, commentsRoutes);
app.use('/api', apiRoutes);
app.use('/fb-login', requireSetup, requireAuth, fbLoginRoutes);

// Dashboard
app.get('/dashboard', requireSetup, requireAuth, async (req, res) => {
    try {
        const [
            totalProfiles,
            activeProfiles,
            pendingTasks,
            totalTargets,
            totalPosts,
            totalComments,
            logs
        ] = await Promise.all([
            prisma.visionProfile.count(),
            prisma.visionProfile.count({ where: { status: 'active' } }),
            prisma.botTask.count({ where: { status: 'pending' } }),
            prisma.target.count(),
            prisma.postTask.count(),
            prisma.comment.count(),
            prisma.botLog.findMany({
                take: 50,
                orderBy: { createdAt: 'desc' }
            })
        ]);

        res.render('dashboard', {
            stats: {
                totalProfiles,
                activeProfiles,
                pendingTasks,
                totalTargets,
                totalPosts,
                totalComments
            },
            logs: logs.map(log => ({
                ...log,
                createdAt: new Date(log.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
            }))
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Sunucu hatası');
    }
});

// Dashboard: Logları temizle
app.post('/dashboard/clear-logs', requireSetup, requireAuth, async (req, res) => {
    try {
        await prisma.botLog.deleteMany({});
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Clear logs error:', error);
        res.redirect('/dashboard');
    }
});

// Dashboard: Bekleyen görevleri temizle
app.post('/dashboard/clear-pending-tasks', requireSetup, requireAuth, async (req, res) => {
    try {
        await prisma.botTask.deleteMany({
            where: { status: { in: ['pending', 'processing'] } }
        });
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Clear pending tasks error:', error);
        res.redirect('/dashboard');
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
