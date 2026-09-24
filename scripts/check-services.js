const { randomUUID } = require('node:crypto');
const pool = require('../src/config/database');
const {
  storage,
  bucket,
  ensureBucket,
} = require('../src/config/storage');

async function checkDatabase() {
  const result = await pool.query(
    'SELECT current_database() AS database'
  );

  console.log(
    `[OK] PostgreSQL connecté : ${result.rows[0].database}`
  );

  const expectedTables = [
    'users',
    'conversations',
    'conversation_members',
    'messages',
    'calls',
    'call_participants',
  ];

  const resultTables = await pool.query(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
    `,
    [expectedTables]
  );

  const found = new Set(
    resultTables.rows.map((row) => row.tablename)
  );

  const missing = expectedTables.filter(
    (name) => !found.has(name)
  );

  if (missing.length > 0) {
    throw new Error(
      `Tables manquantes : ${missing.join(', ')}`
    );
  }

  console.log('[OK] Les 6 tables sont présentes');
}

async function checkStorage() {
  await ensureBucket();

  console.log(`[OK] Bucket MinIO accessible : ${bucket}`);

  const objectName = `checks/${randomUUID()}.txt`;
  const content = Buffer.from(
    'Verification stockage WebRTC',
    'utf8'
  );

  let uploaded = false;

  try {
    await storage.putObject(
      bucket,
      objectName,
      content,
      content.length,
      { 'Content-Type': 'text/plain' }
    );

    uploaded = true;

    const stream = await storage.getObject(
      bucket,
      objectName
    );

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const received = Buffer.concat(chunks);

    if (!received.equals(content)) {
      throw new Error(
        'Le contenu relu dans MinIO est différent'
      );
    }

    console.log(
      '[OK] Écriture et lecture MinIO réussies'
    );
  } finally {
    if (uploaded) {
      await storage.removeObject(bucket, objectName);

      console.log(
        '[OK] Fichier temporaire supprimé'
      );
    }
  }
}

async function main() {
  try {
    await checkDatabase();
    await checkStorage();

    console.log('\nConnexions du serveur validées.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ÉCHEC]', error.message);
  process.exitCode = 1;
});