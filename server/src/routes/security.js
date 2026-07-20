import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, execute } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.post('/verify', auth, async (req, res) => {
  const { pin } = req.body;
  if (!pin) throw new AppError(400, 'PIN required');
  const user = await queryOne('SELECT pin_hash FROM users WHERE id = $1', [req.user.id]);
  if (!user.pin_hash) throw new AppError(400, 'No PIN set');
  if (!bcrypt.compareSync(pin, user.pin_hash)) throw new AppError(403, 'Invalid PIN');
  res.json({ verified: true });
});

router.post('/setup', auth, requireRole('super_admin'), async (req, res) => {
  const { pin } = req.body;
  if (!pin) throw new AppError(400, 'PIN required');
  if (!/^\d{4,8}$/.test(pin)) throw new AppError(400, 'PIN must be 4-8 digits');
  const hash = await bcrypt.hash(pin, 10);
  await execute('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'PIN set' });
});

router.post('/change', auth, requireRole('super_admin'), async (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) throw new AppError(400, 'Current and new PIN required');
  if (!/^\d{4,8}$/.test(newPin)) throw new AppError(400, 'PIN must be 4-8 digits');
  const user = await queryOne('SELECT pin_hash FROM users WHERE id = $1', [req.user.id]);
  if (!user.pin_hash || !bcrypt.compareSync(currentPin, user.pin_hash)) throw new AppError(403, 'Current PIN incorrect');
  const hash = await bcrypt.hash(newPin, 10);
  await execute('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'PIN changed' });
});

export default router;
