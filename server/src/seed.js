import bcrypt from 'bcryptjs';
import { initDb, execute } from './config/database.js';

async function seed() {
  await initDb();
  const hash = await bcrypt.hash('admin123', 10);
  await execute("INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
    ['admin', 'admin@dhiblawe.local', hash, 'super_admin']);
  const entryHash = await bcrypt.hash('entry123', 10);
  await execute("INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
    ['dataentry', 'data@dhiblawe.local', entryHash, 'data_entry']);
  const viewHash = await bcrypt.hash('view123', 10);
  await execute("INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
    ['viewer', 'view@dhiblawe.local', viewHash, 'view_only']);

  await execute("INSERT INTO clients (name, address) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['Nairobi Water Supply', 'Moi Avenue, Nairobi']);
  await execute("INSERT INTO clients (name, address) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['Eastlands Residences', 'Eastleigh, Nairobi']);
  await execute("INSERT INTO clients (name, address) VALUES ($1, $2) ON CONFLICT DO NOTHING", ['Westlands Mall', 'Westlands, Nairobi']);

  await execute("INSERT INTO plate_numbers (plate, default_rate) VALUES ($1, $2) ON CONFLICT (plate) DO NOTHING", ['KCA 001T', 500]);
  await execute("INSERT INTO plate_numbers (plate, default_rate) VALUES ($1, $2) ON CONFLICT (plate) DO NOTHING", ['KCB 002T', 500]);
  await execute("INSERT INTO plate_numbers (plate, default_rate) VALUES ($1, $2) ON CONFLICT (plate) DO NOTHING", ['KCC 003T', 500]);

  console.log('Default users:');
  console.log('  admin@dhiblawe.local / admin123 (super_admin)');
  console.log('  data@dhiblawe.local / entry123 (data_entry)');
  console.log('  view@dhiblawe.local / view123 (view_only)');
  process.exit(0);
}

seed();
