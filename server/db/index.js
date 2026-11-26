import fs from 'node:fs';
import path from 'node:path';
import knexFactory from 'knex';
import { config } from '../config.js';
import { createSchema } from './schema.js';

fs.mkdirSync(config.dataDir, { recursive: true });

function buildKnexConfig() {
  const { client, url, host, port, database, user, password, ssl, poolMin, poolMax } = config.db;

  if (client === 'better-sqlite3') {
    fs.mkdirSync(path.dirname(database), { recursive: true });
    return {
      client,
      connection: { filename: database },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        afterCreate(conn, done) {
          try {
            conn.pragma('journal_mode = WAL');
            conn.pragma('foreign_keys = ON');
            done(null, conn);
          } catch (error) {
            done(error, conn);
          }
        },
      },
    };
  }

  const connection = url
    ? client === 'pg'
      ? { connectionString: url, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) }
      : url
    : {
        host,
        port,
        database,
        user,
        password,
        ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      };

  if (client === 'mysql2' && typeof connection === 'object') {
    connection.charset = 'utf8mb4';
    connection.timezone = 'Z';
    connection.typeCast = (field, next) => {
      if (field.type === 'TINY' && field.length === 1) return field.string() === '1';
      return next();
    };
  }

  return {
    client,
    connection,
    pool: { min: poolMin, max: poolMax },
    ...(client === 'better-sqlite3' ? { useNullAsDefault: true } : {}),
  };
}

export const db = knexFactory(buildKnexConfig());

export function dialect() {
  return config.db.client;
}

export async function insertReturningId(query, data) {
  if (dialect() === 'pg') {
    const rows = await query.insert(data).returning('id');
    return typeof rows[0] === 'object' ? rows[0].id : rows[0];
  }
  const ids = await query.insert(data);
  return Array.isArray(ids) ? ids[0] : ids;
}

export async function initDatabase({ seed = config.autoSeed } = {}) {
  await db.raw('select 1 as ok');
  await createSchema(db);
  if (seed) {
    const existing = await db('users').count({ count: '*' }).first();
    if (Number(existing?.count || 0) === 0) {
      const { seedDatabase } = await import('./seed.js');
      await seedDatabase(db, { reset: false });
      console.log('[db] demo data seeded');
    }
  }
  const { ensureRelationTypes } = await import('../lib/relationTypes.js');
  await ensureRelationTypes(db);
  const { encryptPhone } = await import('../lib/phone.js');
  const plainPhones = await db('users').whereNotNull('phone').whereNot('phone', 'like', 'enc:v1:%').select('id', 'phone');
  for (const row of plainPhones) {
    if (row.phone) await db('users').where({ id: row.id }).update({ phone: encryptPhone(row.phone) });
  }
  const { ensureDeletionPolicy } = await import('../lib/deletionPolicy.js');
  await ensureDeletionPolicy(db);
  console.log(`[db] ${config.db.client} ready`);
}

export async function closeDatabase() {
  await db.destroy();
}
