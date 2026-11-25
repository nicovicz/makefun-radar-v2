// Meridian Launch Atlas UI: sorting, multi-facet filtering, interactive log scatter, and sensitivity lab.

const atlas = window.ATLAS;
const $ = (sel) => document.querySelector(sel);

const esc = (v) =>
  String(v ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtUsd = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + Math.round(n).toLocaleString();
};

const fmtPct = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

const state = {
  tab: 'pre',
  sort: 'rank',
  dir: 'asc',
  search: '',
  watch: '',
  cat: '',
  chain: '',
  tvl: '',
  growth: '',
  slug: '',
  momWeight: atlas.params.momentumWeight,
  matFloor: atlas.params.maturityFloor,
};

let visibleRows = [];

function initFilters() {
  $('#as-of').textContent = atlas.as_of;
  $('#kpi-pre').textContent = String(atlas.rows.length);
  $('#kpi-watch').textContent = String(atlas.watchlist_size);

  const all = [...atlas.rows, ...atlas.live];
  const cats = [...new Set(all.map((r) => r.category || 'Unclassified'))].sort();
  const chains = [...new Set(all.flatMap((r) => r.chains))].sort();
  for (const c of cats) $('#f-cat').add(new Option(c, c));
  for (const ch of chains) $('#f-chain').add(new Option(ch, ch));

  const q = new URLSearchParams(location.search);
  if (q.get('tab') === 'live') {
    state.tab = 'live';
    state.sort = 'implied_value_usd';
    state.dir = 'desc';
  }
  for (const k of ['watch', 'cat', 'chain', 'tvl', 'growth', 'search', 'slug']) {
    if (q.has(k)) state[k] = q.get(k);
  }
  $('#f-watch').value = state.watch;
  $('#f-cat').value = state.cat;
  $('#f-chain').value = state.chain;
  $('#f-tvl').value = state.tvl;
  $('#f-growth').value = state.growth;
  $('#f-search').value = state.search;
}

