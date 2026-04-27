/**
 * GMX V2 Module (Arbitrum)
 * Reads open perp positions for the EVM wallet via GMX v2 contracts.
 * Uses ethers.js — read-only, no signing, no gas.
 *
 * GMX v2 contracts on Arbitrum:
 *   Reader:    0x22199a49A999c351eF7927602CFB187d1Ec25a6
 *   DataStore: 0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8
 */

import { ethers } from 'ethers';

const WALLET = '0x3428266F49F58c2fE97Da937529302bDbc97F0F0';
const ARB_RPC = process.env.ARB_RPC_URL ?? 'https://arb1.arbitrum.io/rpc';

// GMX v2 Reader ABI — only the functions we need
const READER_ABI = [
  'function getPositions(address dataStore, address account, address[] memory collateralTokens, address[] memory indexTokens, bool[] memory isLong) view returns (tuple(tuple(bytes32 key, address account, address market, address collateralToken, bool isLong, bool isBorrowingFeeAmortized, bool hasReferralCode) addresses, tuple(uint256 sizeInUsd, uint256 sizeInTokens, uint256 collateralAmount, uint256 borrowingFactor, uint256 fundingFeeAmountPerSize, uint256 longTokenClaimableFundingAmountPerSize, uint256 shortTokenClaimableFundingAmountPerSize, uint256 increasedAtTime, uint256 decreasedAtTime, uint256 increasedAtBlock, uint256 decreasedAtBlock) numbers, tuple(uint256 positionType) flags, tuple(address affiliate, address account) referral, tuple(bytes32[] data) ui)[])',
];

// GMX v2 DataStore ABI — for reading position keys
const DATASTORE_ABI = [
  'function getBytes32ValuesAt(bytes32 setKey, uint256 start, uint256 end) view returns (bytes32[])',
  'function getUint(bytes32 key) view returns (uint256)',
];

const READER_ADDR = '0x22199a49A999c351eF7927602CFB187d1Ec25a6';
const DATASTORE_ADDR = '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8';

