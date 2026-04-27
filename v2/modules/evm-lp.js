/**
 * EVM LP Module — Base chain
 * Reads Uniswap V3 WETH/USDC CLP positions managed via Sickle protocol.
 *
 * Approach:
 *   1. Find Uniswap V3 position NFTs owned by Kim's wallet (or Sickle proxy)
 *   2. Read position liquidity, tick range, and earned fees
 *   3. Compute USD value using current pool price
 *   4. Get APY from DeFiLlama
 */

import { ethers } from 'ethers';

const WALLET = '0x3428266F49F58c2fE97Da937529302bDbc97F0F0';
const BASE_RPC = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';

// Uniswap V3 NonfungiblePositionManager on Base
const NPM_ADDR = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';

const NPM_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];

// Uniswap V3 Pool ABI — only what we need
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
];

// Known Uniswap V3 pool addresses on Base for WETH/USDC
const POOLS = {
  '500':  '0xd0b53D9277642d899DF5C87A3966A349A798F224', // 0.05% — CL50
  '100':  '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B5', // 0.01% — CL1
};

// WETH and USDC on Base
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Sickle proxy factory on Base — find Kim's personal Sickle contract
const SICKLE_FACTORY_ADDR = '0x741a9C5b2B0c2fa49baa4B1d99E92e81E3E17eEA';
const SICKLE_FACTORY_ABI = [
  'function sickles(address owner) view returns (address)',
];

async function getSickleAddress(provider) {
  try {
    const factory = new ethers.Contract(SICKLE_FACTORY_ADDR, SICKLE_FACTORY_ABI, provider);
    return await factory.sickles(WALLET);
  } catch {
    return null;
  }
}

// Convert sqrtPriceX96 to price (USDC per WETH, adjusted for decimals)
function sqrtPriceToPrice(sqrtPriceX96, token0IsWeth) {
  const Q96 = BigInt(2) ** BigInt(96);
  const sqrtPrice = BigInt(sqrtPriceX96.toString());
  // price = (sqrtPrice / 2^96)^2
  // Adjust for token decimals: WETH=18, USDC=6 → ratio 1e12
  const rawPrice = Number((sqrtPrice * sqrtPrice * BigInt(1e12)) / (Q96 * Q96));
  return token0IsWeth ? rawPrice : 1 / rawPrice;
}

// Approximate token amounts from liquidity + ticks
function getAmountsFromLiquidity(liquidity, sqrtPriceX96, tickLower, tickUpper) {
  const Q96 = 2n ** 96n;
  const sqrtRatio = BigInt(sqrtPriceX96.toString());

  function tickToSqrtRatio(tick) {
    const absTick = tick < 0 ? -tick : tick;
    let ratio = absTick & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
    if (absTick & 0x2) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
    if (absTick & 0x4) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
    if (absTick & 0x8) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
    if (absTick & 0x10) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
    if (absTick & 0x20) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
    if (absTick & 0x40) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
    if (absTick & 0x80) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
    if (absTick & 0x100) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
    if (absTick & 0x200) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
    if (absTick & 0x400) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
    if (absTick & 0x800) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
    if (absTick & 0x1000) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
    if (absTick & 0x2000) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
    if (absTick & 0x4000) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
    if (absTick & 0x8000) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
    if (absTick & 0x10000) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
    if (absTick & 0x20000) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
    if (absTick & 0x40000) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
    if (absTick & 0x80000) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;
    if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;
    return ratio >> 32n;
  }

  const sqrtLower = tickToSqrtRatio(tickLower);
  const sqrtUpper = tickToSqrtRatio(tickUpper);
  const liq = BigInt(liquidity.toString());

  let amount0 = 0n, amount1 = 0n;

  if (sqrtRatio <= sqrtLower) {
    // Below range: all token0
    amount0 = (liq * Q96 * (sqrtUpper - sqrtLower)) / (sqrtLower * sqrtUpper);
  } else if (sqrtRatio < sqrtUpper) {
    // In range
    amount0 = (liq * Q96 * (sqrtUpper - sqrtRatio)) / (sqrtRatio * sqrtUpper);
    amount1 = (liq * (sqrtRatio - sqrtLower)) / Q96;
  } else {
    // Above range: all token1
    amount1 = (liq * (sqrtUpper - sqrtLower)) / Q96;
  }

  return { amount0, amount1 };
}

async function fetchApy(chain, pool) {
  try {
    const res = await fetch('https://yields.llama.fi/pools');
    const data = await res.json();
    const match = (data.data ?? []).find(p =>
      p.chain?.toLowerCase() === chain.toLowerCase() &&
      p.project === 'uniswap-v3' &&
      p.pool?.toLowerCase() === pool?.toLowerCase()
    );
    return match ? { apy: match.apy, apy30d: match.apyMean30d } : null;
  } catch {
    return null;
  }
}

