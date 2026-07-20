import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryAll } from '../config/database.js';
import { AppError } from '../lib/errors.js';
import { auth, requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

const router = Router();
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

router.post('/backup', auth, requireRole('super_admin'), async (req, res) => {
  const tables = ['users', 'clients', 'plate_numbers', 'trips', 'payments', 'deposits', 'settings', 'audit_log'];
  const backup = {};
  for (const table of tables) {
    try {
      backup[table] = await queryAll(`SELECT * FROM ${table}`);
    } catch {
      backup[table] = [];
    }
  }
  backup._exportedAt = new Date().toISOString();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${ts}.json`;
  fs.writeFileSync(path.join(BACKUPS_DIR, filename), JSON.stringify(backup, null, 2));
  res.json({ message: 'Backup created', filename, tables: tables.length });
});

router.get('/backups', auth, requireRole('super_admin'), (req, res) => {
  const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).map(f => {
    const stat = fs.statSync(path.join(BACKUPS_DIR, f));
    return { filename: f, size: stat.size, created: stat.mtime };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json(files);
});

export default router;
