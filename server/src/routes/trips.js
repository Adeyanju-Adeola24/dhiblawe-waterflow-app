import { Router } from 'express';
import { queryAll, queryOne, execute, transaction } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

async function getNextTripNumber(plateId) {
  const row = await queryOne('SELECT MAX(trip_number) as max FROM trips WHERE plate_id = $1', [plateId]);
  return (row?.max || 0) + 1;
}

async function getNextInvoiceNumber() {
  const prefix = (await queryOne("SELECT value FROM settings WHERE key = 'invoice_prefix'"))?.value || 'DWF-';
  const row = await queryOne('SELECT COUNT(*) as cnt FROM trips');
  const num = String((row?.cnt || 0) + 1).padStart(4, '0');
  return prefix + num;
}

router.get('/', auth, async (req, res) => {
  const { client_id, plate_id, status, date_from, date_to, limit, offset } = req.query;
  let sql = `SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE 1=1`;
  const params = [];
  if (client_id) { sql += ' AND t.client_id = $' + (params.length + 1); params.push(client_id); }
  if (plate_id) { sql += ' AND t.plate_id = $' + (params.length + 1); params.push(plate_id); }
  if (status) { sql += ' AND t.payment_status = $' + (params.length + 1); params.push(status); }
  if (date_from) { sql += ' AND t.trip_date >= $' + (params.length + 1); params.push(date_from); }
  if (date_to) { sql += ' AND t.trip_date <= $' + (params.length + 1); params.push(date_to); }
  sql += ' ORDER BY t.trip_date DESC, t.trip_time DESC';
  if (limit) { sql += ' LIMIT $' + (params.length + 1); params.push(parseInt(limit)); }
  if (offset) { sql += ' OFFSET $' + (params.length + 1); params.push(parseInt(offset)); }
  res.json(await queryAll(sql, params));
});

router.get('/:id', auth, async (req, res) => {
  const t = await queryOne(`SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE t.id = $1`, [req.params.id]);
  if (!t) throw new AppError(404, 'Trip not found');
  res.json(t);
});

router.post('/', auth, requireRole('super_admin', 'data_entry'), async (req, res) => {
  const { client_id, plate_id, trip_date, trip_time, amount, item, note, payment_status } = req.body;
  if (!client_id || !plate_id || !trip_date || !trip_time || amount === undefined) {
    throw new AppError(400, 'client_id, plate_id, date, time, and amount required');
  }

  const client = await queryOne('SELECT * FROM clients WHERE id = $1 AND is_active = 1', [client_id]);
  if (!client) throw new AppError(400, 'Client not found or inactive');
  const plate = await queryOne('SELECT * FROM plate_numbers WHERE id = $1 AND is_active = 1', [plate_id]);
  if (!plate) throw new AppError(400, 'Plate not found or inactive');

  const existing = await queryOne('SELECT id FROM trips WHERE trip_date = $1 AND trip_time = $2 AND plate_id = $3', [trip_date, trip_time, plate_id]);
  if (existing) throw new AppError(409, 'Duplicate trip: same date, time, and plate already exists');

  let result;
  await transaction(async () => {
    const tripNumber = await getNextTripNumber(plate_id);
    const invoice = await getNextInvoiceNumber();
    const finalItem = item || 'Clean Water';
    let paymentStatus = payment_status || 'Outstanding';
    let depositUsed = 0;
    let finalAmount = parseFloat(amount);

    const deposit = await queryOne('SELECT SUM(remaining) as total FROM deposits WHERE client_id = $1', [client_id]);
    const remainingDeposit = deposit?.total || 0;

    if (paymentStatus === 'Outstanding' && remainingDeposit >= finalAmount) {
      depositUsed = finalAmount;
      paymentStatus = 'Paid';
    } else if (paymentStatus === 'Outstanding' && remainingDeposit > 0) {
      depositUsed = remainingDeposit;
    }

    const { rows } = await execute(`INSERT INTO trips (client_id, plate_id, trip_number, invoice_number, trip_date, trip_time, item, amount, payment_status, note, deposit_used)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [client_id, plate_id, tripNumber, invoice, trip_date, trip_time, finalItem, finalAmount, paymentStatus, note || null, depositUsed]);

    if (depositUsed > 0) {
      let remaining = remainingDeposit - depositUsed;
      const depositRows = await queryAll('SELECT id, remaining FROM deposits WHERE client_id = $1 AND remaining > 0 ORDER BY created_at ASC', [client_id]);
      for (const d of depositRows) {
        if (remaining <= 0) break;
        const deduct = Math.min(d.remaining, remaining);
        await execute('UPDATE deposits SET remaining = remaining - $1 WHERE id = $2', [deduct, d.id]);
        remaining -= deduct;
      }
    }

    const tripId = rows[0].id;
    const trip = await queryOne(`SELECT t.*, c.name as client_name, p.plate as plate_number
      FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE t.id = $1`, [tripId]);

    await updateClientBalance(client_id);
    result = trip;
  });

  res.status(201).json(result);
});

router.put('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const t = await queryOne('SELECT * FROM trips WHERE id = $1', [req.params.id]);
  if (!t) throw new AppError(404, 'Trip not found');
  const { amount, payment_status, note } = req.body;
  await transaction(async () => {
    await execute('UPDATE trips SET amount=$1, payment_status=$2, note=$3 WHERE id=$4',
      [amount !== undefined ? amount : t.amount, payment_status || t.payment_status, note !== undefined ? note : t.note, req.params.id]);
    await updateClientBalance(t.client_id);
  });
  res.json(await queryOne(`SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE t.id = $1`, [req.params.id]));
});

router.delete('/:id', auth, requireRole('super_admin'), async (req, res) => {
  const t = await queryOne('SELECT * FROM trips WHERE id = $1', [req.params.id]);
  if (!t) throw new AppError(404, 'Trip not found');
  await transaction(async () => {
    await execute('DELETE FROM trips WHERE id = $1', [req.params.id]);
    await updateClientBalance(t.client_id);
  });
  res.json({ message: 'Trip deleted' });
});

async function updateClientBalance(clientId) {
  const unpaid = await queryOne("SELECT COALESCE(SUM(amount - deposit_used), 0) as total FROM trips WHERE client_id = $1 AND (payment_status = 'Unpaid' OR payment_status = 'Outstanding')", [clientId]);
  const paid = await queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM trips WHERE client_id = $1 AND payment_status = 'Paid'", [clientId]);
  const payments = await queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE client_id = $1', [clientId]);
  const depositsTotal = await queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE client_id = $1', [clientId]);
  const depositsRemaining = await queryOne('SELECT COALESCE(SUM(remaining), 0) as total FROM deposits WHERE client_id = $1', [clientId]);
  const totalCharged = (unpaid?.total || 0) + (paid?.total || 0);
  const totalPaid = (payments?.total || 0) + (paid?.total || 0);
  const balance = totalCharged - totalPaid - (depositsRemaining?.total || 0);
  await execute('UPDATE clients SET balance = $1 WHERE id = $2', [balance, clientId]);
}

export default router;
