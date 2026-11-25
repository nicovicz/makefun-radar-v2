// Meridian Valuation Engine: derives implied pre-token values and concrete farm plans solely from the snapshot.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotInput {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

export const ATLAS_PARAMS = {
  ratioFloor: 0.05,
  ratioCeiling: 12.0,
  bayesianPriorPeers: 3,
  momentumWeight: 0.5,
  maturityFloor: 0.75,
  maturityHorizonDays: 730,
  fallbackAgeDays: 365,
  chainBreadthStep: 0.05,
  maxExtraChains: 4,
};

function clampNumber(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hasNoRecordedToken(p: SnapshotProtocol): boolean {
  return !p.gecko_id && !p.symbol && !(p.mcap_usd !== null && p.mcap_usd > 0);
}

function estimateGasProfile(chainName: string): { perTx: string; weeklyBudget: string } {
  const lc = chainName.toLowerCase();
  if (lc === 'ethereum') return { perTx: '$4–$10 gas', weeklyBudget: '$8–$15/week' };
  if (/solana|sui|aptos|ton|near|stellar|sei/.test(lc)) {
    return { perTx: '$0.01–$0.04 gas', weeklyBudget: '$0.10/week' };
  }
  if (/base|arbitrum|optimism|polygon|bsc|avalanche|linea|scroll|zksync|blast|berachain|hyperliquid|ink|monad/.test(lc)) {
    return { perTx: '$0.05–$0.30 gas', weeklyBudget: '$0.50–$1/week' };
  }
  return { perTx: '$0.25–$1.20 gas', weeklyBudget: '$1–$2/week' };
}

function buildFarmPlan(p: SnapshotProtocol, ageDays: number | null): string[] {
  const primaryChain = p.chains[0] || 'the primary supported network';
  const secondary = p.chains.length > 1 ? ` (multi-chain: ${p.chains.slice(1, 3).join(', ')})` : '';
  const cat = (p.category || '').toLowerCase();
  const gas = estimateGasProfile(primaryChain);
  const capitalUsd = p.tvl_usd >= 1e9 ? 200 : p.tvl_usd >= 1e8 ? 100 : 50;
  const weeks = ageDays === null || ageDays < 365 ? 8 : 4;

  let coreTask = `interact with ${p.name}'s primary contract using ~$${capitalUsd} in liquid collateral`;
  if (/lend|cdp/.test(cat)) {
    coreTask = `supply ~$${capitalUsd} to a liquid market and test one conservative borrow/repay cycle`;
  } else if (/dex|amm/.test(cat)) {
    coreTask = `route 2–3 organic swaps totaling ~$${capitalUsd} on major pairs; add LP only after checking IL`;
  } else if (/prediction/.test(cat)) {
    coreTask = `take 2–3 hedged positions totaling ~$${capitalUsd} in liquid markets and redeem settled shares`;
  } else if (/bridge/.test(cat)) {
    coreTask = `bridge ~$${capitalUsd} into ${primaryChain} and verify arrival on the destination explorer`;
  } else if (/perpetual|derivative/.test(cat)) {
    coreTask = `open and close a low-leverage (1x–2x) ~$${capitalUsd} position to record genuine margin activity`;
  } else if (/staking|restaking/.test(cat)) {
    coreTask = `stake ~$${capitalUsd} only after confirming the withdrawal queue and unbonding delay`;
  } else if (/yield|vault|curator|rwa/.test(cat)) {
    coreTask = `deposit ~$${capitalUsd} into a flagship vault after checking curator fees and exit liquidity`;
  }

  return [
    `Independently verify ${p.name}'s official app, contract audits, and ${primaryChain} deployment${secondary}. Cost: $0. Time: 10 minutes.`,
    `Fund a dedicated wallet on ${primaryChain} with ~$${capitalUsd} plus native gas (${gas.perTx}); keep recovery keys offline. Cost: $${capitalUsd} capital + ${gas.perTx}. Time: 10 minutes.`,
    `On ${p.name}, ${coreTask}. Cost: up to $${capitalUsd} at risk + protocol fees and ${gas.perTx}. Time: 15 minutes.`,
    `Repeat light, natural usage across ${weeks} weekly epochs instead of single-day bursts; archive transaction hashes. Cost: ${gas.weeklyBudget}. Time: 10 minutes/week.`,
    `Monitor official governance or points disclosures, claim accrued yield, and unwind once risk-adjusted return drops; no launch is guaranteed. Cost: ${gas.perTx} exit. Time: 15 minutes.`,
  ];
}

export function buildAtlas(snapshot: SnapshotInput) {
  const categoryRatios = new Map<string, number[]>();
  const globalRatios: number[] = [];

  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const clampedRatio = clampNumber(p.mcap_usd / p.tvl_usd, ATLAS_PARAMS.ratioFloor, ATLAS_PARAMS.ratioCeiling);
      globalRatios.push(clampedRatio);
      const catKey = p.category || 'Unclassified';
      const bucket = categoryRatios.get(catKey);
      if (bucket) bucket.push(clampedRatio);
      else categoryRatios.set(catKey, [clampedRatio]);
    }
  }

  const globalMedian = globalRatios.length > 0 ? computeMedian(globalRatios) : 1.0;
  const watchlistSet = new Set(snapshot.watchlist);
  const asOfMs = Date.parse(snapshot.as_of);

  const rows = snapshot.protocols
    .filter((p) => hasNoRecordedToken(p) || watchlistSet.has(p.slug))
    .map((p) => {
      const catKey = p.category || 'Unclassified';
      const peers = categoryRatios.get(catKey) || [];
      const rawCatMedian = peers.length > 0 ? computeMedian(peers) : globalMedian;
      const prior = ATLAS_PARAMS.bayesianPriorPeers;
      const multiple =
        peers.length > 0 ? (peers.length * rawCatMedian + prior * globalMedian) / (peers.length + prior) : globalMedian;

      const listedMs = p.listed_at ? Date.parse(p.listed_at) : NaN;
      const ageDays = Number.isFinite(listedMs) ? Math.max(0, Math.floor((asOfMs - listedMs) / 86400000)) : null;

      const clampedGrowth = clampNumber(p.change_7d ?? 0, -50, 50);
      const momentum = 1 + (clampedGrowth / 100) * ATLAS_PARAMS.momentumWeight;
      const effectiveAge = Math.min(ageDays ?? ATLAS_PARAMS.fallbackAgeDays, ATLAS_PARAMS.maturityHorizonDays);
      const maturity =
        ATLAS_PARAMS.maturityFloor + (1 - ATLAS_PARAMS.maturityFloor) * (effectiveAge / ATLAS_PARAMS.maturityHorizonDays);
      const breadth = 1 + ATLAS_PARAMS.chainBreadthStep * Math.min(Math.max(p.chains.length - 1, 0), ATLAS_PARAMS.maxExtraChains);

      const impliedValue = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
      const confidence =
        peers.length >= 3 && p.change_7d !== null && ageDays !== null && p.chains.length > 0
          ? 'High'
          : peers.length > 0 && p.change_7d !== null && ageDays !== null
            ? 'Medium'
            : 'Low';

      return {
        ...p,
        rank: 0,
        watchlist: watchlistSet.has(p.slug),
        age_days: ageDays,
        implied_value_usd: impliedValue,
        confidence,
        model: {
          multiple,
          raw_category_median: rawCatMedian,
          global_median: globalMedian,
          peer_count: peers.length,
          growth: clampedGrowth,
          momentum,
          maturity,
          breadth,
        },
        farm_steps: buildFarmPlan(p, ageDays),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));

  for (let i = 0; i < rows.length; i++) {
    rows[i].rank = i + 1;
  }

  const live = snapshot.protocols
    .filter((p) => !hasNoRecordedToken(p) && !watchlistSet.has(p.slug))
    .map((p) => ({
      ...p,
      implied_value_usd: p.mcap_usd !== null && p.mcap_usd > 0 ? p.mcap_usd : null,
    }))
    .sort((a, b) => (b.mcap_usd || 0) - (a.mcap_usd || 0));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: watchlistSet.size,
    params: ATLAS_PARAMS,
    rows,
    live,
  };
}
