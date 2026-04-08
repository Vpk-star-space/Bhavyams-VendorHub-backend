const { Pool } = require('pg');
require('dotenv').config();

// 🚨 Check ENV first
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing in ENV!");
}

// Create pool safely
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ✅ Successful connection log
pool.on('connect', () => {
  console.log('✅ Connected to Render Database!');
});

// ❌ Error handling (VERY IMPORTANT)
pool.on('error', (err) => {
  console.error('🔥 Unexpected DB Error:', err);
});

// 🧪 Optional: Test connection at startup
(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('🚀 DB initial test successful');
  } catch (err) {
    console.error('❌ DB initial connection failed:', err.message);
  }
})();

module.exports = pool;