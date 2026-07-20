import { Router } from 'express';
import { queryAll, queryOne, execute, transaction } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req, res) => {
  const { client_id } = req.query;
  let sql = 'SELECT d.*, c.name as client_name FROM deposits d JOIN clients c ON d.client_id = c.id WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND d.client_id = $' + (params.length + 1); params.push(client_id); }
  sql += ' ORDER BY d.created_at DESC';
  res.json(await queryAll(sql, params));
});

router.post('/', auth, requireRole('super_admin', 'data_entry'), async (req, res) => {
  const { client_id, amount, deposit_date, note } = req.body;
  if (!client_id || !amount) throw new AppError(400, 'Client and amount required');
  const client = await queryOne('SELECT * FROM clients WHERE id = $1', [client_id]);
  if (!client) throw new AppError(404, 'Client not found');

  let newId;
  await transaction(async () => {
    const { rows } = await execute('INSERT INTO deposits (client_id, amount, remaining, deposit_date, note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [client_id, amount, amount, deposit_date || new Date().toISOString().split('T')[0], note || null]);
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

  const d = await queryOne('SELECT d.*, c.name as client_name FROM deposits d JOIN clients c ON d.client_id = c.id WHERE d.id = $1', [newId]);
  res.status(201).json(d);
});

router.delete('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const d = await queryOne('SELECT * FROM deposits WHERE id = $1', [req.params.id]);
  if (!d) throw new AppError(404, 'Deposit not found');
  await transaction(async () => {
    await execute('DELETE FROM deposits WHERE id = $1', [req.params.id]);
    const unpaid = await queryOne("SELECT COALESCE(SUM(amount - deposit_used), 0) as total FROM trips WHERE client_id = $1 AND (payment_status = 'Unpaid' OR payment_status = 'Outstanding')", [d.client_id]);
    const paid = await queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM trips WHERE client_id = $1 AND payment_status = 'Paid'", [d.client_id]);
    const payments = await queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE client_id = $1', [d.client_id]);
    const depositsRemaining = await queryOne('SELECT COALESCE(SUM(remaining), 0) as total FROM deposits WHERE client_id = $1', [d.client_id]);
    const totalCharged = (unpaid?.total || 0) + (paid?.total || 0);
    const totalPaid = (payments?.total || 0) + (paid?.total || 0);
    const balance = totalCharged - totalPaid - (depositsRemaining?.total || 0);
    await execute('UPDATE clients SET balance = $1 WHERE id = $2', [balance, d.client_id]);
  });
  res.json({ message: 'Deposit deleted' });
});

export default router;
