const { Pool } = require('pg');
require('dotenv').config();

// 🚨 Check ENV first
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing in ENV!");
}

// Create pool safely with timeouts to prevent infinite hangs
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 5000, // Error out if connection takes > 5 seconds
  idleTimeoutMillis: 30000,      // Close idle clients after 30 seconds
  max: 10                        // Maximum concurrent connections in pool
});

// ✅ Successful connection log
pool.on('connect', () => {
  console.log('✅ Connected to Render Database!');
});

// ❌ Error handling
pool.on('error', (err) => {
  console.error('🔥 Unexpected DB Error:', err);
});

// 🧪 Test connection at startup
(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('🚀 DB initial test successful');
  } catch (err) {
    console.error('❌ DB initial connection failed:', err.message);
  }
})();

module.exports = pool;