function queryRows() {
  const source = state.tab === 'pre' ? atlas.rows : atlas.live;
  const term = state.search.trim().toLowerCase();
  return source
    .filter((r) => {
      if (state.tab === 'pre' && state.watch === 'watch' && !r.watchlist) return false;
      if (state.cat && (r.category || 'Unclassified') !== state.cat) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.tvl === 'sm' && r.tvl_usd >= 5e7) return false;
      if (state.tvl === 'md' && (r.tvl_usd < 5e7 || r.tvl_usd >= 1e9)) return false;
      if (state.tvl === 'lg' && r.tvl_usd < 1e9) return false;
      if (state.growth === 'up' && !(r.change_7d > 0)) return false;
      if (state.growth === 'down' && !(r.change_7d < 0)) return false;
      if (term) {
        const hay = `${r.name} ${r.slug} ${r.category || ''} ${r.chains.join(' ')}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const av = a[state.sort];
      const bv = b[state.sort];
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return cmp * (state.dir === 'asc' ? 1 : -1) || a.name.localeCompare(b.name);
    });
}

function renderScatter(rows) {
  const pts = rows.filter((r) => r.tvl_usd > 0 && r.implied_value_usd > 0);
  if (!pts.length) {
    $('#scatter').innerHTML = '<div class="plot-axis">No protocols in current filter.</div>';
    return;
  }
  const vals = pts.flatMap((r) => [Math.log10(r.tvl_usd), Math.log10(r.implied_value_usd)]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const xPos = (v) => 16 + ((Math.log10(v) - lo) / span) * 768;
  const yPos = (v) => 60 - ((Math.log10(v) - lo) / span) * 50;

  const dots = pts
    .map((r) => {
      const sel = r.slug === state.slug;
      const fill = sel ? '#ffffff' : r.watchlist ? '#e6b34a' : '#38bdf8';
      const rad = sel ? 5 : r.watchlist ? 3.2 : 2.3;
      const op = sel ? 1 : r.watchlist ? 0.92 : 0.65;
      return `<circle data-dot="${esc(r.slug)}" cx="${xPos(r.tvl_usd).toFixed(1)}" cy="${yPos(r.implied_value_usd).toFixed(1)}" r="${rad}" fill="${fill}" fill-opacity="${op}" style="cursor:pointer"><title>${esc(r.name)} · TVL ${fmtUsd(r.tvl_usd)} · Value ${fmtUsd(r.implied_value_usd)}</title></circle>`;
    })
    .join('');

  $('#scatter').innerHTML =
    `<svg viewBox="0 0 800 68" preserveAspectRatio="none"><line x1="16" y1="60" x2="784" y2="10" stroke="#263245" stroke-dasharray="4 4"/>${dots}</svg>` +
    `<div class="plot-axis"><span>${fmtUsd(10 ** lo)}</span><span>TVL (Horizontal) vs. Implied Value (Vertical)</span><span>${fmtUsd(10 ** hi)}</span></div>`;
}

function computeScenario(r) {
  const m = r.model;
  const mom = 1 + (m.growth / 100) * state.momWeight;
  const frac = Math.min(r.age_days ?? atlas.params.fallbackAgeDays, atlas.params.maturityHorizonDays) / atlas.params.maturityHorizonDays;
  const mat = state.matFloor + (1 - state.matFloor) * frac;
  const val = Math.max(1, Math.round(r.tvl_usd * m.multiple * mom * mat * m.breadth));
  return { mom, mat, val };
}

function renderDrawer(r) {
  const el = $('#drawer');
  if (!r) {
    el.innerHTML = '<div class="drawer-top"><div class="kicker">NO SELECTION</div><h3>Select a protocol</h3><div class="drawer-sub">Adjust filters to inspect a protocol.</div></div>';
    return;
  }
  const isPre = state.tab === 'pre';
  if (!isPre) {
    el.innerHTML = `
      <div class="drawer-top">
        <div class="kicker">LIVE TOKEN REFERENCE</div>
        <h3>${esc(r.name)} <span class="tag medium">${esc(r.symbol || 'LIVE')}</span></h3>
        <div class="drawer-sub">${esc(r.category || 'Unclassified')} · ${esc(r.chains.join(', '))}</div>
        <div class="big-val">${fmtUsd(r.implied_value_usd)}</div>
      </div>
      <div class="box">
        <h4>SNAPSHOT METRICS</h4>
        <div class="kv"><span>Recorded TVL</span><b>${fmtUsd(r.tvl_usd)}</b></div>
        <div class="kv"><span>7-Day Change</span><b>${fmtPct(r.change_7d)}</b></div>
        <div class="kv"><span>Listed Date</span><b>${esc(r.listed_at)}</b></div>
      </div>`;
    return;
  }

  const m = r.model;
  const sc = computeScenario(r);
  el.innerHTML = `
    <div class="drawer-top">
      <div class="kicker">RANK #${String(r.rank).padStart(3, '0')} ${r.watchlist ? '· HOUSE WATCHLIST' : '· EARLY RADAR'}</div>
      <h3>${esc(r.name)} <span class="tag ${r.confidence.toLowerCase()}">${esc(r.confidence.toUpperCase())}</span></h3>
      <div class="drawer-sub">${esc(r.category || 'Unclassified')} · ${esc(r.chains.join(', ') || 'No chain')}</div>
      <div class="big-val">${fmtUsd(r.implied_value_usd)}</div>
    </div>

    <div class="box">
      <h4>VALUATION WATERFALL</h4>
      <div class="kv"><span>Snapshot TVL</span><b>${fmtUsd(r.tvl_usd)}</b></div>
      <div class="kv"><span>Shrunk Multiple (${m.peer_count} peers)</span><b>${m.multiple.toFixed(3)}×</b></div>
      <div class="kv"><span>7d Momentum (${fmtPct(m.growth)} clamped)</span><b>${m.momentum.toFixed(3)}×</b></div>
      <div class="kv"><span>Operating Maturity (${r.age_days == null ? '365d fallback' : r.age_days + 'd'})</span><b>${m.maturity.toFixed(3)}×</b></div>
      <div class="kv"><span>Multi-Chain Breadth (${r.chains.length} chains)</span><b>${m.breadth.toFixed(3)}×</b></div>
    </div>

    <div class="box">
      <h4>SENSITIVITY LAB (DOES NOT ALTER RANK)</h4>
      <div class="slider-row">
        <label>Momentum weight <b id="lbl-mom">${state.momWeight.toFixed(2)}×</b></label>
        <input id="sl-mom" type="range" min="0" max="1" step="0.05" value="${state.momWeight}" />
      </div>
      <div class="slider-row">
        <label>Maturity floor <b id="lbl-mat">${state.matFloor.toFixed(2)}×</b></label>
        <input id="sl-mat" type="range" min="0.5" max="1" step="0.05" value="${state.matFloor}" />
      </div>
      <div class="scenario-out"><span>Scenario Value</span><strong id="sc-val">${fmtUsd(sc.val)}</strong></div>
    </div>

    <div class="box">
      <h4>CONCRETE FARM PLAN (COST &amp; TIME)</h4>
      <ol class="plan-list">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>`;
}

function render() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#f-watch').disabled = state.tab !== 'pre';

  visibleRows = queryRows();
  if (!visibleRows.some((r) => r.slug === state.slug)) {
    state.slug = visibleRows[0]?.slug || '';
  }

  const totalTvl = visibleRows.reduce((acc, r) => acc + (r.tvl_usd || 0), 0);
  $('#kpi-tvl').textContent = fmtUsd(totalTvl);
  $('#result-count').textContent = `(${visibleRows.length})`;
  $('#foot-summary').textContent = `${visibleRows.length} protocols shown · ${state.tab === 'pre' ? 'Pre-Token Model' : 'Live Token Reference'}`;
  $('#empty-msg').hidden = visibleRows.length > 0;

  document.querySelectorAll('[data-sort]').forEach((btn) => {
    const active = btn.dataset.sort === state.sort;
    btn.classList.toggle('active', active);
    const base = btn.textContent.replace(/ [↑↓]$/, '');
    btn.textContent = active ? `${base} ${state.dir === 'asc' ? '↑' : '↓'}` : base;
  });

  $('#tbody').innerHTML = visibleRows
    .map(
      (r) => `
      <tr data-slug="${esc(r.slug)}" class="${r.slug === state.slug ? 'selected' : ''}">
        <td class="rank-cell">${r.rank ? String(r.rank).padStart(3, '0') : '—'}</td>
        <td>
          <span class="proto-name">${esc(r.name)}</span>${r.watchlist ? '<span class="tag watch">WATCH</span>' : ''}
          <span class="proto-sub">${esc(r.category || 'Unclassified')} · ${esc(r.chains[0] || '—')}</span>
        </td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num ${r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''}">${fmtPct(r.change_7d)}</td>
        <td class="num val-cell">${fmtUsd(r.implied_value_usd)}</td>
        <td>${r.confidence ? `<span class="tag ${r.confidence.toLowerCase()}">${esc(r.confidence)}</span>` : '<span class="tag medium">LIVE</span>'}</td>
      </tr>`,
    )
    .join('');

  renderScatter(visibleRows);
  renderDrawer(visibleRows.find((r) => r.slug === state.slug));
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.sort = state.tab === 'pre' ? 'rank' : 'implied_value_usd';
      state.dir = state.tab === 'pre' ? 'asc' : 'desc';
      state.slug = '';
      render();
    }),
  );

  document.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      state.dir = state.sort === k ? (state.dir === 'asc' ? 'desc' : 'asc') : k === 'rank' || k === 'name' ? 'asc' : 'desc';
      state.sort = k;
      render();
    }),
  );

  for (const [id, key] of [['#f-search', 'search'], ['#f-watch', 'watch'], ['#f-cat', 'cat'], ['#f-chain', 'chain'], ['#f-tvl', 'tvl'], ['#f-growth', 'growth']]) {
    $(id).addEventListener('input', (e) => {
      state[key] = e.target.value;
      state.slug = '';
      render();
    });
  }

  $('#f-reset').addEventListener('click', () => {
    for (const [id, key] of [['#f-search', 'search'], ['#f-watch', 'watch'], ['#f-cat', 'cat'], ['#f-chain', 'chain'], ['#f-tvl', 'tvl'], ['#f-growth', 'growth']]) {
      state[key] = '';
      $(id).value = '';
    }
    state.slug = '';
    render();
  });

  $('#tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) {
      state.slug = tr.dataset.slug;
      render();
    }
  });

  $('#scatter').addEventListener('click', (e) => {
    const dot = e.target.closest('[data-dot]');
    if (dot) {
      state.slug = dot.dataset.dot;
      render();
    }
  });

  $('#drawer').addEventListener('input', (e) => {
    if (e.target.id === 'sl-mom') state.momWeight = Number(e.target.value);
    if (e.target.id === 'sl-mat') state.matFloor = Number(e.target.value);
    const cur = visibleRows.find((r) => r.slug === state.slug);
    if (cur?.model) {
      const sc = computeScenario(cur);
      $('#lbl-mom').textContent = state.momWeight.toFixed(2) + '×';
      $('#lbl-mat').textContent = state.matFloor.toFixed(2) + '×';
      $('#sc-val').textContent = fmtUsd(sc.val);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#f-search')) {
      e.preventDefault();
      $('#f-search').focus();
    } else if (e.key === 'Escape') {
      $('#f-search').blur();
    } else if ((e.key === 'ArrowDown' || e.key === 'j') && document.activeElement !== $('#f-search')) {
      e.preventDefault();
      const idx = visibleRows.findIndex((r) => r.slug === state.slug);
      if (idx >= 0 && idx + 1 < visibleRows.length) {
        state.slug = visibleRows[idx + 1].slug;
        render();
      }
    } else if ((e.key === 'ArrowUp' || e.key === 'k') && document.activeElement !== $('#f-search')) {
      e.preventDefault();
      const idx = visibleRows.findIndex((r) => r.slug === state.slug);
      if (idx > 0) {
        state.slug = visibleRows[idx - 1].slug;
        render();
      }
    }
  });
}

initFilters();
bindEvents();
render();
