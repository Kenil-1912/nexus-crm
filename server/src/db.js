import 'dotenv/config';
import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings, not JS Dates (avoids time-zone shifts).
pg.types.setTypeParser(1082, (value) => value);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://nexus:nexus@localhost:5432/nexus_crm',
});

export const query = (text, params) => pool.query(text, params);

/** Run fn inside one transaction; rolls back if fn throws. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
