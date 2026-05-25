const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Add a PostgreSQL database on Render.');
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function initDb() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await getPool().query(sql);
}

async function ensureSession(sessionId) {
  await getPool().query(
    `INSERT INTO workspace_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [sessionId]
  );
}

module.exports = { getPool, initDb, ensureSession };
