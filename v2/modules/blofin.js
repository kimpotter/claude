/**
 * BloFin Module
 * Fetches: account equity, open positions, daily/weekly/monthly realized PnL.
 * Uses HMAC-SHA256 signing: hex(HMAC) → Base64.
 */

import crypto from 'crypto';

const BASE_URL = 'https://openapi.blofin.com';
const API_KEY = process.env.BLOFIN_API_KEY;
const SECRET = process.env.BLOFIN_SECRET;
const PASSPHRASE = process.env.BLOFIN_PASSPHRASE;

function sign(path) {
  const ts = Date.now().toString();
  const nonce = crypto.randomUUID();
  const prehash = `${path}GET${ts}${nonce}`;
  const hmac = crypto.createHmac('sha256', SECRET).update(prehash).digest('hex');
  const signature = Buffer.from(hmac).toString('base64');
  return { ts, nonce, signature };
}

async function blofinGet(path) {
  const { ts, nonce, signature } = sign(path);
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'ACCESS-KEY': API_KEY,
      'ACCESS-TIMESTAMP': ts,
      'ACCESS-NONCE': nonce,
      'ACCESS-SIGN': signature,
      'ACCESS-PASSPHRASE': PASSPHRASE,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json();
  if (data.code !== '0' && data.code !== 0) {
    throw new Error(`BloFin API error ${data.code}: ${data.msg}`);
  }
  return data.data;
}

export async function fetchBlofinData() {
  const [balance, positions, posHistory] = await Promise.all([
    blofinGet('/api/v1/account/balance'),
    blofinGet('/api/v1/account/positions'),
    blofinGet('/api/v1/account/positions-history?limit=100'),
  ]);

  const equity = parseFloat(balance?.details?.[0]?.equity ?? balance?.totalEquity ?? 0);
  const available = parseFloat(balance?.details?.[0]?.available ?? 0);

  // Compute realized PnL over time windows
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let pnlDaily = 0, pnlWeekly = 0, pnlMonthly = 0, pnlTotal = 0;

  for (const p of posHistory ?? []) {
    const closeTime = parseInt(p.updateTime ?? p.createTime ?? 0);
    const pnl = parseFloat(p.realizedPnl ?? 0);
    pnlTotal += pnl;
    if (closeTime >= now - DAY) pnlDaily += pnl;
    if (closeTime >= now - 7 * DAY) pnlWeekly += pnl;
    if (closeTime >= now - 30 * DAY) pnlMonthly += pnl;
  }

  // Unrealized PnL from open positions
  let unrealizedPnl = 0;
  const openPositions = positions ?? [];
  for (const p of openPositions) {
    unrealizedPnl += parseFloat(p.unrealizedPnl ?? 0);
  }

  const today = new Date().toISOString().split('T')[0];

  // One summary record per day for BloFin account
  const records = [
    {
      fields: {
        Date: today,
        Position: 'BloFin Algo Bot',
        Protocol: 'BloFin',
        Chain: 'CEX',
        Type: 'Perps / Algo',
        'Value USD': equity,
        'Available Margin USD': available,
        'Unrealized PnL USD': parseFloat(unrealizedPnl.toFixed(4)),
        'Realized PnL Daily USD': parseFloat(pnlDaily.toFixed(4)),
        'Realized PnL Weekly USD': parseFloat(pnlWeekly.toFixed(4)),
        'Realized PnL Monthly USD': parseFloat(pnlMonthly.toFixed(4)),
        'Realized PnL Total USD': parseFloat(pnlTotal.toFixed(4)),
        'Daily PnL %': parseFloat((pnlDaily / equity * 100).toFixed(3)),
        'Weekly PnL %': parseFloat((pnlWeekly / equity * 100).toFixed(3)),
        'Monthly PnL %': parseFloat((pnlMonthly / equity * 100).toFixed(3)),
        'Open Positions Count': openPositions.length,
        Notes: openPositions.map(p => `${p.instId} ${p.positionSide} ${p.positions}`).join(' | '),
      },
    },
  ];

  return {
    summary: { equity, unrealizedPnl: unrealizedPnl.toFixed(2), pnlDaily: pnlDaily.toFixed(2) },
    records,
  };
}
