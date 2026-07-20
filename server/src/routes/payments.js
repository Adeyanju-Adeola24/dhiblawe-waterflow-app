import { Router } from 'express';
import { queryAll, queryOne, execute, transaction } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req, res) => {
  const { client_id, date_from, date_to } = req.query;
  let sql = 'SELECT p.*, c.name as client_name FROM payments p JOIN clients c ON p.client_id = c.id WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND p.client_id = $' + (params.length + 1); params.push(client_id); }
  if (date_from) { sql += ' AND p.payment_date >= $' + (params.length + 1); params.push(date_from); }
  if (date_to) { sql += ' AND p.payment_date <= $' + (params.length + 1); params.push(date_to); }
  sql += ' ORDER BY p.created_at DESC';
  res.json(await queryAll(sql, params));
});

router.post('/', auth, requireRole('super_admin', 'data_entry'), async (req, res) => {
  const { client_id, amount, payment_date, note } = req.body;
  if (!client_id || !amount) throw new AppError(400, 'Client and amount required');
  const client = await queryOne('SELECT * FROM clients WHERE id = $1', [client_id]);
  if (!client) throw new AppError(404, 'Client not found');

  let newId;
  await transaction(async () => {
    const { rows } = await execute('INSERT INTO payments (client_id, amount, payment_date, note) VALUES ($1,$2,$3,$4) RETURNING id',
      [client_id, amount, payment_date || new Date().toISOString().split('T')[0], note || null]);
    newId = rows[0].id;
    const unpaid = await queryOne("SELECT COALESCE(SUM(amount - deposit_used), 0) as total FROM trips WHERE client_id = $1 AND (payment_status = 'Unpaid' OR payment_status = 'Outstanding')", [client_id]);
    const paid = await queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM trips WHERE client_id = $1 AND payment_status = 'Paid'", [client_id]);
    const payments = await queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE client_id = $1', [client_id]);
    const depositsRemaining = await queryOne('SELECT COALESCE(SUM(remaining), 0) as total FROM deposits WHERE client_id = $1', [client_id]);
    const totalCharged = (unpaid?.total || 0) + (paid?.total || 0);
    const totalPaid = (payments?.total || 0) + (paid?.total || 0);
    const balance = totalCharged - totalPaid - (depositsRemaining?.total || 0);
    await execute('UPDATE clients SET balance = $1 WHERE id = $2', [balance, client_id]);
  });
  const p = await queryOne('SELECT p.*, c.name as client_name FROM payments p JOIN clients c ON p.client_id = c.id WHERE p.id = $1', [newId]);
  res.status(201).json(p);
});

router.delete('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const p = await queryOne('SELECT * FROM payments WHERE id = $1', [req.params.id]);
  if (!p) throw new AppError(404, 'Payment not found');
  await transaction(async () => {
    await execute('DELETE FROM payments WHERE id = $1', [req.params.id]);
    const unpaid = await queryOne("SELECT COALESCE(SUM(amount - deposit_used), 0) as total FROM trips WHERE client_id = $1 AND (payment_status = 'Unpaid' OR payment_status = 'Outstanding')", [p.client_id]);
    const paid = await queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM trips WHERE client_id = $1 AND payment_status = 'Paid'", [p.client_id]);
    const payments = await queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE client_id = $1', [p.client_id]);
    const depositsRemaining = await queryOne('SELECT COALESCE(SUM(remaining), 0) as total FROM deposits WHERE client_id = $1', [p.client_id]);
    const totalCharged = (unpaid?.total || 0) + (paid?.total || 0);
    const totalPaid = (payments?.total || 0) + (paid?.total || 0);
    const balance = totalCharged - totalPaid - (depositsRemaining?.total || 0);
    await execute('UPDATE clients SET balance = $1 WHERE id = $2', [balance, p.client_id]);
  });
  res.json({ message: 'Payment deleted' });
});

export default router;
