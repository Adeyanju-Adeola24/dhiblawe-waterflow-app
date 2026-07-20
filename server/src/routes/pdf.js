import { Router } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { queryAll, queryOne } from '../config/database.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

async function loadSettings() {
  const rows = await queryAll('SELECT key, value FROM settings');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

router.get('/client-statement', auth, requireRole('super_admin', 'data_entry', 'view_only'), async (req, res) => {
  const { client_id, from, to } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  const client = await queryOne('SELECT * FROM clients WHERE id = $1', [client_id]);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const settings = await loadSettings();
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${client.name.replace(/\s+/g, '-')}.pdf"`);
  doc.pipe(res);

  const logoPath = settings.company_logo;
  if (logoPath && fs.existsSync(logoPath)) {
    doc.image(logoPath, 40, 35, { width: 80 });
  }

  doc.fontSize(18).font('Helvetica-Bold').text(settings.company_name || 'Dhiblawe WaterFlow', 40, 35, { align: 'center' });
  if (settings.company_phone) {
    doc.fontSize(9).font('Helvetica').fillColor('#666').text('Phone: ' + settings.company_phone, { align: 'center' });
  }

  doc.moveDown(0.5);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('CLIENT STATEMENT', { align: 'center' });
  doc.fontSize(8).font('Helvetica').fillColor('#888')
    .text(`Period: ${from || 'All'} to ${to || 'All'}`, { align: 'center' })
    .text(`Statement Date: ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Bill To:');
  doc.fontSize(9).font('Helvetica').fillColor('#333')
    .text(client.name)
    .text(client.address || 'No address');

  doc.moveDown(1);
  let tripSql = 'SELECT t.*, p.plate as plate_number FROM trips t JOIN plate_numbers p ON t.plate_id = p.id WHERE t.client_id = $1';
  const tripParams = [client_id];
  if (from) { tripSql += ' AND t.trip_date >= $' + (tripParams.length + 1); tripParams.push(from); }
  if (to) { tripSql += ' AND t.trip_date <= $' + (tripParams.length + 1); tripParams.push(to); }
  tripSql += ' ORDER BY t.trip_date ASC, t.trip_time ASC';
  const trips = await queryAll(tripSql, tripParams);

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
  const outstanding = trips.filter(t => t.payment_status === 'Unpaid' || t.payment_status === 'Outstanding').reduce((s, t) => s + (t.amount - t.deposit_used), 0);

  const summaryY = doc.y;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Summary', 40, summaryY);
  const sy = doc.y + 5;
  const summaryItems = [
    ['Total Trips:', String(trips.length)],
    ['Total Deposit:', totalDeposits.toFixed(2)],
    ['Deposit Used:', depositUsed.toFixed(2)],
    ['Remaining Deposit:', depositsRemaining.toFixed(2)],
    ['Total Paid:', totalPaid.toFixed(2)],
    ['Outstanding Balance:', outstanding.toFixed(2)],
  ];
  doc.fontSize(8).font('Helvetica');
  let sx = 40;
  summaryItems.forEach(([label, val], i) => {
    const col = i % 2;
    if (col === 0) { sx = 40; sy += 14; }
    else { sx = 200; }
    doc.fillColor('#555').text(label, sx, sy);
    const xVal = sx + (col === 0 ? 75 : 75);
    doc.fillColor('#000').font('Helvetica-Bold').text(val, xVal, sy, { width: 60, align: 'right' });
    doc.font('Helvetica');
  });

  doc.moveDown(1);
  const plateMap = {};
  for (const t of trips) {
    if (!plateMap[t.plate_number]) plateMap[t.plate_number] = { plate: t.plate_number, trips: 0, total: 0 };
    plateMap[t.plate_number].trips++;
    plateMap[t.plate_number].total += t.amount;
  }
  const plateSummary = Object.values(plateMap);

  if (plateSummary.length > 0) {
    const psY = doc.y + 5;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Trip Summary Per Plate', 40, psY);
    doc.moveDown(0.5);

    const psTableTop = doc.y;
    const psCols = [200, 100, 100];
    const psHeaders = ['Plate Number', 'Total Trips', 'Total Amount'];
    let psX = 40;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333');
    psHeaders.forEach((h, i) => {
      doc.text(h, psX, psTableTop, { width: psCols[i], align: 'left' });
      psX += psCols[i];
    });
    doc.moveDown(0.3);
    doc.strokeColor('#ddd').lineWidth(1).moveTo(40, doc.y).lineTo(540, doc.y).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9).fillColor('#555');
    let psRowY = doc.y;
    const plateColors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
    for (let i = 0; i < plateSummary.length; i++) {
      const ps = plateSummary[i];
      const color = plateColors[i % plateColors.length];
      psX = 40;
      doc.fillColor(color).font('Helvetica-Bold').text(ps.plate, psX, psRowY, { width: psCols[0] });
      doc.fillColor('#333').font('Helvetica').text(String(ps.trips), psX + psCols[0], psRowY, { width: psCols[1], align: 'center' });
      doc.text(ps.total.toFixed(2), psX + psCols[0] + psCols[1], psRowY, { width: psCols[2], align: 'right' });
      psRowY += 16;
    }
    doc.y = psRowY + 5;
  }

  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Transactions', 40, doc.y);
  doc.moveDown(0.5);

  const tCols = [20, 42, 35, 60, 60, 55, 45, 55, 60];
  const tHeaders = ['#', 'Date', 'Time', 'Plate', 'Invoice', 'Item', 'Amount', 'Balance', 'Note'];
  const ttTop = doc.y;
  let tX = 30;
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#333');
  tHeaders.forEach((h, i) => {
    doc.text(h, tX, ttTop, { width: tCols[i], align: i > 4 ? 'right' : 'left' });
    tX += tCols[i];
  });
  doc.moveDown(0.3);
  doc.strokeColor('#ddd').lineWidth(1).moveTo(30, doc.y).lineTo(565, doc.y).stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(7);
  let runningBalance = 0;
  let tRowY = doc.y;

  const sorted = [...trips, ...payments.map(p => ({ ...p, _type: 'payment', trip_date: p.payment_date })), ...deposits.map(d => ({ ...d, _type: 'deposit', trip_date: d.deposit_date, amount: d.amount }))]
    .sort((a, b) => a.trip_date === b.trip_date ? (a.created_at || '').localeCompare(b.created_at || '') : a.trip_date.localeCompare(b.trip_date));

  let lineNum = 0;
  for (const row of sorted) {
    if (row._type === 'payment') {
      runningBalance -= row.amount;
      tX = 30;
      doc.fillColor('#059669');
      const vals = ['', row.payment_date || '', '', '', '', 'Payment', (-row.amount).toFixed(2), runningBalance.toFixed(2), row.note || ''];
      vals.forEach((v, i) => { doc.text(v, tX, tRowY, { width: tCols[i], align: i > 4 ? 'right' : 'left' }); tX += tCols[i]; });
      tRowY += 13;
      continue;
    }
    if (row._type === 'deposit') {
      runningBalance += row.amount;
      tX = 30;
      doc.fillColor('#2563eb');
      const vals = ['', row.deposit_date || '', '', '', '', 'Deposit', row.amount.toFixed(2), runningBalance.toFixed(2), row.note || ''];
      vals.forEach((v, i) => { doc.text(v, tX, tRowY, { width: tCols[i], align: i > 4 ? 'right' : 'left' }); tX += tCols[i]; });
      tRowY += 13;
      continue;
    }

    lineNum++;
    runningBalance += row.amount;
    const isPaid = row.payment_status === 'Paid';
    const isOutstanding = row.payment_status === 'Outstanding' || row.payment_status === 'Unpaid';

    if (isPaid) doc.fillColor('#059669');
    else if (isOutstanding) doc.fillColor('#dc2626');
    else doc.fillColor('#333');

    tX = 30;
    const vals = [
      String(lineNum), row.trip_date || '', row.trip_time || '', row.plate_number || '',
      row.invoice_number || '', row.item || '', row.amount.toFixed(2),
      runningBalance.toFixed(2), row.note || ''
    ];
    vals.forEach((v, i) => {
      doc.text(v, tX, tRowY, { width: tCols[i], align: i > 4 ? 'right' : 'left' });
      tX += tCols[i];
    });
    tRowY += 13;

    if (tRowY > 750) {
      doc.addPage();
      tRowY = 40;
    }
  }

  doc.fillColor('#333').font('Helvetica-Bold').fontSize(9);
  const finalY = Math.max(tRowY + 5, doc.y + 5);
  doc.strokeColor('#ddd').lineWidth(1).moveTo(30, finalY).lineTo(565, finalY).stroke();
  doc.moveDown(1);

  doc.fontSize(8).font('Helvetica').fillColor('#888').text('Outstanding Balance: ' + outstanding.toFixed(2), { align: 'right' });
  doc.moveDown(1);

  doc.fontSize(8).font('Helvetica').fillColor('#999').text(settings.report_footer || 'System Generated by Dhiblawe WaterFlow Operations System', { align: 'center' });
  doc.moveDown(0.3);
  if (settings.company_phone) {
    doc.fontSize(8).fillColor('#666').text(settings.company_phone + ' | Nairobi, Kenya', { align: 'center' });
  }
  doc.moveDown(0.3);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#dc2626').text(settings.report_footer_message || 'Please settle your outstanding balance at your earliest convenience.', { align: 'center' });

  doc.end();
});

export default router;
