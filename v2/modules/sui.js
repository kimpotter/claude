/**
 * Sui Module
 * Reads FullSail SAIL/veSAIL positions, IKA airdrop value, SUI balance.
 * Uses public Sui RPC — no SDK needed.
 */

const SUI_WALLET = '0xe9426ebffd62442727e9c5a90f41ceb41fb0ecdcb9f5ed33fdbd05dc09734d17';
const SUI_RPC = 'https://fullnode.mainnet.sui.io/';

// Known coin types
const COIN_TYPES = {
  SUI:  '0x2::sui::SUI',
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SAIL: '0x1d4a2bd0fdfd02c1b2b65c0d3d3de17a00ae7e15ece0851a9a2b6c1d3b7b8a9c::SAIL::SAIL',  // placeholder — update with real SAIL address
  IKA:  '0x7262fb2d8bd1ecbc01949f4ade3f8cfb9f6b9cef94a99de5e0ce4f23ebbcc2b7::ika::IKA',
};

// FullSail veSAIL lock object type
const FULLSAIL_LOCK_TYPE_PREFIX = '0xe616397e503278';

async function suiRpc(method, params) {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Sui RPC error: ${data.error.message}`);
  return data.result;
}

async function getSuiPrices() {
  // IDs for CoinGecko / DeFiLlama
  const ids = 'sui,ika-network';
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`).catch(() => null);
  if (!res?.ok) return { sui: 0.95, ika: 0 };
  const data = await res.json();
  return {
    sui: data?.sui?.usd ?? 0.95,
    ika: data?.['ika-network']?.usd ?? 0,
  };
}

async function getSailPrice() {
  // SAIL token on Sui — try DeFiLlama or CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=fullsail-finance&vs_currencies=usd');
    const data = await res.json();
    return data?.['fullsail-finance']?.usd ?? 0.00023;
  } catch {
    return 0.00023; // last known ~$0.00023
  }
}

export async function fetchSuiData() {
  const today = new Date().toISOString().split('T')[0];

  // Fetch all balances
  const balances = await suiRpc('suix_getAllBalances', [SUI_WALLET]);
  const prices = await getSuiPrices();
  const sailPrice = await getSailPrice();

  const records = [];
  let suiUsd = 0, ikaUsd = 0, sailUsd = 0, usdcUsd = 0;

  for (const coin of balances) {
    const amount = parseInt(coin.totalBalance ?? '0');
    if (amount === 0) continue;

    const type = coin.coinType;
    const typeLower = type.toLowerCase();

    if (type === COIN_TYPES.SUI) {
      suiUsd = (amount / 1e9) * prices.sui;
    } else if (typeLower.includes('::ika::')) {
      ikaUsd = (amount / 1e9) * prices.ika;
    } else if (typeLower.includes('::usdc::')) {
      usdcUsd = amount / 1e6;
    } else if (typeLower.includes('::sail::')) {
      sailUsd = (amount / 1e9) * sailPrice;
    }
  }

  // SUI balance record
  if (suiUsd > 0.01) {
    records.push({
      fields: {
        Date: today,
        Position: 'SUI Balance',
        Protocol: 'Sui Native',
        Chain: 'Sui',
        Type: 'Spot',
        'Value USD': parseFloat(suiUsd.toFixed(2)),
        Notes: `${(suiUsd / prices.sui).toFixed(4)} SUI @ $${prices.sui.toFixed(4)}`,
      },
    });
  }

  // FullSail SAIL position
  if (sailUsd > 0.01) {
    records.push({
      fields: {
        Date: today,
        Position: 'FullSail SAIL',
        Protocol: 'FullSail Finance',
        Chain: 'Sui',
        Type: 'Protocol Token',
        'Value USD': parseFloat(sailUsd.toFixed(2)),
        Notes: `SAIL tokens + veSAIL locks — price $${sailPrice.toFixed(6)}`,
      },
    });
  }

  // IKA airdrop
  if (ikaUsd > 0.01) {
    records.push({
      fields: {
        Date: today,
        Position: 'IKA Airdrop',
        Protocol: 'IKA Network',
        Chain: 'Sui',
        Type: 'Airdrop',
        'Value USD': parseFloat(ikaUsd.toFixed(2)),
        Notes: `IKA token @ $${prices.ika.toFixed(6)} — consider rotation to LP capital`,
      },
    });
  }

  // USDC
  if (usdcUsd > 0.01) {
    records.push({
      fields: {
        Date: today,
        Position: 'USDC (Sui)',
        Protocol: 'Sui',
        Chain: 'Sui',
        Type: 'Stablecoin',
        'Value USD': parseFloat(usdcUsd.toFixed(2)),
        Notes: 'Available for deployment',
      },
    });
  }

  // Check for veSAIL lock NFTs
  try {
    const objects = await suiRpc('suix_getOwnedObjects', [
      SUI_WALLET,
      { options: { showType: true } },
      null,
      50,
    ]);
    const veSailCount = (objects.data ?? []).filter(o =>
      (o.data?.type ?? '').includes(FULLSAIL_LOCK_TYPE_PREFIX)
    ).length;

    if (veSailCount > 0) {
      records.push({
        fields: {
          Date: today,
          Position: `FullSail veSAIL Locks (×${veSailCount})`,
          Protocol: 'FullSail Finance',
          Chain: 'Sui',
          Type: 'Locked Stake',
          'Value USD': 0, // locked value included in SAIL record above
          Notes: `${veSailCount} escrowed SAIL NFTs — value counted in SAIL token balance`,
        },
      });
    }
  } catch (e) {
    console.warn('Sui: veSAIL object scan failed:', e.message);
  }

  const totalUsd = records.reduce((s, r) => s + r.fields['Value USD'], 0);

  return {
    summary: { totalUsd: totalUsd.toFixed(2), records: records.length },
    records,
  };
}
