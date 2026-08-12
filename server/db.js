const { Pool } = require("pg");
const { databaseUrl } = require("./config");

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: boundedInteger(process.env.DB_POOL_MAX, 20, 2, 100),
  idleTimeoutMillis: boundedInteger(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30000, 1000, 600000),
  connectionTimeoutMillis: boundedInteger(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 10000, 1000, 120000),
  maxLifetimeSeconds: boundedInteger(process.env.DB_POOL_MAX_LIFETIME_SECONDS, 300, 0, 86400),
  application_name: "det-dashboard",
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function transaction(fn) {
  const client = await pool.connect();
  const handleClientError = (error) => {
    console.error("PostgreSQL transaction client error:", error.message);
  };
  client.on("error", handleClientError);
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.off("error", handleClientError);
    client.release();
  }
}

module.exports = { pool, query, transaction };
