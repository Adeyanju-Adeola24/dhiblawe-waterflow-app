import { Router } from 'express';
import { queryAll, queryOne } from '../config/database.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const totalTrips = await queryOne("SELECT COUNT(*) as cnt FROM trips WHERE trip_date = $1", [today]);
  const paidTrips = await queryOne("SELECT COUNT(*) as cnt FROM trips WHERE trip_date = $1 AND payment_status = 'Paid'", [today]);
  const companyFleet = await queryOne("SELECT COUNT(*) as cnt FROM trips WHERE trip_date = $1 AND payment_status = 'Company Fleet'", [today]);
  const freeTrips = await queryOne("SELECT COUNT(*) as cnt FROM trips WHERE trip_date = $1 AND payment_status = 'Free'", [today]);
  const outstanding = await queryOne("SELECT COALESCE(SUM(amount - deposit_used), 0) as total FROM trips WHERE payment_status IN ('Unpaid', 'Outstanding')");
  const totalClients = await queryOne("SELECT COUNT(*) as cnt FROM clients WHERE is_active = 1");
  const totalPlates = await queryOne("SELECT COUNT(*) as cnt FROM plate_numbers WHERE is_active = 1");

  res.json({
    totalTripsToday: totalTrips?.cnt || 0,
    paidTrips: paidTrips?.cnt || 0,
    companyFleetTrips: companyFleet?.cnt || 0,
    freeTrips: freeTrips?.cnt || 0,
    outstandingBalance: outstanding?.total || 0,
    totalClients: totalClients?.cnt || 0,
    totalPlateNumbers: totalPlates?.cnt || 0,
  });
});

router.get('/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const trips = await queryAll(`SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id
    WHERE t.trip_date = $1 ORDER BY t.trip_time ASC`, [today]);
  res.json(trips);
});

router.get('/range', auth, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });
  const trips = await queryAll(`SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id
    WHERE t.trip_date >= $1 AND t.trip_date <= $2 ORDER BY t.trip_date ASC, t.trip_time ASC`, [from, to]);
  res.json(trips);
});

router.get('/client-statement', auth, async (req, res) => {
  const { client_id, from, to } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  const client = await queryOne('SELECT * FROM clients WHERE id = $1', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  let tripSql = 'SELECT t.*, p.plate as plate_number FROM trips t JOIN plate_numbers p ON t.plate_id = p.id WHERE t.client_id = $1';
  const tripParams = [client_id, ...(from ? [from] : []), ...(to ? [to] : [])];
  if (from) { tripSql += ' AND t.trip_date >= $' + (tripParams.length - (to ? 1 : 0)); }
  if (to) { tripSql += ' AND t.trip_date <= $' + (tripParams.length); }
  tripSql += ' ORDER BY t.trip_date ASC, t.trip_time ASC';
  const trips = await queryAll(tripSql, [client_id, ...(from ? [from] : []), ...(to ? [to] : [])]);

  let pmtSql = 'SELECT * FROM payments WHERE client_id = $1';
  const pmtParams = [client_id];
  if (from) { pmtSql += ' AND payment_date >= $' + (pmtParams.length + 1); pmtParams.push(from); }
  if (to) { pmtSql += ' AND payment_date <= $' + (pmtParams.length + 1); pmtParams.push(to); }
  pmtSql += ' ORDER BY created_at ASC';
  const payments = await queryAll(pmtSql, pmtParams);

  let depSql = 'SELECT * FROM deposits WHERE client_id = $1';
  const depParams = [client_id];
  if (from) { depSql += ' AND deposit_date >= $' + (depParams.length + 1); depParams.push(from); }
  if (to) { depSql += ' AND deposit_date <= $' + (depParams.length + 1); depParams.push(to); }
  depSql += ' ORDER BY created_at ASC';
  const deposits = await queryAll(depSql, depParams);

  const totalDeposits = deposits.reduce((s, d) => s + d.amount, 0);
  const depositsRemaining = (await queryOne('SELECT COALESCE(SUM(remaining), 0) as total FROM deposits WHERE client_id = $1', [client_id]))?.total || 0;
  const depositUsed = totalDeposits - depositsRemaining;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0) + trips.filter(t => t.payment_status === 'Paid').reduce((s, t) => s + t.amount, 0);
  const totalTrips = trips.length;
  const outstanding = trips.filter(t => t.payment_status === 'Unpaid' || t.payment_status === 'Outstanding').reduce((s, t) => s + (t.amount - t.deposit_used), 0);

  const plateSummary = {};
  for (const t of trips) {
    if (!plateSummary[t.plate_number]) plateSummary[t.plate_number] = { plate: t.plate_number, trips: 0, total: 0 };
    plateSummary[t.plate_number].trips++;
    plateSummary[t.plate_number].total += t.amount;
  }

  res.json({
    client: { name: client.name, address: client.address },
    summary: {
      totalTrips,
      totalDeposit: totalDeposits,
      depositUsed,
      remainingDeposit: depositsRemaining,
      totalPaid,
      outstandingBalance: outstanding,
    },
    plateSummary: Object.values(plateSummary),
    trips,
    payments,
    deposits,
  });
});

router.get('/plate', auth, async (req, res) => {
  const { plate_id, from, to } = req.query;
  let sql = `SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE 1=1`;
  const params = [];
  if (plate_id) { sql += ' AND t.plate_id = $' + (params.length + 1); params.push(plate_id); }
  if (from) { sql += ' AND t.trip_date >= $' + (params.length + 1); params.push(from); }
  if (to) { sql += ' AND t.trip_date <= $' + (params.length + 1); params.push(to); }
  sql += ' ORDER BY t.trip_date DESC, t.trip_time DESC';
  res.json(await queryAll(sql, params));
});

router.get('/payment-status', auth, async (req, res) => {
  const { status, from, to } = req.query;
  let sql = `SELECT t.*, c.name as client_name, p.plate as plate_number
    FROM trips t JOIN clients c ON t.client_id = c.id JOIN plate_numbers p ON t.plate_id = p.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND t.payment_status = $' + (params.length + 1); params.push(status); }
  if (from) { sql += ' AND t.trip_date >= $' + (params.length + 1); params.push(from); }
  if (to) { sql += ' AND t.trip_date <= $' + (params.length + 1); params.push(to); }
  sql += ' ORDER BY t.trip_date DESC, t.trip_time DESC';
  res.json(await queryAll(sql, params));
});

export default router;
