(() => {
  'use strict';

  const api = window.piggyBank;
  const content = document.querySelector('#page-content');
  const title = document.querySelector('#page-title');
  const kicker = document.querySelector('#page-kicker');
  const setup = document.querySelector('#setup-screen');
  const warning = document.querySelector('#export-warning');
  const recovery = document.querySelector('#recovery-notice');
  const saveError = document.querySelector('#save-error');
  const modalRoot = document.querySelector('#modal-root');
  const toastNode = document.querySelector('#toast');
  let state = null;
  let page = 'overview';
  let analysisDimension = 'platform';
  let recordDraft = null;
  const expandedHistory = new Set();
  let modalConfirm = null;
  let toastTimer = null;
  let persistentError = null;

  const pageMeta = {
    overview: ['本地资产快照', '总览'],
    record: ['手动记录每个时点', '记一笔'],
    history: ['所有记录都留在本地', '历史'],
    analysis: ['只读的多维度查看', '分析'],
    manage: ['平台、产品与资产类型', '管理'],
    data: ['本机文件、备份和迁移', '数据与备份']
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const money = (value) => '¥' + Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const number = (value) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString('en-CA');
  const ordered = (items) => [...items].sort((a, b) => Number(a.sort) - Number(b.sort) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const byId = (items) => new Map(items.map((item) => [item.id, item]));

  function dateTime(value) {
    if (!value) return '暂无';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString('zh-CN', { hour12: false });
  }

  function toast(message, isError = false) {
    if (isError) {
      persistentError = message;
      updateBanners();
    }
    clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.classList.toggle('is-error', isError);
    toastNode.classList.remove('is-hidden');
    toastTimer = setTimeout(() => toastNode.classList.add('is-hidden'), 3400);
  }

  function activeProducts() {
    return state.data.products;
  }

  function orderedSnapshots() {
    return [...state.data.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  }

  function totals(snapshot) {
    const products = byId(state.data.products);
    const types = byId(state.data.assetTypes);
    let assets = 0;
    let debts = 0;
    for (const productId of Object.keys(snapshot?.values || {})) {
      const product = products.get(productId);
      if (!product || product.includeInTotal === false) continue;
      const value = Number(snapshot.values[productId]) || 0;
      if (types.get(product.assetTypeId)?.role === 'debt') debts += Math.abs(value);
      else assets += Math.max(0, value);
    }
    return { assets, debts, net: assets - debts };
  }

  function rows() {
    const snapshots = orderedSnapshots();
    return snapshots.map((snapshot, index) => {
      const current = totals(snapshot);
      const previous = index ? totals(snapshots[index - 1]) : null;
      const change = previous ? current.net - previous.net : null;
      return { snapshot, current, previous, change, rate: previous && previous.net !== 0 ? change / Math.abs(previous.net) : null };
    });
  }

  function currentRow() {
    return rows().at(-1) || null;
  }

  function previousRow() {
    return rows().at(-2) || null;
  }

  function groupAmounts(snapshot, dimension) {
    const products = byId(state.data.products);
    const platforms = byId(state.data.platforms);
    const types = byId(state.data.assetTypes);
    const groups = new Map();
    const source = dimension === 'platform' ? state.data.platforms : state.data.assetTypes;
    for (const entry of source) groups.set(entry.id, { id: entry.id, name: entry.name, color: dimension === 'platform' ? '#d991ab' : entry.color, amount: 0, role: entry.role || 'asset' });
    for (const [productId, raw] of Object.entries(snapshot?.values || {})) {
      const product = products.get(productId);
      if (!product || product.includeInTotal === false) continue;
      const groupId = dimension === 'platform' ? product.platformId : product.assetTypeId;
      const group = groups.get(groupId);
      if (!group) continue;
      const value = Number(raw) || 0;
      group.amount += group.role === 'debt' ? Math.abs(value) : Math.max(0, value);
    }
    return [...groups.values()].filter((group) => group.amount !== 0);
  }

  function recordNetForPlatform(snapshot, platformId) {
    return groupAmounts(snapshot, 'platform').find((item) => item.id === platformId)?.amount || 0;
  }

  function ensureDraft() {
    const latest = currentRow()?.snapshot;
    if (recordDraft) {
      for (const product of activeProducts()) {
        if (!Number.isFinite(Number(recordDraft.values[product.id]))) recordDraft.values[product.id] = Number(latest?.values?.[product.id] ?? 0);
      }
      return;
    }
    const values = {};
    for (const product of activeProducts()) values[product.id] = Number(latest?.values?.[product.id] ?? 0);
    recordDraft = { date: today(), note: '', values };
  }

  function resetDraftToPrevious() {
    const latest = currentRow()?.snapshot;
    for (const product of activeProducts()) recordDraft.values[product.id] = Number(latest?.values?.[product.id] ?? 0);
    render();
  }

  function updateBanners() {
    if (!state?.data) return;
    const hasSnapshots = state.data.snapshots.length > 0;
    const reference = state.data.metadata.lastExportAt || state.data.metadata.lastSavedAt;
    const overdue = hasSnapshots && reference && Date.now() - new Date(reference).getTime() > 14 * 86400000;
    warning.classList.toggle('is-hidden', !overdue);
    warning.textContent = overdue ? '⚠️ 数据已超过 14 天未导出备份。请到“数据与备份”导出一份 JSON。' : '';
    recovery.classList.toggle('is-hidden', !state.recoveryNotice);
    recovery.textContent = state.recoveryNotice || '';
    saveError.classList.toggle('is-hidden', !persistentError);
    saveError.textContent = persistentError ? '保存或写入失败：' + persistentError + ' 请检查数据文件夹是否可写，然后重试。' : '';
  }

  function setState(next) {
    state = next;
    persistentError = null;
    updateBanners();
    render();
  }

  function switchPage(next) {
    page = next;
    if (next === 'record') ensureDraft();
    for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('is-active', button.dataset.page === page);
    render();
  }

  function render() {
    if (!state || state.needsDataDirectory) {
      setup.classList.remove('is-hidden');
      document.querySelector('.app-shell').setAttribute('aria-hidden', 'true');
      return;
    }
    setup.classList.add('is-hidden');
    document.querySelector('.app-shell').removeAttribute('aria-hidden');
    const meta = pageMeta[page];
    kicker.textContent = meta[0];
    title.textContent = meta[1];
    for (const button of document.querySelectorAll('.nav-item')) button.classList.toggle('is-active', button.dataset.page === page);
    if (page === 'overview') content.innerHTML = overviewView();
    if (page === 'record') content.innerHTML = recordView();
    if (page === 'history') content.innerHTML = historyView();
    if (page === 'analysis') content.innerHTML = analysisView();
    if (page === 'manage') content.innerHTML = manageView();
    if (page === 'data') content.innerHTML = dataView();
  }

  function overviewView() {
    const current = currentRow();
    if (!current) {
      return '<section class="empty-state"><img src="../assets/icons/rj.png" alt="窝头RJ"><div><h2>还没有记录哦</h2><p>先记下现在每个平台里的金额。以后只要改变化的数字，存钱罐会帮你保留每一次的本地快照。</p><button class="primary-button" data-page="record">开始记一笔</button></div></section>';
    }
    const previous = previousRow();
    const changeText = previous ? (current.change >= 0 ? '+' : '') + money(current.change) + '（' + (current.rate === null ? '—' : (current.rate >= 0 ? '+' : '') + (current.rate * 100).toFixed(2) + '%') + '）' : '这是第一条记录';
    const changeClass = !previous ? 'neutral' : current.change >= 0 ? 'positive' : 'negative';
    const assetGroups = groupAmounts(current.snapshot, 'type');
    const platformGroups = groupAmounts(current.snapshot, 'platform').sort((a, b) => b.amount - a.amount);
    return '<section class="hero-card"><div><p class="hero-label">净资产</p><p class="big-number">' + money(current.current.net) + '</p><p class="net-detail">总资产 <b>' + money(current.current.assets) + '</b>　·　总负债 <b>' + money(current.current.debts) + '</b></p><div class="compare-line"><b class="' + changeClass + '">' + changeText + '</b><span>·</span><span>记录于 ' + esc(current.snapshot.date) + '</span></div></div><div class="rj-corner"><span>RJ 守护中</span><img src="../assets/icons/rj.png" alt="窝头RJ"></div></section><section class="summary-grid"><article class="card"><div class="card-heading"><h2>按资产类型</h2><button class="small-button" data-action="analysis-dimension" data-dimension="type">查看分析</button></div><div class="category-list">' + categoryRows(assetGroups, 'type') + '</div></article><article class="card"><div class="card-heading"><h2>按平台</h2><button class="small-button" data-action="analysis-dimension" data-dimension="platform">查看全部</button></div><div class="category-list">' + categoryRows(platformGroups.slice(0, 5), 'platform') + (platformGroups.length > 5 ? '<p class="category-meta">另有 ' + (platformGroups.length - 5) + ' 个平台可在分析页查看</p>' : '') + '</div></article></section>';
  }

  function categoryRows(groups, dimension) {
    if (!groups.length) return '<p class="category-meta">暂无可计入总资产的金额</p>';
    return groups.map((group) => '<button class="category-row" data-action="analysis-dimension" data-dimension="' + dimension + '"><i class="category-dot" style="background:' + esc(group.color) + '"></i><span class="category-name">' + esc(group.name) + '</span><b class="category-money">' + money(group.amount) + '</b></button>').join('');
  }

  function recordView() {
    ensureDraft();
    const platforms = ordered(state.data.platforms);
    const products = activeProducts();
    const latest = currentRow()?.snapshot;
    const blocks = platforms.map((platform, index) => {
      const entries = ordered(products.filter((product) => product.platformId === platform.id));
      if (!entries.length) return '';
      const subtotal = entries.reduce((sum, product) => sum + Number(recordDraft.values[product.id] || 0), 0);
      const lines = entries.map((product) => {
        const type = byId(state.data.assetTypes).get(product.assetTypeId);
        const old = Number(latest?.values?.[product.id] ?? 0);
        return '<div class="product-input-row"><div class="product-input-name">' + esc(product.name) + '<small>' + esc(type?.name || '未分类') + (product.includeInTotal === false ? ' · 不计入总资产' : '') + '</small></div><div class="previous-money">上次 ' + money(old) + '</div><input class="money-input" data-product-id="' + esc(product.id) + '" inputmode="decimal" type="number" step="0.01" value="' + esc(recordDraft.values[product.id]) + '" aria-label="' + esc(product.name) + '金额"></div>';
      }).join('');
      return '<details class="platform-block" ' + (index === 0 ? 'open' : '') + '><summary><span class="platform-name">' + esc(platform.name) + '</span><span class="platform-subtotal">小计 <b data-subtotal="' + esc(platform.id) + '">' + money(subtotal) + '</b></span></summary>' + lines + '</details>';
    }).join('');
    const latestText = latest ? '较上次（' + latest.date + '）' : '第一条记录';
    return '<section class="record-layout"><div class="record-toolbar"><div><h2>把今天的数字存起来</h2><p class="category-meta">输入框会自动带入上一次金额，只需修改有变化的项目。</p></div><div class="record-actions"><button class="quiet-button" data-action="record-carry">全部沿用上次</button><button class="quiet-button" data-action="record-toggle">折叠 / 展开</button></div></div><div class="date-control">记录日期 <input id="record-date" type="date" value="' + esc(recordDraft.date) + '"></div><div id="record-blocks">' + (blocks || '<div class="record-empty">还没有可记录的产品。请先到“管理”添加平台和产品。</div>') + '</div><label class="field"><span>备注（选填）</span><textarea id="record-note" class="record-note" maxlength="120" placeholder="例如：发工资、还信用卡、基金调仓">' + esc(recordDraft.note) + '</textarea></label><div class="record-bottom"><div class="record-total"><small>本次合计（净资产）</small><b id="record-total">' + money(draftTotals().net) + '</b><small id="record-compare">' + esc(latestText) + ' ' + draftCompareText() + '</small></div><button class="primary-button" data-action="save-snapshot">保存本次记录</button></div></section>';
  }

  function draftTotals() {
    return totals({ values: recordDraft?.values || {} });
  }

  function draftCompareText() {
    const previous = currentRow();
    if (!previous) return '—';
    const change = draftTotals().net - previous.current.net;
    const rate = previous.current.net ? change / Math.abs(previous.current.net) : null;
    return (change >= 0 ? '+' : '') + money(change) + (rate === null ? '' : '（' + (rate >= 0 ? '+' : '') + (rate * 100).toFixed(2) + '%）');
  }

  function historyView() {
    const allRows = [...rows()].reverse();
    const trend = allRows.length > 1 ? trendView([...rows()]) : '';
    const tableRows = allRows.map((row) => {
      const expanded = expandedHistory.has(row.snapshot.id);
      const change = row.change === null ? '—' : (row.change >= 0 ? '+' : '') + money(row.change);
      const detail = expanded ? historyDetail(row) : '';
      return '<tr><td><b>' + esc(row.snapshot.date) + '</b></td><td class="money">' + money(row.current.net) + '</td><td class="' + (row.change === null ? 'neutral' : row.change >= 0 ? 'positive' : 'negative') + '">' + change + '</td><td class="' + (row.rate === null ? 'neutral' : row.rate >= 0 ? 'positive' : 'negative') + '">' + (row.rate === null ? '—' : (row.rate >= 0 ? '+' : '') + (row.rate * 100).toFixed(2) + '%') + '</td><td>' + esc(row.snapshot.note || '—') + '</td><td><div class="row-actions"><button class="small-button" data-action="history-expand" data-id="' + esc(row.snapshot.id) + '">' + (expanded ? '收起' : '展开') + '</button><button class="small-button danger" data-action="delete-snapshot" data-id="' + esc(row.snapshot.id) + '">删除</button></div></td></tr>' + detail;
    }).join('');
    return '<section>' + trend + '<div class="table-toolbar"><div><h2>历史快照</h2><p class="category-meta">按日期倒序；展开后可查看当时每个产品的金额。</p></div></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>日期</th><th>净资产</th><th>较上次变化</th><th>变化率</th><th>备注</th><th>操作</th></tr></thead><tbody>' + (tableRows || '<tr><td colspan="6" class="record-empty">还没有历史记录</td></tr>') + '</tbody></table></div></section>';
  }

  function trendView(chronologicalRows) {
    const values = chronologicalRows.map((row) => row.current.net);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const spread = high - low || 1;
    const coordinates = chronologicalRows.map((row, index) => {
      const x = chronologicalRows.length === 1 ? 10 : 10 + index * (600 / (chronologicalRows.length - 1));
      const y = 132 - ((row.current.net - low) / spread) * 105;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<article class="card trend-card"><div class="card-heading"><h2>净资产趋势</h2><small>' + esc(chronologicalRows[0].snapshot.date) + ' → ' + esc(chronologicalRows.at(-1).snapshot.date) + '</small></div><svg class="trend-svg" viewBox="0 0 620 150" preserveAspectRatio="none" aria-label="净资产趋势图"><line x1="10" y1="132" x2="610" y2="132" stroke="#eee2e8" stroke-width="1"></line><polyline points="' + coordinates + '" fill="none" stroke="#ed779d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>' + chronologicalRows.map((row, index) => { const point = coordinates.split(' ')[index].split(','); return '<circle cx="' + point[0] + '" cy="' + point[1] + '" r="4" fill="#fff" stroke="#ed779d" stroke-width="2"></circle>'; }).join('') + '</svg><div class="trend-labels"><span>' + esc(chronologicalRows[0].snapshot.date) + '</span><span>' + esc(chronologicalRows.at(-1).snapshot.date) + '</span></div></article>';
  }

  function historyDetail(row) {
    const chronological = orderedSnapshots();
    const index = chronological.findIndex((snapshot) => snapshot.id === row.snapshot.id);
    const prior = index > 0 ? chronological[index - 1] : null;
    const platforms = byId(state.data.platforms);
    const types = byId(state.data.assetTypes);
    const productCards = Object.entries(row.snapshot.values).map(([productId, amount]) => {
      const product = byId(state.data.products).get(productId);
      if (!product) return '';
      const change = Number(amount) - Number(prior?.values?.[productId] ?? 0);
      return '<div class="detail-product"><b>' + esc(product.name) + '</b><small>' + esc(platforms.get(product.platformId)?.name || '未知平台') + ' · ' + esc(types.get(product.assetTypeId)?.name || '未知类型') + '</small><small>' + money(amount) + '　<span class="' + (change >= 0 ? 'positive' : 'negative') + '">' + (change >= 0 ? '+' : '') + money(change) + '</span></small></div>';
    }).join('');
    return '<tr class="history-detail"><td colspan="6"><div class="history-detail-inner"><div class="detail-grid">' + (productCards || '<p class="category-meta">这条记录没有产品金额。</p>') + '</div></div></td></tr>';
  }

  function analysisView() {
    const current = currentRow();
    if (!current) return '<section class="empty-state"><img src="../assets/icons/rj.png" alt=""><div><h2>记录一次后就能看分析</h2><p>分析只读，不会修改任何本地数据。</p><button class="primary-button" data-page="record">去记一笔</button></div></section>';
    const previous = previousRow();
    const dimension = analysisDimension === 'liquidity' ? 'type' : analysisDimension;
    let groups = groupAmounts(current.snapshot, dimension);
    if (analysisDimension === 'liquidity') groups = groups.filter((item) => item.role !== 'debt');
    const total = groups.reduce((sum, item) => sum + item.amount, 0) || 1;
    const previousGroups = previous ? groupAmounts(previous.snapshot, dimension) : [];
    const previousMap = new Map(previousGroups.map((item) => [item.id, item.amount]));
    const list = groups.sort((a, b) => b.amount - a.amount).map((group) => {
      const old = previousMap.get(group.id) || 0;
      const oldTotal = previousGroups.filter((item) => analysisDimension !== 'liquidity' || item.role !== 'debt').reduce((sum, item) => sum + item.amount, 0) || 1;
      const share = group.amount / total;
      const shareChange = previous ? share - old / oldTotal : null;
      return '<div class="analysis-row"><div class="analysis-name">' + esc(group.name) + '</div><div class="bar"><i style="width:' + Math.max(1, share * 100) + '%;background:' + esc(group.color) + '"></i></div><div class="analysis-value">' + money(group.amount) + ' <small class="category-meta">' + (share * 100).toFixed(1) + '%</small></div><div class="analysis-change ' + (shareChange === null ? 'neutral' : shareChange >= 0 ? 'positive' : 'negative') + '">' + (shareChange === null ? '无上次对比' : (shareChange >= 0 ? '+' : '') + (shareChange * 100).toFixed(1) + 'pp') + '</div></div>';
    }).join('');
    return '<section><div class="tabs"><button class="tab-button ' + (analysisDimension === 'platform' ? 'is-active' : '') + '" data-action="analysis-dimension" data-dimension="platform">按平台看</button><button class="tab-button ' + (analysisDimension === 'type' ? 'is-active' : '') + '" data-action="analysis-dimension" data-dimension="type">按资产类型看</button><button class="tab-button ' + (analysisDimension === 'liquidity' ? 'is-active' : '') + '" data-action="analysis-dimension" data-dimension="liquidity">按流动性看</button></div><article class="card"><div class="card-heading"><h2>' + (analysisDimension === 'platform' ? '平台分布' : analysisDimension === 'type' ? '资产类型分布' : '流动性分布（负债单列于资产类型）') + '</h2><small>占比与上次记录对比</small></div><div class="analysis-list">' + (list || '<p class="category-meta">暂无可分析金额</p>') + '</div></article></section>';
  }

  function manageView() {
    const types = ordered(state.data.assetTypes);
    const platforms = ordered(state.data.platforms);
    const products = ordered(state.data.products);
    const typeRows = types.map((item) => manageTypeRow(item)).join('');
    const platformRows = platforms.map((item) => managePlatformRow(item)).join('');
    const productRows = products.map((item) => manageProductRow(item)).join('');
    return '<section class="manage-sections"><article class="card"><div class="card-heading"><div><h2>平台</h2><small>用于分组记录，例如支付宝、微信、银行卡。</small></div><button class="small-button" data-action="add-platform">新增平台</button></div><div class="manage-list">' + (platformRows || '<p class="category-meta">还没有平台</p>') + '</div></article><article class="card"><div class="card-heading"><div><h2>产品</h2><small>会一直保留在记录中，确保历史金额始终完整。</small></div><button class="small-button" data-action="add-product">新增产品</button></div><div class="manage-list">' + (productRows || '<p class="category-meta">先新增平台，再添加产品</p>') + '</div></article><article class="card manage-section types-section"><div class="card-heading"><div><h2>资产类型</h2><small>颜色和名称可改；被产品使用的类型不能删除，以保护历史记录。</small></div><button class="small-button" data-action="add-type">新增类型</button></div><div class="manage-list">' + typeRows + '</div></article></section>';
  }

  function manageButtons(kind, id) {
    return '<div class="manage-buttons"><button class="icon-button" title="上移" data-action="move" data-collection="' + kind + '" data-id="' + esc(id) + '" data-direction="up">↑</button><button class="icon-button" title="下移" data-action="move" data-collection="' + kind + '" data-id="' + esc(id) + '" data-direction="down">↓</button><button class="small-button" data-action="edit-' + kind.slice(0, -1) + '" data-id="' + esc(id) + '">编辑</button></div>';
  }

  function managePlatformRow(item) {
    const productCount = state.data.products.filter((product) => product.platformId === item.id).length;
    return '<div class="manage-row"><div><h3>' + esc(item.name) + '</h3><p>' + esc(item.notes || (productCount + ' 个产品')) + '</p></div><div class="manage-buttons"><button class="small-button" data-action="add-product" data-platform-id="' + esc(item.id) + '">加产品</button>' + manageButtons('platforms', item.id) + '</div></div>';
  }

  function manageProductRow(item) {
    const platform = byId(state.data.platforms).get(item.platformId);
    const type = byId(state.data.assetTypes).get(item.assetTypeId);
    return '<div class="manage-row"><div><h3>' + esc(item.name) + '</h3><p>' + esc(platform?.name || '未知平台') + ' · ' + esc(type?.name || '未知类型') + (item.includeInTotal ? '' : ' · 不计入总资产') + '</p></div>' + manageButtons('products', item.id) + '</div>';
  }

  function manageTypeRow(item) {
    const used = state.data.products.some((product) => product.assetTypeId === item.id);
    const buttons = used
      ? manageButtons('assetTypes', item.id)
      : '<div class="manage-buttons"><button class="icon-button" title="上移" data-action="move" data-collection="assetTypes" data-id="' + esc(item.id) + '" data-direction="up">↑</button><button class="icon-button" title="下移" data-action="move" data-collection="assetTypes" data-id="' + esc(item.id) + '" data-direction="down">↓</button><button class="small-button" data-action="edit-assetType" data-id="' + esc(item.id) + '">编辑</button><button class="small-button danger" data-action="delete-assetType" data-id="' + esc(item.id) + '">删除</button></div>';
    return '<div class="manage-row"><div><h3><i class="type-chip" style="background:' + esc(item.color) + '"></i>' + esc(item.name) + '</h3><p>' + (item.role === 'debt' ? '负债类型' : '资产类型') + '</p></div>' + buttons + '</div>';
  }

  function dataView() {
    const meta = state.data.metadata;
    return '<section><div class="data-path-card"><div><h2>数据文件夹</h2><p class="data-path">' + esc(state.dataDirectory) + '</p><p class="category-meta">主文件：' + esc(state.fileName) + '　·　备份会保留在“备份”子文件夹</p></div><button class="quiet-button" data-action="choose-directory">更换文件夹</button></div><div class="data-meta"><div><small>上次保存时间</small><b>' + esc(dateTime(meta.lastSavedAt)) + '</b></div><div><small>自动备份数量</small><b>' + state.backupCount + ' / 30 份</b></div><div><small>上次导出时间</small><b>' + esc(dateTime(meta.lastExportAt)) + '</b></div></div><div class="export-grid"><article class="export-option"><h3>导出 JSON</h3><p>完整数据，适合换电脑、恢复和长期留存。</p><button class="quiet-button" data-action="export-json">导出完整备份</button></article><article class="export-option"><h3>导出近一年 CSV</h3><p>仅导出过去 365 天的全部记录，Excel 可直接打开。</p><button class="quiet-button" data-action="export-recent-year-csv">导出近一年 CSV</button></article><article class="export-option"><h3>导出近一年 PDF</h3><p>过去 365 天的可打印资产记录报表。</p><button class="quiet-button" data-action="export-recent-year-pdf">导出近一年 PDF</button></article><article class="export-option"><h3>导入恢复</h3><p>先预览 JSON 中的记录数量与最新净资产，再确认覆盖。</p><button class="quiet-button" data-action="preview-import">选择 JSON 文件</button></article></div><article class="card danger-zone"><div class="card-heading"><div><h2>清空所有数据</h2><small>清空前会强制生成一份自动备份；此操作仅清空当前数据文件夹里的主数据。</small></div><button class="danger-button" data-action="open-clear">清空所有数据</button></div></article></section>';
  }

  function showModal(body) {
    modalRoot.innerHTML = body;
    modalRoot.classList.remove('is-hidden');
    const first = modalRoot.querySelector('input, select, textarea, button');
    first?.focus();
  }

  function closeModal() {
    modalConfirm = null;
    modalRoot.classList.add('is-hidden');
    modalRoot.innerHTML = '';
  }

  function confirmModal({ title: modalTitle, text, confirmText, dangerous = false, onConfirm }) {
    modalConfirm = onConfirm;
    showModal('<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>' + esc(modalTitle) + '</h2><p>' + esc(text) + '</p></div><button class="icon-button" data-modal-close>×</button></div><div class="modal-actions"><button class="quiet-button" data-modal-close>取消</button><button class="' + (dangerous ? 'danger-button' : 'primary-button') + '" data-action="modal-confirm">' + esc(confirmText) + '</button></div></section>');
  }

  function platformForm(item = {}) {
    showModal('<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>' + (item.id ? '编辑平台' : '新增平台') + '</h2><p>平台用于把产品分组，所有内容都会持续保留，确保记录完整。</p></div><button class="icon-button" data-modal-close>×</button></div><form data-form="platform" class="form-grid"><input type="hidden" name="id" value="' + esc(item.id || '') + '"><div class="field"><label>名称 *</label><input name="name" maxlength="120" required value="' + esc(item.name || '') + '" placeholder="例如：支付宝"></div><div class="field"><label>备注</label><textarea name="notes" maxlength="120" placeholder="可选">' + esc(item.notes || '') + '</textarea></div><div class="modal-actions"><button type="button" class="quiet-button" data-modal-close>取消</button><button class="primary-button" type="submit">保存</button></div></form></section>');
  }

  function productForm(item = {}, preferredPlatformId = '') {
    const platforms = ordered(state.data.platforms);
    const types = ordered(state.data.assetTypes);
    if (!platforms.length || !types.length) return toast('请先准备至少一个可用平台和资产类型。', true);
    const options = (items, selected) => items.map((entry) => '<option value="' + esc(entry.id) + '" ' + ((entry.id === selected) ? 'selected' : '') + '>' + esc(entry.name) + '</option>').join('');
    showModal('<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>' + (item.id ? '编辑产品' : '新增产品') + '</h2><p>产品同时属于一个平台和一个资产类型。</p></div><button class="icon-button" data-modal-close>×</button></div><form data-form="product" class="form-grid"><input type="hidden" name="id" value="' + esc(item.id || '') + '"><div class="field"><label>名称 *</label><input name="name" maxlength="120" required value="' + esc(item.name || '') + '" placeholder="例如：余额宝"></div><div class="field"><label>所属平台 *</label><select name="platformId">' + options(platforms, item.platformId || preferredPlatformId || platforms[0].id) + '</select></div><div class="field"><label>资产类型 *</label><select name="assetTypeId">' + options(types, item.assetTypeId || types[0].id) + '</select></div><label class="checkbox-field"><input name="includeInTotal" type="checkbox" ' + (item.includeInTotal !== false ? 'checked' : '') + '> 计入总资产</label><div class="field"><label>备注</label><textarea name="notes" maxlength="120" placeholder="可选">' + esc(item.notes || '') + '</textarea></div><div class="modal-actions"><button type="button" class="quiet-button" data-modal-close>取消</button><button class="primary-button" type="submit">保存</button></div></form></section>');
  }

  function typeForm(item = {}) {
    showModal('<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>' + (item.id ? '编辑资产类型' : '新增资产类型') + '</h2><p>新增类型默认作为资产类型；预置“负债”可直接改名和颜色。</p></div><button class="icon-button" data-modal-close>×</button></div><form data-form="type" class="form-grid"><input type="hidden" name="id" value="' + esc(item.id || '') + '"><div class="field"><label>名称 *</label><input name="name" maxlength="120" required value="' + esc(item.name || '') + '"></div><div class="field"><label>颜色</label><input name="color" type="color" value="' + esc(item.color || '#7a8191') + '"></div><div class="modal-actions"><button type="button" class="quiet-button" data-modal-close>取消</button><button class="primary-button" type="submit">保存</button></div></form></section>');
  }

  function clearForm() {
    showModal('<section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>确认清空所有数据</h2><p>主数据会被清空，但清空前会自动备份到当前数据文件夹。</p></div><button class="icon-button" data-modal-close>×</button></div><form data-form="clear"><p class="modal-danger">这是不可逆的界面操作。若要继续，请输入“确认清空”。</p><div class="field"><label>确认文字</label><input name="phrase" autocomplete="off" placeholder="确认清空"></div><div class="modal-actions"><button type="button" class="quiet-button" data-modal-close>取消</button><button class="danger-button" type="submit">清空数据</button></div></form></section>');
  }

  async function saveRecord(overwrite = false) {
    const result = await api.saveSnapshot({ date: recordDraft.date, note: recordDraft.note, values: recordDraft.values, overwrite });
    if (result.needsOverwriteConfirmation) {
      confirmModal({ title: '覆盖同一天的记录？', text: '该日期已有一条快照。覆盖后会先自动保留备份。', confirmText: '覆盖并保存', dangerous: true, onConfirm: () => saveRecord(true) });
      return;
    }
    recordDraft = null;
    setState(result);
    page = 'history';
    render();
    toast('已保存，并已生成自动备份：' + result.backupName);
  }

  async function runAction(action, target) {
    const id = target.dataset.id;
    if (action === 'analysis-dimension') { analysisDimension = target.dataset.dimension; page = 'analysis'; render(); return; }
    if (action === 'record-carry') { resetDraftToPrevious(); return; }
    if (action === 'record-toggle') {
      const blocks = [...document.querySelectorAll('.platform-block')];
      const shouldOpen = blocks.some((block) => !block.open);
      blocks.forEach((block) => { block.open = shouldOpen; });
      return;
    }
    if (action === 'save-snapshot') { await saveRecord(); return; }
    if (action === 'history-expand') { expandedHistory.has(id) ? expandedHistory.delete(id) : expandedHistory.add(id); render(); return; }
    if (action === 'delete-snapshot') {
      confirmModal({ title: '删除这条历史记录？', text: '删除前会生成自动备份，删除后仍可从备份 JSON 恢复。', confirmText: '删除记录', dangerous: true, onConfirm: async () => { const result = await api.deleteSnapshot(id); setState(result); toast('已删除，并已自动备份。'); } });
      return;
    }
    if (action === 'add-platform') { platformForm(); return; }
    if (action === 'edit-platform') { platformForm(byId(state.data.platforms).get(id)); return; }
    if (action === 'add-product') { productForm({}, target.dataset.platformId); return; }
    if (action === 'edit-product') { productForm(byId(state.data.products).get(id)); return; }
    if (action === 'add-type') { typeForm(); return; }
    if (action === 'edit-assetType') { typeForm(byId(state.data.assetTypes).get(id)); return; }
    if (action === 'delete-assetType') {
      confirmModal({ title: '删除这个资产类型？', text: '它未被任何产品使用，删除不会影响历史金额。', confirmText: '删除类型', dangerous: true, onConfirm: async () => { setState(await api.deleteType(id)); toast('资产类型已删除。'); } });
      return;
    }
    if (action === 'move') { setState(await api.move(target.dataset.collection, id, target.dataset.direction)); return; }
    if (action === 'choose-directory') { const result = await api.chooseDirectory(); if (!result.cancelled) { setState(result); toast(result.migrated ? '数据已复制到新文件夹，旧文件夹保留原始数据以确保安全。' : '已使用所选数据文件夹。'); } return; }
    if (action === 'export-json' || action === 'export-recent-year-csv' || action === 'export-recent-year-pdf') {
      const method = action === 'export-json' ? api.exportJson : action === 'export-recent-year-csv' ? api.exportRecentYearCsv : api.exportRecentYearPdf;
      const result = await method();
      if (!result.cancelled) { setState(result.state); toast('已导出到：' + result.filePath); }
      return;
    }
    if (action === 'preview-import') {
      const result = await api.previewImport();
      if (!result.cancelled) {
        const summary = result.summary;
        confirmModal({ title: '确认导入恢复？', text: '文件包含 ' + summary.snapshots + ' 条记录、' + summary.platforms + ' 个平台、' + summary.products + ' 个产品；最新净资产 ' + money(summary.latestNet) + '。确认后会覆盖当前数据，覆盖前会自动备份。', confirmText: '确认覆盖恢复', dangerous: true, onConfirm: async () => { const next = await api.commitImport(result.token); recordDraft = null; setState(next); toast('已恢复导入数据，原数据已自动备份。'); } });
      }
      return;
    }
    if (action === 'open-clear') { clearForm(); return; }
    if (action === 'modal-confirm') { const handler = modalConfirm; closeModal(); if (handler) await handler(); return; }
  }

  document.addEventListener('click', async (event) => {
    const pageButton = event.target.closest('[data-page]');
    const actionButton = event.target.closest('[data-action]');
    const closeButton = event.target.closest('[data-modal-close]');
    if (closeButton) { closeModal(); return; }
    if (pageButton) { switchPage(pageButton.dataset.page); return; }
    if (!actionButton) return;
    try { await runAction(actionButton.dataset.action, actionButton); }
    catch (error) { toast(error.message || '操作失败，请检查数据文件夹是否可写。', true); }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('.money-input')) {
      const productId = event.target.dataset.productId;
      recordDraft.values[productId] = event.target.value === '' ? 0 : Number(event.target.value);
      const product = byId(state.data.products).get(productId);
      const subtotal = activeProducts().filter((entry) => entry.platformId === product.platformId).reduce((sum, entry) => sum + Number(recordDraft.values[entry.id] || 0), 0);
      const subtotalNode = document.querySelector('[data-subtotal="' + CSS.escape(product.platformId) + '"]');
      if (subtotalNode) subtotalNode.textContent = money(subtotal);
      document.querySelector('#record-total').textContent = money(draftTotals().net);
      document.querySelector('#record-compare').textContent = (currentRow() ? '较上次（' + currentRow().snapshot.date + '） ' : '第一条记录 ') + draftCompareText();
    }
    if (event.target.id === 'record-date') recordDraft.date = event.target.value;
    if (event.target.id === 'record-note') recordDraft.note = event.target.value;
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!form.dataset.form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      if (form.dataset.form === 'platform') { setState(await api.savePlatform(values)); closeModal(); toast('平台已保存。'); }
      if (form.dataset.form === 'product') { values.includeInTotal = form.elements.includeInTotal.checked; setState(await api.saveProduct(values)); closeModal(); toast('产品已保存。'); }
      if (form.dataset.form === 'type') { setState(await api.saveType(values)); closeModal(); toast('资产类型已保存。'); }
      if (form.dataset.form === 'clear') { const result = await api.clearAll(values.phrase); recordDraft = null; closeModal(); page = 'overview'; setState(result); toast('已清空主数据；清空前的备份仍在数据文件夹中。'); }
    } catch (error) {
      toast(error.message || '保存失败，请检查数据文件夹。', true);
    }
  });

  document.querySelector('#choose-data-folder').addEventListener('click', async () => {
    try {
      const result = await api.chooseDirectory();
      if (!result.cancelled) { setState(result); toast(result.migrated ? '数据已迁移到新文件夹。' : '数据文件夹已准备好。'); }
    } catch (error) {
      toast(error.message || '无法使用这个文件夹。', true);
    }
  });

  document.querySelector('#quick-export').addEventListener('click', async () => {
    try {
      const result = await api.exportJson();
      if (!result.cancelled) { setState(result.state); toast('已导出完整 JSON：' + result.filePath); }
    } catch (error) { toast(error.message || '导出失败。', true); }
  });

  api.getState().then(setState).catch((error) => toast(error.message || '应用初始化失败。', true));
})();
