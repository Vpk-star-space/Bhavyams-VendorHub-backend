const { Pool } = require('pg');
require('dotenv').config();

// 🚨 Check ENV first
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing in ENV!");
}

// 🟢 ULTRA-STRICT ANTI-DRAIN GATE
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,                      // Strictly limits concurrent connections
  idleTimeoutMillis: 10000,     // KILLS idle connections quickly (10 seconds) to save Neon quota
  connectionTimeoutMillis: 5000,// Fails fast if the DB is overwhelmed
  statement_timeout: 10000,     // 🚨 CRITICAL: Instantly kills any rogue query taking > 10 seconds
  query_timeout: 10000          // 🚨 CRITICAL: Node.js level query timeout protection
});

// ✅ Successful connection log
pool.on('connect', () => {
  // Silent success to prevent terminal spam
});

// ❌ Error handling
pool.on('error', (err) => {
  console.error('🔥 Anti-Drain Gate Caught DB Error:', err.message);
});

// 🧪 Test connection at startup
(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log('🚀 DB Anti-Drain Gate Active & Connected!');
  } catch (err) {
    console.error('❌ DB initial connection failed:', err.message);
  }
})();

module.exports = pool;