// GMX market tokens on Arbitrum (most common markets)
const MARKETS = [
  // [marketToken, indexToken, longToken, shortToken]
  { market: '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336', index: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', long: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', short: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', name: 'ETH/USD' },
  { market: '0x47c031236e19d024b42f8AE6780E44A573170703', index: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', long: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', short: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', name: 'BTC/USD' },
  { market: '0x09400D9DB990D5ed3f35D7be61DfAEB900Af03C9', index: '0xC74d67E62f2a4A6e9EDa6B01db7b9CB7cCb8Fc7a', long: '0x912CE59144191C1204E64559FE8253a0e49E6548', short: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', name: 'ARB/USD' },
  { market: '0x6853EA96FF216fAb11D2d930CE3C508556A4bdc4', index: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', long: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', short: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', name: 'MATIC/USD' },
];

// Fetch token prices from DeFiLlama
async function getPrices(tokenAddresses) {
  const ids = tokenAddresses.map(a => `arbitrum:${a.toLowerCase()}`).join(',');
  const res = await fetch(`https://coins.llama.fi/prices/current/${ids}`);
  const data = await res.json();
  const prices = {};
  for (const [key, val] of Object.entries(data.coins ?? {})) {
    const addr = key.split(':')[1];
    prices[addr.toLowerCase()] = val.price;
  }
  return prices;
}

export async function fetchGmxData() {
  const provider = new ethers.JsonRpcProvider(ARB_RPC);
  const reader = new ethers.Contract(READER_ADDR, READER_ABI, provider);
  const dataStore = new ethers.Contract(DATASTORE_ADDR, DATASTORE_ABI, provider);

  const today = new Date().toISOString().split('T')[0];
  const records = [];

  // Try reading positions across known markets
  // Build arrays for getPositions call
  const collateralTokens = [];
  const indexTokens = [];
  const isLongArr = [];

  for (const m of MARKETS) {
    // Try both long and short for each market
    for (const isLong of [true, false]) {
      collateralTokens.push(isLong ? m.long : m.short);
      indexTokens.push(m.index);
      isLongArr.push(isLong);
    }
  }

  let positions = [];
  try {
    positions = await reader.getPositions(DATASTORE_ADDR, WALLET, collateralTokens, indexTokens, isLongArr);
  } catch (err) {
    // If reader call fails, try subgraph fallback
    console.warn('GMX Reader call failed, trying subgraph:', err.message);
    return fetchGmxFromSubgraph();
  }

  // Fetch prices for all index tokens
  const uniqueTokens = [...new Set(MARKETS.map(m => m.index))];
  const prices = await getPrices(uniqueTokens).catch(() => ({}));

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const sizeInUsd = Number(pos.numbers.sizeInUsd) / 1e30;
    if (sizeInUsd < 1) continue; // skip empty / dust positions

    const mktIndex = Math.floor(i / 2);
    const isLong = isLongArr[i];
    const market = MARKETS[mktIndex] ?? { name: 'Unknown' };
    const indexPrice = prices[market.index?.toLowerCase()] ?? 0;

    const collateralAmount = Number(pos.numbers.collateralAmount);
    const sizeInTokens = Number(pos.numbers.sizeInTokens) / 1e18;

    // Rough unrealized PnL: (currentPrice - avgPrice) * size * direction
    const avgPrice = sizeInTokens > 0 ? sizeInUsd / sizeInTokens : 0;
    const unrealizedPnl = indexPrice > 0 && avgPrice > 0
      ? (indexPrice - avgPrice) * sizeInTokens * (isLong ? 1 : -1)
      : 0;

    records.push({
      fields: {
        Date: today,
        Position: `GMX ${market.name} ${isLong ? 'LONG' : 'SHORT'}`,
        Protocol: 'GMX v2',
        Chain: 'Arbitrum',
        Type: 'Perp Hedge',
        'Value USD': parseFloat(sizeInUsd.toFixed(2)),
        'Unrealized PnL USD': parseFloat(unrealizedPnl.toFixed(4)),
        'Entry Price': parseFloat(avgPrice.toFixed(4)),
        'Mark Price': parseFloat(indexPrice.toFixed(4)),
        Notes: `${isLong ? 'Long' : 'Short'} ${sizeInTokens.toFixed(4)} ${market.name.split('/')[0]}`,
      },
    });
  }

  // If no positions found via reader, try subgraph
  if (records.length === 0) {
    return fetchGmxFromSubgraph();
  }

  return {
    summary: { positions: records.length, totalSizeUsd: records.reduce((s, r) => s + r.fields['Value USD'], 0).toFixed(2) },
    records,
  };
}

// Fallback: fetch GMX positions via The Graph subgraph
async function fetchGmxFromSubgraph() {
  const today = new Date().toISOString().split('T')[0];

  const query = `{
    positions(where: { account: "${WALLET.toLowerCase()}", status: "open" }) {
      id
      market
      collateralToken
      isLong
      sizeInUsd
      collateralAmount
      averagePrice
      unrealizedPnl
      closingFee
    }
  }`;

  // Try multiple GMX subgraph endpoints
  const endpoints = [
    'https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/synthetics-arbitrum-stats/api',
    'https://api.thegraph.com/subgraphs/name/gmx-io/gmx-arbitrum-stats',
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      const positions = data?.data?.positions ?? [];

      if (positions.length === 0) {
        console.log('GMX: No open positions found via subgraph.');
        return {
          summary: { positions: 0, note: 'No open GMX positions' },
          records: [{
            fields: {
              Date: today,
              Position: 'GMX Hedge Account',
              Protocol: 'GMX v2',
              Chain: 'Arbitrum',
              Type: 'Perp Hedge',
              'Value USD': 0,
              Notes: 'No open positions — account active but flat',
            },
          }],
        };
      }

      const records = positions.map(p => ({
        fields: {
          Date: today,
          Position: `GMX ${p.isLong ? 'LONG' : 'SHORT'}`,
          Protocol: 'GMX v2',
          Chain: 'Arbitrum',
          Type: 'Perp Hedge',
          'Value USD': parseFloat((Number(p.sizeInUsd) / 1e30).toFixed(2)),
          'Unrealized PnL USD': parseFloat((Number(p.unrealizedPnl ?? 0) / 1e30).toFixed(4)),
          Notes: `${p.isLong ? 'Long' : 'Short'} collateral: ${(Number(p.collateralAmount ?? 0) / 1e18).toFixed(4)}`,
        },
      }));

      return { summary: { positions: records.length }, records };
    } catch (e) {
      console.warn(`GMX subgraph endpoint failed (${endpoint}):`, e.message);
    }
  }

  // Both methods failed — return a placeholder so the run doesn't break
  console.warn('GMX: all data sources failed. Writing placeholder.');
  return {
    summary: { positions: 0, error: 'Data unavailable' },
    records: [{
      fields: {
        Date: today,
        Position: 'GMX Hedge Account',
        Protocol: 'GMX v2',
        Chain: 'Arbitrum',
        Type: 'Perp Hedge',
        'Value USD': 0,
        Notes: 'DATA UNAVAILABLE — check manually',
      },
    }],
  };
}
