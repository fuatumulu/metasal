const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Setup tamamlandı mı kontrol et
async function checkSetup(req, res, next) {
  const admin = await prisma.admin.findFirst();
  req.setupComplete = !!admin;
  next();
}

// Setup tamamlanmamışsa setup'a yönlendir
async function requireSetup(req, res, next) {
  const admin = await prisma.admin.findFirst();
  if (!admin) {
    return res.redirect('/setup');
  }
  next();
}

// Login zorunlu
function requireAuth(req, res, next) {
  if (!req.session.adminId) {
    return res.redirect('/login');
  }
  next();
}

// Zaten login ise dashboard'a yönlendir
function redirectIfAuth(req, res, next) {
  if (req.session.adminId) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = {
  checkSetup,
  requireSetup,
  requireAuth,
  redirectIfAuth
};
