import { Router } from 'express';
import { queryAll, queryOne, execute } from '../config/database.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req, res) => {
  const rows = await queryAll('SELECT key, value FROM settings ORDER BY key');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  const user = await queryOne('SELECT pin_hash FROM users WHERE id = $1', [req.user.id]);
  s._pinSet = !!user?.pin_hash;
  res.json(s);
});

router.put('/', auth, requireRole('super_admin'), async (req, res) => {
  const allowed = ['company_name', 'company_logo', 'company_phone', 'invoice_prefix', 'report_title', 'report_footer', 'report_footer_message'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await execute("UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2", [String(req.body[key]), key]);
    }
  }
  const rows = await queryAll('SELECT key, value FROM settings ORDER BY key');
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  res.json(s);
});

export default router;
