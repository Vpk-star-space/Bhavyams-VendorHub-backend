const { Pool } = require('pg');
require('dotenv').config();

// This tells your code to use the long "External Database URL" from Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('✅ Connected to Render Database!');
});

module.exports = pool;