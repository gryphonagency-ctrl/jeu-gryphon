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

function ensureFilesTable() {
    return getPool().query(
        'CREATE TABLE IF NOT EXISTS app_files (name TEXT PRIMARY KEY, content BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
}

function pushFile(name, content) {
    if (!enabled) return;
    ensureFilesTable()
        .then(() => getPool().query(
            'INSERT INTO app_files (name, content, updated_at) VALUES ($1, $2, now()) ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()',
            [name, Buffer.from(content)]
        ))
        .catch(error => console.error('Échec de la sauvegarde du fichier PostgreSQL :', error.message));
}

function deleteFile(name) {
    if (!enabled) return;
    ensureFilesTable()
        .then(() => getPool().query('DELETE FROM app_files WHERE name = $1', [name]))
        .catch(error => console.error('Échec de la suppression du fichier PostgreSQL :', error.message));
}

async function restoreFiles(directory) {
    if (!enabled) return 0;
    await ensureFilesTable();
    const result = await getPool().query('SELECT name, content FROM app_files');
    fs.mkdirSync(directory, { recursive: true });
    for (const row of result.rows) {
        if (!/^[a-f0-9-]{36}\.(?:html|png|jpe?g|webp)$/.test(row.name)) continue;
        fs.writeFileSync(path.join(directory, row.name), row.content, { mode: 0o600 });
    }
    return result.rows.length;
}

const BACKUP_KEEP = 40;

function offsiteCredentials() {
    const url = process.env.CLOUDINARY_URL?.match(/^cloudinary:\/\/(\d+):([^@]+)@([\w-]+)$/);
    if (url) return { apiKey: url[1], apiSecret: url[2], cloudName: url[3] };
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
    return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

async function uploadOffsiteBackup(content) {
    const credentials = offsiteCredentials();
    if (!credentials) return false;
    const { cloudName, apiKey, apiSecret } = credentials;
    const publicId = `gryphon-backups/arcade-${new Date().toISOString().slice(0, 10)}.json`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = require('crypto').createHash('sha1')
        .update(`overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
        .digest('hex');
    const form = new FormData();
    form.set('file', new Blob([content], { type: 'application/json' }), 'backup.json');
    form.set('api_key', apiKey);
    form.set('overwrite', 'true');
    form.set('public_id', publicId);
    form.set('timestamp', timestamp);
    form.set('signature', signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Cloudinary a répondu ${response.status}.`);
    return true;
}

async function runBackup() {
    if (!enabled) return;
    try {
        await ensureTable();
        await getPool().query(
            'CREATE TABLE IF NOT EXISTS app_backups (id SERIAL PRIMARY KEY, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())'
        );
        const current = await getPool().query("SELECT value FROM app_store WHERE key = 'accounts'");
        if (!current.rows.length) return;
        const content = current.rows[0].value;
        const latest = await getPool().query('SELECT content FROM app_backups ORDER BY id DESC LIMIT 1');
        if (!latest.rows.length || latest.rows[0].content !== content) {
            await getPool().query('INSERT INTO app_backups (content) VALUES ($1)', [content]);
            await getPool().query(
                'DELETE FROM app_backups WHERE id NOT IN (SELECT id FROM app_backups ORDER BY id DESC LIMIT $1)',
                [BACKUP_KEEP]
            );
            console.log('Sauvegarde automatique PostgreSQL effectuée.');
        }
        if (await uploadOffsiteBackup(content)) console.log('Sauvegarde externe Cloudinary effectuée.');
    } catch (error) {
        console.error('Échec de la sauvegarde automatique :', error.message);
    }
}

function startBackups() {
    if (!enabled) return;
    const hours = Number(process.env.BACKUP_INTERVAL_HOURS);
    const intervalMs = (Number.isFinite(hours) && hours > 0 ? hours : 6) * 3600 * 1000;
    setTimeout(runBackup, 2 * 60 * 1000).unref();
    setInterval(runBackup, intervalMs).unref();
}

async function close() {
    while (flushing || pending) await new Promise(resolve => setTimeout(resolve, 50));
    if (pool) await pool.end();
}

module.exports = { enabled, push, restore, pushFile, deleteFile, restoreFiles, startBackups, runBackup, close };

if (require.main === module) {
    const { storeFile, getGameFilesDirectory } = require('./account-store');
    restore('accounts', storeFile)
        .then(() => restoreFiles(getGameFilesDirectory()))
        .then(count => { if (count) console.log(`${count} fichier(s) de jeu restauré(s) depuis PostgreSQL.`); })
        .then(close)
        .catch(error => {
            console.error('Restauration PostgreSQL impossible :', error.message);
            process.exit(1);
        });
}
