import { SmtpMailer } from '@nona/mail';
import pg from 'pg';
import { loadConfig } from './config.js';
import { checkAlerts } from './jobs/alerts.js';
import { cleanup } from './jobs/cleanup.js';
import { callInternalJob } from './jobs/internal.js';
import { processOutbox } from './jobs/outbox.js';
import { logger } from './logger.js';
import { DEFAULT_ESMS_TEMPLATE, EsmsSender, SimulatorSmsSender, ZaloZnsSender } from './sms.js';
import { ZaloTokenProvider } from './zalo-token.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
const mailer = new SmtpMailer(config.smtp);
function buildSmsSender() {
  if (config.smsMode === 'esms')
    return new EsmsSender({
      ...config.esms,
      template: config.esms.template ?? DEFAULT_ESMS_TEMPLATE,
    });
  if (config.smsMode !== 'zalo') return new SimulatorSmsSender();
  const { oauth, staticAccessToken, ...rest } = config.zalo;
  if (oauth) {
    const tokens = new ZaloTokenProvider(pool, oauth);
    return new ZaloZnsSender({
      ...rest,
      accessToken: () => tokens.accessToken(),
      refreshAccessToken: () => tokens.refreshNow(),
    });
  }
  return new ZaloZnsSender({ ...rest, accessToken: async () => staticAccessToken ?? '' });
}
const sms = buildSmsSender();

let stopping = false;
let busy: Promise<void> = Promise.resolve();

/** Fast loop: deliver queued email. */
async function tick() {
  try {
    const result = await processOutbox(pool, mailer, { webOrigin: config.webOrigin, sms });
    if (Object.values(result).some((n) => n)) logger.info({ job: 'outbox', result }, 'job ran');
  } catch (error) {
    logger.error({ job: 'outbox', err: error }, 'job failed');
  }
}

/** Slower loop: payment reconciliation, order expiry (API-side) and alert checks. */
async function payments() {
  const result = await callInternalJob(config, 'payments-maintenance');
  if (result && JSON.stringify(result).match(/[1-9]/))
    logger.info({ job: 'payments-maintenance', result }, 'job ran');
  try {
    await checkAlerts(pool);
  } catch (error) {
    logger.error({ job: 'alerts', err: error }, 'alert check failed');
  }
}

async function maintenance() {
  try {
    logger.info({ job: 'cleanup', result: await cleanup(pool) }, 'cleanup ran');
  } catch (error) {
    logger.error({ job: 'cleanup', err: error }, 'cleanup failed');
  }
}

logger.info({ tickMs: config.tickMs }, 'worker started');
const tickTimer = setInterval(() => {
  if (!stopping) busy = busy.then(tick);
}, config.tickMs);
const cleanupTimer = setInterval(() => {
  if (!stopping) busy = busy.then(maintenance);
}, config.cleanupEveryMs);
const paymentsTimer = setInterval(() => {
  if (!stopping) busy = busy.then(payments);
}, config.maintenanceEveryMs);
busy = busy.then(tick).then(payments).then(maintenance);

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  stopping = true;
  clearInterval(tickTimer);
  clearInterval(cleanupTimer);
  clearInterval(paymentsTimer);
  await busy; // let the running tick finish
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
