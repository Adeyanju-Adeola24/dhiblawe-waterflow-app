import { Router } from 'express';
import { queryAll, queryOne, execute } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req, res) => {
  const { all } = req.query;
  const sql = all ? 'SELECT * FROM plate_numbers ORDER BY plate' : 'SELECT * FROM plate_numbers WHERE is_active = 1 ORDER BY plate';
  res.json(await queryAll(sql));
});

router.get('/:id', auth, async (req, res) => {
  const p = await queryOne('SELECT * FROM plate_numbers WHERE id = $1', [req.params.id]);
  if (!p) throw new AppError(404, 'Plate not found');
  res.json(p);
});

router.post('/', auth, requireRole('super_admin'), async (req, res) => {
  const { plate, default_rate } = req.body;
  if (!plate) throw new AppError(400, 'Plate number required');
  try {
    const { rows } = await execute('INSERT INTO plate_numbers (plate, default_rate) VALUES ($1,$2) RETURNING id', [plate.toUpperCase(), default_rate || 0]);
    res.status(201).json(await queryOne('SELECT * FROM plate_numbers WHERE id = $1', [rows[0].id]));
  } catch { throw new AppError(409, 'Plate number already exists'); }
});

router.put('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const p = await queryOne('SELECT * FROM plate_numbers WHERE id = $1', [req.params.id]);
  if (!p) throw new AppError(404, 'Plate not found');
  const { plate, default_rate, is_active } = req.body;
  await execute('UPDATE plate_numbers SET plate=$1, default_rate=$2, is_active=$3, updated_at=NOW() WHERE id=$4',
    [plate ? plate.toUpperCase() : p.plate, default_rate !== undefined ? default_rate : p.default_rate,
     is_active !== undefined ? (is_active ? 1 : 0) : p.is_active, req.params.id]);
  res.json(await queryOne('SELECT * FROM plate_numbers WHERE id = $1', [req.params.id]));
});

router.delete('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const p = await queryOne('SELECT * FROM plate_numbers WHERE id = $1', [req.params.id]);
  if (!p) throw new AppError(404, 'Plate not found');
  await execute('DELETE FROM plate_numbers WHERE id = $1', [req.params.id]);
  res.json({ message: 'Plate deleted' });
});

export default router;
