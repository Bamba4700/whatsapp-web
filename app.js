const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const express = require('express');

const pool = require('./src/config/database');
const { ensureBucket } = require('./src/config/storage');

const { sessionMiddleware } = require('./src/config/session');
const authRoutes = require('./src/routes/auth');

const usersRoutes = require('./src/routes/users');

const conversationsRoutes =
  require('./src/routes/conversations');
const messagesRoutes =
  require('./src/routes/messages');
const { Server } = require('socket.io');

const {
  configureSocket,
} = require('./src/realtime/socket');

const filesRoutes =
  require('./src/routes/files');


const app = express();
const PORT = 3000;

app.disable('x-powered-by');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '32kb' }));

app.use(express.urlencoded({
  extended: false,
  limit: '32kb',
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use(sessionMiddleware);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use(
  '/api/conversations',
  conversationsRoutes
);
app.use(
  '/api/conversations',
  messagesRoutes
);
app.use(
  '/api/conversations',
  filesRoutes
);

app.use(
  '/api',
  filesRoutes
);

app.get('/', (req, res) => {
  res.render('index', {
    title: 'Projet de messagerie WebRTC',
  });
});

app.use((req, res) => {
  res.status(404).send('Page introuvable');
});

app.use((error, req, res, next) => {
  console.error('Erreur HTTP :', error.message);

  if (res.headersSent) {
    return next(error);
  }

  const status = error.status === 400
    ? 400
    : error.status === 413
      ? 413
      : 500;

  res.status(status).send(
    status === 500
      ? 'Une erreur interne est survenue.'
      : 'La requête est invalide ou trop volumineuse.'
  );
});

let server;
let io;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;

  console.log('\nArrêt du serveur...');

  const timeout = setTimeout(() => {
    process.exit(1);
  }, 10000);

  timeout.unref();

  try {
    if (io) {

  await new Promise((resolve) => {
    io.close(() => {
      resolve();
    });
  });

  io = null;

} else if (server?.listening) {

  await new Promise((resolve, reject) => {

    server.close((error) => {

      if (error) {
        reject(error);
      } else {
        resolve();
      }

    });

  });
}

    await pool.end();
    clearTimeout(timeout);
  } catch (error) {
    console.error('Erreur à l’arrêt :', error.message);
    process.exitCode = 1;
  }
}

async function start() {
  const tlsOptions = {
    cert: fs.readFileSync(
      path.join(__dirname, 'certs/localhost.pem')
    ),
    key: fs.readFileSync(
      path.join(__dirname, 'certs/localhost-key.pem')
    ),
    minVersion: 'TLSv1.2',
  };

  await pool.query('SELECT 1');
  console.log('[OK] PostgreSQL accessible');

  await ensureBucket();
  console.log('[OK] MinIO accessible');

  server = https.createServer(tlsOptions, app);
  io = new Server(server, {
  serveClient: true,
});

configureSocket(
  io,
  sessionMiddleware
);

app.set('io', io);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`Serveur démarré : https://localhost:${PORT}`);
}


start().catch(async (error) => {
  console.error('[HTTP ERROR]', {
  method: req.method,
  url: req.originalUrl,
  contentType: req.headers['content-type'],
  contentLength: req.headers['content-length'],
  code: error.code,
  type: error.type,
  message: error.message,
  received: error.received,
  expected: error.expected,
  stack: error.stack,
});
  await pool.end();
  process.exitCode = 1;
});