import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './config/database.js';
import { errorHandler } from './lib/errors.js';
import { PORT } from './config/env.js';
import authRoutes from './routes/auth.js';
import securityRoutes from './routes/security.js';
import clientRoutes from './routes/clients.js';
import plateRoutes from './routes/plates.js';
import tripRoutes from './routes/trips.js';
import paymentRoutes from './routes/payments.js';
import depositRoutes from './routes/deposits.js';
import settingsRoutes from './routes/settings.js';
import backupRoutes from './routes/backup.js';
import reportRoutes from './routes/reports.js';
import pdfRoutes from './routes/pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (fs.existsSync(uploadsDir)) {
  app.use('/uploads', express.static(uploadsDir));
}

const soundsDir = path.join(__dirname, '..', 'sounds');
if (fs.existsSync(soundsDir)) {
  app.use('/sounds', express.static(soundsDir));
}

app.use('/api/auth', authRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/plates', plateRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/deposits', depositRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/pdf', pdfRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Dhiblawe WaterFlow API → http://localhost:${PORT}`);
  });
});
