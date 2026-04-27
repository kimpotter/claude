/**
 * Airtable Module
 * Writes daily position records to Airtable.
 *
 * Airtable Base structure expected:
 *   Table: "Daily Positions" — one record per position per day
 *   Table: "Briefings"       — one record per morning brief
 *
 * All field names here must exactly match your Airtable column names.
 */

import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

const POSITIONS_TABLE = 'Daily Positions';
const BRIEFINGS_TABLE = 'Briefings';

// Chunk array into batches of n (Airtable max 10 per request)
function chunk(arr, n) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += n) chunks.push(arr.slice(i, i + n));
  return chunks;
}

/**
 * Write position records to "Daily Positions" table.
 * @param {Array} records - Array of { fields: {...} } objects
 */
export async function writePositions(records) {
  if (!records.length) return;

  for (const batch of chunk(records, 10)) {
    // typecast: true tells Airtable to auto-create any columns that don't exist yet
    await base(POSITIONS_TABLE).create(batch, { typecast: true });
  }
}

/**
 * Write a briefing record to "Briefings" table.
 * @param {Object} fields - Briefing fields: Date, BriefText, AudioUrl, etc.
 */
export async function writeBriefing(fields) {
  await base(BRIEFINGS_TABLE).create([{ fields }], { typecast: true });
}

/**
 * Fetch today's position records (for brief generation).
 * @returns {Array} Array of Airtable records for today
 */
export async function fetchTodayPositions() {
  const today = new Date().toISOString().split('T')[0];
  const records = [];

  await base(POSITIONS_TABLE)
    .select({
      filterByFormula: `{Date} = '${today}'`,
    })
    .eachPage((page, fetchNextPage) => {
      records.push(...page);
      fetchNextPage();
    });

  return records;
}

/**
 * Fetch recent position records for trend analysis (last N days).
 * @param {number} days - Number of days to look back
 * @returns {Array} Array of Airtable records
 */
export async function fetchRecentPositions(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const records = [];

  await base(POSITIONS_TABLE)
    .select({
      filterByFormula: `{Date} >= '${cutoff}'`,
      sort: [{ field: 'Date', direction: 'desc' }],
    })
    .eachPage((page, fetchNextPage) => {
      records.push(...page);
      fetchNextPage();
    });

  return records;
}
