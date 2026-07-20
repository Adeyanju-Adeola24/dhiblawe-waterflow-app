import { Router } from 'express';
import { queryAll, queryOne, execute } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req, res) => {
  const { all } = req.query;
  const sql = all ? 'SELECT * FROM clients ORDER BY name' : 'SELECT * FROM clients WHERE is_active = 1 ORDER BY name';
  res.json(await queryAll(sql));
});

router.get('/:id', auth, async (req, res) => {
  const c = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!c) throw new AppError(404, 'Client not found');
  res.json(c);
});

router.post('/', auth, requireRole('super_admin', 'data_entry'), async (req, res) => {
  const { name, address } = req.body;
  if (!name) throw new AppError(400, 'Client name required');
  const { rows } = await execute('INSERT INTO clients (name, address) VALUES ($1,$2) RETURNING id', [name, address || null]);
  res.status(201).json(await queryOne('SELECT * FROM clients WHERE id = $1', [rows[0].id]));
});

router.put('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const c = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!c) throw new AppError(404, 'Client not found');
  const { name, address, is_active } = req.body;
  await execute('UPDATE clients SET name=$1, address=$2, is_active=$3, updated_at=NOW() WHERE id=$4',
    [name || c.name, address !== undefined ? address : c.address, is_active !== undefined ? (is_active ? 1 : 0) : c.is_active, req.params.id]);
  res.json(await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]));
});

router.delete('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const c = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!c) throw new AppError(404, 'Client not found');
  await execute('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ message: 'Client deleted' });
});

export default router;
