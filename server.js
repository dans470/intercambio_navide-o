import express from 'express';
import pg from 'pg';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. En Render, agrega la Internal Database URL de PostgreSQL en Environment para este Web Service.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error('Falta ADMIN_PASSWORD. Configura una contraseña secreta en Environment para este Web Service.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: false } } : {}),
});

app.use(express.json({ limit: '32kb' }));

async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS exchanges (
    id BIGSERIAL PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    names JSONB NOT NULL,
    assignments JSONB NOT NULL,
    revealed JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  const received = req.get('x-admin-password') || '';
  if (!expected) return res.status(503).json({ error: 'El administrador aún no configuró ADMIN_PASSWORD en Render.' });
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Contraseña incorrecta.' });
  next();
}

function cleanNames(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim().slice(0, 50);
    const key = name.toLocaleLowerCase('es');
    if (name && !seen.has(key)) { seen.add(key); names.push(name); }
  }
  return names;
}

function makeAssignments(names) {
  // Sattolo's shuffle makes one cycle, so nobody draws themselves.
  const shuffled = [...names];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(names.map((name, index) => [name, shuffled[index]]));
}

function publicExchange(row) {
  return { token: row.token, title: row.title, names: row.names, revealed: row.revealed };
}
function adminExchange(row) {
  return { id: row.id, ...publicExchange(row) };
}

app.get('/api/admin/exchanges', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, token, title, names, revealed FROM exchanges ORDER BY created_at DESC');
    res.json({ exchanges: rows.map(adminExchange) });
  } catch (error) { next(error); }
});

app.post('/api/admin/exchanges', requireAdmin, async (req, res, next) => {
  try {
    const names = cleanNames(req.body.names);
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    if (names.length < 3) return res.status(400).json({ error: 'Agrega al menos 3 nombres diferentes.' });
    if (!title) return res.status(400).json({ error: 'Escribe un nombre para el intercambio.' });
    const token = randomBytes(24).toString('base64url');
    const { rows } = await pool.query(
      'INSERT INTO exchanges (token, title, names, assignments) VALUES ($1, $2, $3, $4) RETURNING id, token, title, names, revealed',
      [token, title, JSON.stringify(names), JSON.stringify(makeAssignments(names))],
    );
    res.status(201).json(adminExchange(rows[0]));
  } catch (error) { next(error); }
});

app.put('/api/admin/exchanges/:id', requireAdmin, async (req, res, next) => {
  try {
    const names = cleanNames(req.body.names);
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    if (names.length < 3) return res.status(400).json({ error: 'Agrega al menos 3 nombres diferentes.' });
    if (!title) return res.status(400).json({ error: 'Escribe un nombre para el intercambio.' });
    const { rows } = await pool.query(
      `UPDATE exchanges SET title=$1, names=$2, assignments=$3, revealed='[]'::jsonb
       WHERE id=$4 RETURNING id, token, title, names, revealed`,
      [title, JSON.stringify(names), JSON.stringify(makeAssignments(names)), req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'No se encontró el intercambio.' });
    res.json(adminExchange(rows[0]));
  } catch (error) { next(error); }
});

app.get('/api/exchanges/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT token, title, names, revealed FROM exchanges WHERE token=$1', [req.params.token]);
    if (!rows[0]) return res.status(404).json({ error: 'No se encontró este intercambio. Revisa que el enlace esté completo.' });
    res.json(publicExchange(rows[0]));
  } catch (error) { next(error); }
});

app.post('/api/exchanges/:token/draw', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT token, names, assignments, revealed FROM exchanges WHERE token=$1 FOR UPDATE', [req.params.token]);
    const exchange = rows[0];
    if (!exchange) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No se encontró este intercambio.' }); }
    const name = typeof req.body.name === 'string' ? req.body.name : '';
    if (!exchange.names.includes(name)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Ese nombre no pertenece al intercambio.' }); }
    if (exchange.revealed.includes(name)) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Este nombre ya descubrió su resultado.' }); }
    const result = exchange.assignments[name];
    await client.query('UPDATE exchanges SET revealed = revealed || $1::jsonb WHERE token=$2', [JSON.stringify([name]), req.params.token]);
    await client.query('COMMIT');
    res.json({ name: result });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use(express.static(path.join(here, 'dist')));
app.get(/.*/, (_req, res) => res.sendFile(path.join(here, 'dist', 'index.html')));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Error del servidor. Intenta más tarde.' });
});

initDatabase().then(() => app.listen(port, () => console.log(`Noche de regalos lista en el puerto ${port}`))).catch((error) => {
  console.error('No se pudo conectar a PostgreSQL:', error);
  process.exit(1);
});