export async function fetchEvmLpData() {
  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const npm = new ethers.Contract(NPM_ADDR, NPM_ABI, provider);
  const today = new Date().toISOString().split('T')[0];
  const records = [];

  // Check both the wallet directly and its Sickle proxy
  const sickleAddr = await getSickleAddress(provider);
  const addresses = [WALLET];
  if (sickleAddr && sickleAddr !== ethers.ZeroAddress) addresses.push(sickleAddr);

  // Get ETH price for WETH valuation
  const priceRes = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:usd-coin').catch(() => null);
  const priceData = priceRes ? await priceRes.json() : {};
  const ethPrice = priceData?.coins?.['coingecko:ethereum']?.price ?? 2000;

  for (const addr of addresses) {
    const balance = await npm.balanceOf(addr).catch(() => 0n);
    if (balance === 0n) continue;

    for (let i = 0; i < Number(balance); i++) {
      try {
        const tokenId = await npm.tokenOfOwnerByIndex(addr, i);
        const pos = await npm.positions(tokenId);

        if (pos.liquidity === 0n && pos.tokensOwed0 === 0n && pos.tokensOwed1 === 0n) continue;

        const feeStr = pos.fee.toString();
        const poolAddr = POOLS[feeStr];
        const pool = poolAddr ? new ethers.Contract(poolAddr, POOL_ABI, provider) : null;
        const slot0 = pool ? await pool.slot0().catch(() => null) : null;

        const sqrtPriceX96 = slot0?.sqrtPriceX96 ?? 0n;
        const token0IsWeth = pos.token0.toLowerCase() === WETH.toLowerCase();

        // Token amounts in position
        const { amount0, amount1 } = getAmountsFromLiquidity(
          pos.liquidity, sqrtPriceX96, pos.tickLower, pos.tickUpper
        );

        // Claimable fees
        const fees0 = pos.tokensOwed0;
        const fees1 = pos.tokensOwed1;

        // USD values
        const wethAmount = token0IsWeth
          ? Number(amount0) / 1e18 + Number(fees0) / 1e18
          : Number(amount1) / 1e18 + Number(fees1) / 1e18;
        const usdcAmount = token0IsWeth
          ? Number(amount1) / 1e6 + Number(fees1) / 1e6
          : Number(amount0) / 1e6 + Number(fees0) / 1e6;

        const valueUsd = wethAmount * ethPrice + usdcAmount;
        const earnedFeesUsd = (token0IsWeth
          ? Number(fees0) / 1e18 * ethPrice + Number(fees1) / 1e6
          : Number(fees1) / 1e18 * ethPrice + Number(fees0) / 1e6);

        // APY from DeFiLlama
        const apyData = await fetchApy('Base', poolAddr);

        const inRange = slot0 ? (pos.tickLower <= slot0.tick && slot0.tick < pos.tickUpper) : null;

        records.push({
          fields: {
            Date: today,
            Position: `WETH/USDC CL${feeStr === '500' ? '50' : feeStr === '100' ? '1' : feeStr} #${tokenId.toString()}`,
            Protocol: 'Uniswap V3 (Sickle)',
            Chain: 'Base',
            Type: 'CLMM LP',
            'Value USD': parseFloat(valueUsd.toFixed(2)),
            'WETH Amount': parseFloat(wethAmount.toFixed(6)),
            'USDC Amount': parseFloat(usdcAmount.toFixed(2)),
            'Pending Fees USD': parseFloat(earnedFeesUsd.toFixed(4)),
            'In Range': inRange === null ? 'unknown' : inRange ? 'yes' : 'NO - OUT OF RANGE',
            'Tick Lower': pos.tickLower,
            'Tick Upper': pos.tickUpper,
            'Current Tick': slot0 ? Number(slot0.tick) : null,
            'APY Current %': apyData?.apy ? parseFloat(apyData.apy.toFixed(2)) : null,
            'APY 30d Avg %': apyData?.apy30d ? parseFloat(apyData.apy30d.toFixed(2)) : null,
            Notes: `TokenID: ${tokenId.toString()} | Holder: ${addr.slice(0,8)}…`,
          },
        });
      } catch (err) {
        console.warn(`EVM LP: failed to read position ${i}:`, err.message);
      }
    }
  }

  return {
    summary: { positions: records.length, totalUsd: records.reduce((s, r) => s + r.fields['Value USD'], 0).toFixed(2) },
    records,
  };
}
