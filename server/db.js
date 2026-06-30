const { Pool } = require("pg");
const { databaseUrl } = require("./config");

const pool = new Pool({ connectionString: databaseUrl });

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
