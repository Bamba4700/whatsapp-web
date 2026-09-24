const express = require('express');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');

const pool = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const {
  getCsrfToken,
  requireCsrf,
} = require('../middleware/csrf');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'Trop de tentatives. Réessayez dans 15 minutes.',
  },
});

// Utilisé pour effectuer une comparaison même si le compte n’existe pas.
const dummyHash = bcrypt.hashSync(
  randomBytes(32).toString('hex'),
  12
);

function validPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    Buffer.byteLength(password, 'utf8') <= 72
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
  };
}

async function openSession(req, userId) {
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  req.session.userId = userId;
  const csrfToken = getCsrfToken(req);

  await new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  return csrfToken;
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/csrf', (req, res) => {
  res.json({
    csrfToken: getCsrfToken(req),
  });
});

router.post('/register', authLimiter, requireCsrf, async (req, res) => {
  const { username, displayName, password } = req.body || {};

  if (
    typeof username !== 'string' ||
    typeof displayName !== 'string' ||
    !validPassword(password)
  ) {
    return res.status(400).json({
      error:
        'Champs invalides. Le mot de passe doit contenir au moins ' +
        '8 caractères et ne pas dépasser 72 octets.',
    });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedName = displayName.trim();

  if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
    return res.status(400).json({
      error:
        'Identifiant : 3 à 30 caractères, lettres sans accent, ' +
        'chiffres ou tiret bas.',
    });
  }

  if (normalizedName.length < 1 || normalizedName.length > 80) {
    return res.status(400).json({
      error: 'Le nom affiché doit contenir entre 1 et 80 caractères.',
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `
      INSERT INTO users (username, display_name, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username, display_name
    `,
    [normalizedUsername, normalizedName, passwordHash]
  );

  if (result.rowCount === 0) {
    return res.status(409).json({
      error: 'Cet identifiant est déjà utilisé.',
    });
  }

  const user = result.rows[0];
  const csrfToken = await openSession(req, user.id);

  res.status(201).json({
    user: publicUser(user),
    csrfToken,
  });
});

router.post('/login', authLimiter, requireCsrf, async (req, res) => {
  const { username, password } = req.body || {};

  if (
    typeof username !== 'string' ||
    !validPassword(password)
  ) {
    return res.status(401).json({
      error: 'Identifiant ou mot de passe incorrect.',
    });
  }

  const normalizedUsername = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
    return res.status(401).json({
      error: 'Identifiant ou mot de passe incorrect.',
    });
  }

  const result = await pool.query(
    `
      SELECT id, username, display_name, password_hash
      FROM users
      WHERE username = $1
    `,
    [normalizedUsername]
  );

  const user = result.rows[0];

  const matches = await bcrypt.compare(
    password,
    user ? user.password_hash : dummyHash
  );

  if (!user || !matches) {
    return res.status(401).json({
      error: 'Identifiant ou mot de passe incorrect.',
    });
  }

  const csrfToken = await openSession(req, user.id);

  res.json({
    user: publicUser(user),
    csrfToken,
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `
      SELECT id, username, display_name
      FROM users
      WHERE id = $1
    `,
    [req.session.userId]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({
      error: 'Compte introuvable. Veuillez vous reconnecter.',
    });
  }

  res.json({
    user: publicUser(result.rows[0]),
  });
});

router.post('/logout', requireCsrf, async (req, res) => {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  res.clearCookie('webrtc.sid', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });

  res.json({
    message: 'Déconnexion réussie.',
  });
});

module.exports = router;