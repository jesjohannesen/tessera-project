import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __tesseraPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__tesseraPool) {
    globalThis.__tesseraPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgres://tessera:tessera@localhost:5442/tessera",
      max: 10,
    });
  }
  return globalThis.__tesseraPool;
}
