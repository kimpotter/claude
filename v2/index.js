/**
 * Kim's Portfolio Tracker — V2.0
 * Runs daily via GitHub Actions (triggered by cron-job.org at 7 AM NZST).
 * Fetches live data from BloFin, GMX, EVM LP (Base), and Sui.
 * Writes one record per position to Airtable.
 */

import { fetchBlofinData } from './modules/blofin.js';
import { fetchGmxData } from './modules/gmx.js';
import { fetchEvmLpData } from './modules/evm-lp.js';
import { fetchSuiData } from './modules/sui.js';
import { writePositions } from './modules/airtable.js';

const DRY_RUN = process.env.DRY_RUN === 'true';
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

console.log(`\n🗓  Portfolio check — ${today}${DRY_RUN ? ' [DRY RUN — nothing will be written]' : ''}\n`);

async function run() {
  const results = await Promise.allSettled([
    fetchBlofinData(),
    fetchGmxData(),
    fetchEvmLpData(),
    fetchSuiData(),
  ]);

  const [blofinResult, gmxResult, evmLpResult, suiResult] = results;

  // Log any fetch failures without crashing the whole run
  for (const [name, result] of [
    ['BloFin', blofinResult],
    ['GMX', gmxResult],
    ['EVM LP', evmLpResult],
    ['Sui', suiResult],
  ]) {
    if (result.status === 'rejected') {
      console.error(`❌ ${name} module failed:`, result.reason?.message ?? result.reason);
    } else {
      console.log(`✅ ${name}: ${JSON.stringify(result.value?.summary ?? result.value)}`);
    }
  }

  // Build position records for Airtable Daily Positions table
  const positionRecords = [];

  if (blofinResult.status === 'fulfilled' && blofinResult.value) {
    positionRecords.push(...blofinResult.value.records);
  }
  if (gmxResult.status === 'fulfilled' && gmxResult.value) {
    positionRecords.push(...gmxResult.value.records);
  }
  if (evmLpResult.status === 'fulfilled' && evmLpResult.value) {
    positionRecords.push(...evmLpResult.value.records);
  }
  if (suiResult.status === 'fulfilled' && suiResult.value) {
    positionRecords.push(...suiResult.value.records);
  }

  // Compute portfolio total
  const totalUsd = positionRecords.reduce((sum, r) => sum + (r.fields['Value USD'] ?? 0), 0);
  console.log(`\n💰 Total tracked value: $${totalUsd.toFixed(2)}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Records that would be written:');
    positionRecords.forEach(r => console.log(' •', JSON.stringify(r.fields)));
    return;
  }

  await writePositions(positionRecords);
  console.log(`\n✅ ${positionRecords.length} records written to Airtable.`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
