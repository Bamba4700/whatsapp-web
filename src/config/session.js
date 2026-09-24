require('./env');

const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const pool = require('./database');

const secret = process.env.SESSION_SECRET;

if (!secret || secret.length < 64) {
  throw new Error(
    'SESSION_SECRET absent ou trop court dans .env'
  );
}

const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 900,
});

const sessionMiddleware = session({
  store: sessionStore,
  name: 'webrtc.sid',
  secret,
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  },
});

module.exports = {
  sessionMiddleware,
  sessionStore,
};