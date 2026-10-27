const fs = require('fs');
const path = require('path');

const enabled = Boolean(process.env.DATABASE_URL);
let pool = null;
let ready = null;
let pending = null;
let flushing = false;

function getPool() {
    if (!pool) {
        const { Pool } = require('pg');
        const local = /@(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL);
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: local ? false : { rejectUnauthorized: false },
            max: 2
        });
        pool.on('error', error => console.warn('PostgreSQL :', error.message));
    }
    return pool;
}

function ensureTable() {
    ready ||= getPool().query(
        'CREATE TABLE IF NOT EXISTS app_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    return ready;
}

async function flush() {
    if (flushing) return;
    flushing = true;
    try {
        while (pending) {
            const { key, value } = pending;
            pending = null;
            try {
                await ensureTable();
                await getPool().query(
                    'INSERT INTO app_store (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
                    [key, value]
                );
            } catch (error) {
                console.error('Échec de la sauvegarde PostgreSQL :', error.message);
            }
        }
    } finally {
        flushing = false;
    }
}

function push(key, value) {
    if (!enabled) return;
    pending = { key, value };
    flush();
}

async function restore(key, file) {
    if (!enabled) return false;
    await ensureTable();
    const result = await getPool().query('SELECT value FROM app_store WHERE key = $1', [key]);
    if (!result.rows.length) {
        if (fs.existsSync(file)) {
            push(key, fs.readFileSync(file, 'utf8'));
            console.log('Base vide : import du fichier local vers PostgreSQL.');
        }
        return false;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, result.rows[0].value, { mode: 0o600 });
    console.log('Données restaurées depuis PostgreSQL.');
    return true;
}

async function close() {
    while (flushing || pending) await new Promise(resolve => setTimeout(resolve, 50));
    if (pool) await pool.end();
}

module.exports = { enabled, push, restore, close };

if (require.main === module) {
    const { storeFile } = require('./account-store');
    restore('accounts', storeFile)
        .then(close)
        .catch(error => {
            console.error('Restauration PostgreSQL impossible :', error.message);
            process.exit(1);
        });
}
