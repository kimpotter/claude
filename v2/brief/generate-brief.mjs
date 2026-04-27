/**
 * Morning Brief Generator
 * Uses Claude API to read today's Airtable data and write a spoken brief.
 * Output: brief/brief-latest.json (text + metadata)
 */

import Anthropic from '@anthropic-ai/sdk';
import { fetchTodayPositions, fetchRecentPositions, writeBriefing } from '../modules/airtable.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getBtcContext() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,sui&vs_currencies=usd&include_24hr_change=true');
    const data = await res.json();
    return {
      btc: data.bitcoin?.usd,
      btcChange: data.bitcoin?.usd_24h_change,
      eth: data.ethereum?.usd,
      ethChange: data.ethereum?.usd_24h_change,
      sol: data.solana?.usd,
      sui: data.sui?.usd,
    };
  } catch {
    return null;
  }
}

async function generateBrief() {
  console.log('Fetching Airtable data...');
  const [todayRecords, recentRecords, prices] = await Promise.all([
    fetchTodayPositions(),
    fetchRecentPositions(7),
    getBtcContext(),
  ]);

  // Summarise position data
  const positionSummary = todayRecords.map(r => {
    const f = r.fields;
    return `${f.Position} (${f.Protocol}, ${f.Chain}): $${f['Value USD'] ?? 0} | PnL: ${f['Unrealized PnL USD'] ?? 'n/a'} | APY: ${f['APY Current %'] ?? 'n/a'}% | In Range: ${f['In Range'] ?? 'n/a'} | Notes: ${f.Notes ?? ''}`;
  }).join('\n');

  // Compute 7-day trend for BloFin
  const blofinRecords = recentRecords.filter(r => r.fields.Protocol === 'BloFin');
  const blofinTrend = blofinRecords.slice(0, 7).map(r =>
    `${r.fields.Date}: daily PnL ${r.fields['Daily PnL %'] ?? 0}% | equity $${r.fields['Value USD'] ?? 0}`
  ).join('\n');

  const systemPrompt = `You are Kim's daily DeFi portfolio assistant. You generate concise spoken morning briefs — direct, no hedging, no filler.

Format: 5 sections, each one or two punchy sentences. Total brief should be 60–75 seconds when spoken (about 150–180 words).

Sections:
PORTFOLIO STATE — Total value, biggest movers, overall health.
LP ALERTS — Any LP out of range? APY drop? IL concerns?
BOT PERFORMANCE — BloFin algo PnL today/week/month. Trend up or down?
CAPITAL DEPLOYMENT — Available margin, opportunities, incoming capital phases.
NEXT ACTIONS — Two or three specific things to act on today.

Tone: direct assessment, actionable, like a sharp fund manager briefing herself. No "it's important to note" or "please be aware". Just the facts and the call.`;

  const userPrompt = `Today is ${new Date().toISOString().split('T')[0]}.

TODAY'S POSITIONS:
${positionSummary || 'No positions fetched today.'}

BLOFIN 7-DAY TREND:
${blofinTrend || 'Insufficient history.'}

MARKET PRICES:
BTC: $${prices?.btc?.toLocaleString() ?? 'n/a'} (${prices?.btcChange?.toFixed(2) ?? 'n/a'}% 24h)
ETH: $${prices?.eth?.toLocaleString() ?? 'n/a'} (${prices?.ethChange?.toFixed(2) ?? 'n/a'}% 24h)
SOL: $${prices?.sol?.toFixed(2) ?? 'n/a'}
SUI: $${prices?.sui?.toFixed(4) ?? 'n/a'}

STRATEGY CONTEXT:
Bear consolidation phase. BTC target $30K–$40K. Delta-neutral CLPs + algo shorts = cashflow focus. On reversal signal, shift to correlated LP for upside. Phase 2 ($10K) in ~2 months, Phase 3 ($90K) shortly after.

Write the morning brief now.`;

  console.log('Generating brief via Claude API...');
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  const briefText = message.content[0].text;
  console.log('\n--- BRIEF ---\n' + briefText + '\n---\n');

  // Save to JSON for the audio step
  const output = {
    date: new Date().toISOString().split('T')[0],
    text: briefText,
    wordCount: briefText.split(/\s+/).length,
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(join(__dirname, 'brief-latest.json'), JSON.stringify(output, null, 2));
  console.log('Brief saved to brief/brief-latest.json');

  // Write to Airtable Briefings table
  await writeBriefing({
    Date: output.date,
    'Brief Text': briefText,
    'Word Count': output.wordCount,
    'BTC Price': prices?.btc,
    'ETH Price': prices?.eth,
  }).catch(e => console.warn('Airtable briefing write failed:', e.message));

  return briefText;
}

generateBrief().catch(err => {
  console.error('Brief generation failed:', err);
  process.exit(1);
});
