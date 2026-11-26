import cluster from 'node:cluster';
import os from 'node:os';
import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDatabase, db, initDatabase } from './db/index.js';
import { syncZabbixHosts } from './services/zabbixHosts.js';
import { syncZabbixHostSpecs } from './services/zabbixSpecs.js';
import { syncZabbixInventory } from './services/zabbixInventory.js';
import { syncZabbixProblems } from './services/zabbix.js';
import { backfillCILocations } from './services/ciLocation.js';
import { getSetting } from './lib/systemSettings.js';

const requestedWorkers = Math.max(1, Number(config.clusterWorkers) || 1);
const maxWorkers = os.availableParallelism?.() || os.cpus().length || 1;
const workerCount = Math.min(requestedWorkers, maxWorkers);
let shuttingDown = false;

function startZabbixHostScheduler() {
  if (process.env.ZABBIX_HOST_SYNC_DISABLED === '1') return;
  // In cluster mode, only the first worker owns the periodic reconciliation.
  if (cluster.worker && cluster.worker.id !== 1) return;
  const lastRun = { host: 0, specs: 0, inventory: 0, alerts: 0 };
  let running = false;
  const readIntervals = async () => {
    let stored = {};
    try { stored = JSON.parse(await getSetting('zabbix_sync_config', '{}')); } catch { stored = {}; }
    return {
      host: Math.max(0, Number(stored.host_minutes ?? process.env.ZABBIX_HOST_SYNC_MINUTES ?? 5)),
      specs: Math.max(0, Number(stored.specs_minutes ?? 5)),
      inventory: Math.max(0, Number(stored.inventory_minutes ?? 60)),
      alerts: Math.max(0, Number(stored.alert_minutes ?? 0)),
    };
  };
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const intervals = await readIntervals();
      const now = Date.now();
      const integrations = await db('zabbix_integrations').where({ enabled: true });
      for (const integration of integrations) {
        if (intervals.host > 0 && (!lastRun.host || now - lastRun.host >= intervals.host * 60_000)) {
          try {
            const result = await syncZabbixHosts(integration);
            if (result.pending || result.created || result.updated || result.offline) console.log('[zabbix] host sync', integration.name, result);
          } catch (error) {
            console.error('[zabbix] host sync failed', integration.name, error.message);
          }
        }
        if (intervals.specs > 0 && (!lastRun.specs || now - lastRun.specs >= intervals.specs * 60_000)) {
          try { await syncZabbixHostSpecs(integration); }
          catch (error) { console.error('[zabbix] host specs sync failed', integration.name, error.message); }
        }
        if (intervals.inventory > 0 && (!lastRun.inventory || now - lastRun.inventory >= intervals.inventory * 60_000)) {
          try { await syncZabbixInventory(integration); }
          catch (error) { console.error('[zabbix] inventory sync failed', integration.name, error.message); }
        }
        if (intervals.alerts > 0 && (!lastRun.alerts || now - lastRun.alerts >= intervals.alerts * 60_000)) {
          try { await syncZabbixProblems(integration); }
          catch (error) { console.error('[zabbix] alert sync failed', integration.name, error.message); }
        }
      }
      if (intervals.host > 0 && (!lastRun.host || now - lastRun.host >= intervals.host * 60_000)) lastRun.host = now;
      if (intervals.specs > 0 && (!lastRun.specs || now - lastRun.specs >= intervals.specs * 60_000)) lastRun.specs = now;
      if (intervals.inventory > 0 && (!lastRun.inventory || now - lastRun.inventory >= intervals.inventory * 60_000)) lastRun.inventory = now;
      if (intervals.alerts > 0 && (!lastRun.alerts || now - lastRun.alerts >= intervals.alerts * 60_000)) lastRun.alerts = now;
    } catch (error) {
      console.error('[zabbix] scheduler failed', error.message);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 15_000).unref();
  setInterval(run, 60_000).unref();
}

async function startServer({ skipDatabaseInit = false } = {}) {
  if (!skipDatabaseInit) await initDatabase();
  if (!cluster.worker || cluster.worker.id === 1) backfillCILocations().catch((error) => console.error('[location] backfill failed', error.message));
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[server] NextITOps ITSM running at http://${config.host}:${config.port}`);
    startZabbixHostScheduler();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeDatabase();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function startPrimary() {
  // Initialize schema once in the primary; workers only serve requests.
  await initDatabase();
  await closeDatabase();

  for (let index = 0; index < workerCount; index += 1) {
    cluster.fork({ NEXTOPS_CLUSTER_WORKER: '1' });
  }
  console.log(`[server] cluster primary started with ${workerCount} workers`);

  cluster.on('exit', (worker, code) => {
    if (shuttingDown) return;
    if (code !== 0) {
      console.error(`[server] worker ${worker.process.pid} exited (${code}), restarting`);
      cluster.fork({ NEXTOPS_CLUSTER_WORKER: '1' });
    }
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers)) worker?.kill('SIGTERM');
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (cluster.isPrimary && workerCount > 1) {
  startPrimary().catch((error) => {
    console.error('[server] cluster failed to start', error);
    process.exit(1);
  });
} else {
  startServer({ skipDatabaseInit: Boolean(process.env.NEXTOPS_CLUSTER_WORKER) }).catch((error) => {
    console.error('[server] failed to start', error);
    process.exit(1);
  });
}
