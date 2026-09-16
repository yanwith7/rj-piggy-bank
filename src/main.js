const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_FILE_NAME = '窝头RJの存钱罐.json';
const BACKUP_DIR_NAME = '备份';
const LOCATION_FILE = 'data-location.json';
const MAX_BACKUPS = 30;
let mainWindow = null;
let dataDirectory = null;
let data = null;
let recoveryNotice = null;
const importSessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function localStamp(date = new Date()) {
  const part = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + part(date.getMonth() + 1) + '-' + part(date.getDate()) + '_' + part(date.getHours()) + part(date.getMinutes()) + part(date.getSeconds());
}

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID();
}

function defaultData() {
  const createdAt = nowIso();
  return {
    schemaVersion: 1,
    metadata: { createdAt, updatedAt: createdAt, lastSavedAt: createdAt, lastExportAt: null },
    assetTypes: [
      { id: 'type-cash', name: '活钱', color: '#43a66b', role: 'asset', sort: 10, archived: false },
      { id: 'type-stable', name: '稳健', color: '#4d84d9', role: 'asset', sort: 20, archived: false },
      { id: 'type-fund', name: '基金投资', color: '#e89a3b', role: 'asset', sort: 30, archived: false },
      { id: 'type-risk', name: '高风险', color: '#db6262', role: 'asset', sort: 40, archived: false },
      { id: 'type-debt', name: '负债', color: '#7a8191', role: 'debt', sort: 50, archived: false }
    ],
    platforms: [],
    products: [],
    snapshots: []
  };
}

function safeText(value, field, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(field + '不能为空');
  if (text.length > 120) throw new Error(field + '过长');
  return text;
}

function finiteMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1000000000000) throw new Error('金额格式不正确');
  return Math.round(number * 100) / 100;
}

function normalizeData(input) {
  if (!input || typeof input !== 'object') throw new Error('不是有效的数据文件');
  const source = input;
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const normalized = {
    schemaVersion: 1,
    metadata: {
      createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : nowIso(),
      updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : nowIso(),
      lastSavedAt: typeof metadata.lastSavedAt === 'string' ? metadata.lastSavedAt : null,
      lastExportAt: typeof metadata.lastExportAt === 'string' ? metadata.lastExportAt : null
    },
    assetTypes: [],
    platforms: [],
    products: [],
    snapshots: []
  };
  const ids = new Set();
  const ensureUnique = (id, label) => {
    if (!id || ids.has(id)) throw new Error(label + ' ID 重复或缺失');
    ids.add(id);
  };
  if (!Array.isArray(source.assetTypes) || !Array.isArray(source.platforms) || !Array.isArray(source.products) || !Array.isArray(source.snapshots)) {
    throw new Error('数据文件结构不完整');
  }
  for (const item of source.assetTypes) {
    const id = safeText(item.id, '资产类型 ID', true);
    ensureUnique('type:' + id, '资产类型');
    normalized.assetTypes.push({
      id,
      name: safeText(item.name, '资产类型名称', true),
      color: /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : '#7a8191',
      role: item.role === 'debt' ? 'debt' : 'asset',
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : normalized.assetTypes.length * 10,
      archived: Boolean(item.archived)
    });
  }
  for (const item of source.platforms) {
    const id = safeText(item.id, '平台 ID', true);
    ensureUnique('platform:' + id, '平台');
    normalized.platforms.push({
      id,
      name: safeText(item.name, '平台名称', true),
      notes: safeText(item.notes, '平台备注'),
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : normalized.platforms.length * 10,
      archived: Boolean(item.archived),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso()
    });
  }
  const platformIds = new Set(normalized.platforms.map((item) => item.id));
  const typeIds = new Set(normalized.assetTypes.map((item) => item.id));
  for (const item of source.products) {
    const id = safeText(item.id, '产品 ID', true);
    ensureUnique('product:' + id, '产品');
    if (!platformIds.has(item.platformId) || !typeIds.has(item.assetTypeId)) throw new Error('产品关联的平台或资产类型不存在');
    normalized.products.push({
      id,
      name: safeText(item.name, '产品名称', true),
      platformId: item.platformId,
      assetTypeId: item.assetTypeId,
      includeInTotal: item.includeInTotal !== false,
      notes: safeText(item.notes, '产品备注'),
      sort: Number.isFinite(Number(item.sort)) ? Number(item.sort) : normalized.products.length * 10,
      archived: Boolean(item.archived),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso()
    });
  }
  const productIds = new Set(normalized.products.map((item) => item.id));
  const dates = new Set();
  for (const item of source.snapshots) {
    const date = safeText(item.date, '快照日期', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dates.has(date)) throw new Error('快照日期无效或重复');
    dates.add(date);
    const values = {};
    if (!item.values || typeof item.values !== 'object') throw new Error('快照金额缺失');
    for (const [productId, amount] of Object.entries(item.values)) {
      if (!productIds.has(productId)) throw new Error('快照包含不存在的产品');
      values[productId] = finiteMoney(amount);
    }
    normalized.snapshots.push({
      id: safeText(item.id, '快照 ID', true),
      date,
      note: safeText(item.note, '快照备注'),
      values,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso()
    });
  }
  return normalized;
}

function locationFile() {
  return path.join(app.getPath('userData'), LOCATION_FILE);
}

function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, '.' + path.basename(filePath) + '.' + process.pid + '.' + Date.now() + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, filePath);
    try {
      const directoryDescriptor = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryDescriptor);
      fs.closeSync(directoryDescriptor);
    } catch (_) {
      // Some Windows filesystems do not allow fsync on directories.
    }
  } catch (error) {
    if (descriptor !== null && descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw error;
  }
}

function readLocation() {
  try {
    const parsed = JSON.parse(fs.readFileSync(locationFile(), 'utf8'));
    return typeof parsed.dataDirectory === 'string' ? parsed.dataDirectory : null;
  } catch (_) {
    return null;
  }
}

function saveLocation(directory) {
  atomicWrite(locationFile(), JSON.stringify({ dataDirectory: directory }, null, 2));
}

function dataFile(directory = dataDirectory) {
  return path.join(directory, DATA_FILE_NAME);
}

function backupDirectory(directory = dataDirectory) {
  return path.join(directory, BACKUP_DIR_NAME);
}

function listBackups(directory = dataDirectory) {
  try {
    return fs.readdirSync(backupDirectory(directory), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const file = path.join(backupDirectory(directory), entry.name);
        return { file, name: entry.name, mtime: fs.statSync(file).mtimeMs };
      })
      .sort((left, right) => right.mtime - left.mtime);
  } catch (_) {
    return [];
  }
}

function writeBackup(payload = data, directory = dataDirectory) {
  const destinationDirectory = backupDirectory(directory);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const base = localStamp();
  let name = base + '.json';
  let sequence = 2;
  while (fs.existsSync(path.join(destinationDirectory, name))) {
    name = base + '_' + sequence + '.json';
    sequence += 1;
  }
  atomicWrite(path.join(destinationDirectory, name), JSON.stringify(payload, null, 2));
  const backups = listBackups(directory);
  for (const item of backups.slice(MAX_BACKUPS)) fs.unlinkSync(item.file);
  return name;
}

function loadFromDirectory(directory) {
  const primary = dataFile(directory);
  if (!fs.existsSync(primary)) {
    dataDirectory = directory;
    data = defaultData();
    persist({ backup: false });
    return { created: true, recovered: null };
  }
  try {
    data = normalizeData(JSON.parse(fs.readFileSync(primary, 'utf8')));
    dataDirectory = directory;
    return { created: false, recovered: null };
  } catch (primaryError) {
    const backups = listBackups(directory);
    for (const backup of backups) {
      try {
        const recovered = normalizeData(JSON.parse(fs.readFileSync(backup.file, 'utf8')));
        dataDirectory = directory;
        data = recovered;
        atomicWrite(dataFile(), JSON.stringify(data, null, 2));
        return { created: false, recovered: backup.name };
      } catch (_) {
        // Try the next older backup.
      }
    }
    throw new Error('主数据文件无法读取，且没有可用备份：' + primaryError.message);
  }
}

function persist({ backup = false } = {}) {
  if (!dataDirectory || !data) throw new Error('尚未选择数据文件夹');
  const savedAt = nowIso();
  data.metadata.updatedAt = savedAt;
  data.metadata.lastSavedAt = savedAt;
  atomicWrite(dataFile(), JSON.stringify(data, null, 2));
  return backup ? writeBackup(data) : null;
}

function ensureReady() {
  if (!dataDirectory || !data) throw new Error('请先选择数据文件夹');
}

function sorted(items) {
  return [...items].sort((left, right) => Number(left.sort) - Number(right.sort) || left.name.localeCompare(right.name, 'zh-CN'));
}

function findById(items, id, label) {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(label + '不存在');
  return found;
}

function updateSort(items, id, direction) {
  const ordered = sorted(items);
  const position = ordered.findIndex((item) => item.id === id);
  const target = position + (direction === 'up' ? -1 : 1);
  if (position < 0 || target < 0 || target >= ordered.length) return;
  const first = ordered[position];
  const second = ordered[target];
  const previous = first.sort;
  first.sort = second.sort;
  second.sort = previous;
}

function computeSnapshot(snapshot) {
  const products = new Map(data.products.map((item) => [item.id, item]));
  const types = new Map(data.assetTypes.map((item) => [item.id, item]));
  let assets = 0;
  let debts = 0;
  for (const [productId, rawValue] of Object.entries(snapshot.values)) {
    const product = products.get(productId);
    if (!product || product.includeInTotal === false) continue;
    const value = Number(rawValue) || 0;
    const type = types.get(product.assetTypeId);
    if (type && type.role === 'debt') debts += Math.abs(value);
    else assets += Math.max(0, value);
  }
  return { assets, debts, net: assets - debts };
}

function chronologicalSnapshots() {
  return [...data.snapshots].sort((left, right) => left.date.localeCompare(right.date));
}

function snapshotRows() {
  const chronological = chronologicalSnapshots();
  return chronological.map((snapshot, index) => {
    const totals = computeSnapshot(snapshot);
    const previous = index ? computeSnapshot(chronological[index - 1]) : null;
    const change = previous ? totals.net - previous.net : null;
    return {
      ...snapshot,
      totals,
      change,
      changeRate: previous && previous.net !== 0 ? change / Math.abs(previous.net) : null
    };
  });
}

function overview() {
  const rows = snapshotRows();
  const current = rows.at(-1) || null;
  const previous = rows.length > 1 ? rows.at(-2) : null;
  return {
    current,
    previous,
    hasSnapshots: rows.length > 0,
    daysSinceCurrent: current ? Math.max(0, Math.floor((Date.now() - new Date(current.date + 'T00:00:00').getTime()) / 86400000)) : null
  };
}

function currentState() {
  const missingDirectory = !dataDirectory || !fs.existsSync(dataDirectory);
  return {
    needsDataDirectory: missingDirectory || !data,
    directoryProblem: missingDirectory && dataDirectory ? '原数据文件夹目前不可访问，请重新选择包含数据的文件夹。' : null,
    dataDirectory: dataDirectory || null,
    data: data || null,
    overview: data ? overview() : null,
    backupCount: dataDirectory ? listBackups().length : 0,
    recoveryNotice,
    fileName: DATA_FILE_NAME
  };
}

function activateDirectory(directory, { migrating = false } = {}) {
  if (!directory || !fs.existsSync(directory)) throw new Error('选择的文件夹不可访问');
  const targetFile = dataFile(directory);
  if (migrating && fs.existsSync(targetFile)) throw new Error('目标文件夹已包含存钱罐数据，为保护数据不会覆盖它。');
  if (migrating && dataDirectory && data) {
    fs.mkdirSync(directory, { recursive: true });
    const oldBackupDirectory = backupDirectory(dataDirectory);
    persist({ backup: false });
    atomicWrite(targetFile, JSON.stringify(data, null, 2));
    if (fs.existsSync(oldBackupDirectory)) fs.cpSync(oldBackupDirectory, backupDirectory(directory), { recursive: true, force: false, errorOnExist: true });
    dataDirectory = directory;
    saveLocation(directory);
    return { migrated: true, recovered: null };
  }
  const loaded = loadFromDirectory(directory);
  saveLocation(directory);
  return { migrated: false, recovered: loaded.recovered };
}

function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function reportHtml() {
  const rows = snapshotRows();
  const latest = rows.at(-1);
  const history = [...rows].reverse().map((row) => '<tr><td>' + escapeHtml(row.date) + '</td><td>¥' + formatMoney(row.totals.net) + '</td><td>' + (row.change === null ? '—' : (row.change >= 0 ? '+' : '') + '¥' + formatMoney(row.change)) + '</td><td>' + escapeHtml(row.note || '—') + '</td></tr>').join('');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>窝头RJの存钱罐报表</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#252436;padding:32px}h1{color:#ef6f92}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:9px;border-bottom:1px solid #e7dfe6;text-align:left}.card{padding:18px;border:1px solid #f2bfd0;border-radius:12px;background:#fff7fa}.number{font-size:30px;font-weight:800}</style><body><h1>窝头RJの存钱罐</h1><p>本地资产记录报表 · 导出于 ' + escapeHtml(new Date().toLocaleString('zh-CN')) + '</p><section class="card"><p>最新记录：' + escapeHtml(latest ? latest.date : '暂无') + '</p><div class="number">净资产 ¥' + formatMoney(latest ? latest.totals.net : 0) + '</div><p>总资产 ¥' + formatMoney(latest ? latest.totals.assets : 0) + '　总负债 ¥' + formatMoney(latest ? latest.totals.debts : 0) + '</p></section><h2>历史记录</h2><table><thead><tr><th>日期</th><th>净资产</th><th>较上次变化</th><th>备注</th></tr></thead><tbody>' + (history || '<tr><td colspan="4">暂无记录</td></tr>') + '</tbody></table></body></html>';
}

function registerIpc() {
  ipcMain.handle('data:get-state', () => currentState());
  ipcMain.handle('data:choose-directory', async () => {
    const response = await dialog.showOpenDialog(mainWindow, { title: '选择存钱罐数据文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (response.canceled || !response.filePaths[0]) return { cancelled: true };
    const directory = response.filePaths[0];
    const result = activateDirectory(directory, { migrating: Boolean(dataDirectory && data && directory !== dataDirectory) });
    recoveryNotice = result.recovered ? '已从备份 ' + result.recovered + ' 恢复主数据。' : null;
    return { ...currentState(), migrated: result.migrated };
  });
  ipcMain.handle('data:save-platform', (_event, payload) => {
    ensureReady();
    const name = safeText(payload.name, '平台名称', true);
    let item;
    if (payload.id) {
      item = findById(data.platforms, payload.id, '平台');
      item.name = name; item.notes = safeText(payload.notes, '平台备注'); item.updatedAt = nowIso();
    } else {
      item = { id: newId('platform'), name, notes: safeText(payload.notes, '平台备注'), sort: (Math.max(0, ...data.platforms.map((entry) => entry.sort)) + 10), archived: false, createdAt: nowIso(), updatedAt: nowIso() };
      data.platforms.push(item);
    }
    persist();
    return currentState();
  });
  ipcMain.handle('data:archive-platform', (_event, id, archived) => {
    ensureReady();
    const platform = findById(data.platforms, id, '平台');
    platform.archived = Boolean(archived); platform.updatedAt = nowIso();
    if (platform.archived) data.products.filter((product) => product.platformId === id).forEach((product) => { product.archived = true; product.updatedAt = nowIso(); });
    persist();
    return currentState();
  });
  ipcMain.handle('data:save-product', (_event, payload) => {
    ensureReady();
    const name = safeText(payload.name, '产品名称', true);
    const platform = findById(data.platforms, payload.platformId, '所属平台');
    const type = findById(data.assetTypes, payload.assetTypeId, '资产类型');
    if (platform.archived || type.archived) throw new Error('不能添加到已归档的平台或资产类型');
    let item;
    if (payload.id) {
      item = findById(data.products, payload.id, '产品');
      item.name = name; item.platformId = platform.id; item.assetTypeId = type.id; item.includeInTotal = payload.includeInTotal !== false; item.notes = safeText(payload.notes, '产品备注'); item.updatedAt = nowIso();
    } else {
      item = { id: newId('product'), name, platformId: platform.id, assetTypeId: type.id, includeInTotal: payload.includeInTotal !== false, notes: safeText(payload.notes, '产品备注'), sort: (Math.max(0, ...data.products.filter((entry) => entry.platformId === platform.id).map((entry) => entry.sort)) + 10), archived: false, createdAt: nowIso(), updatedAt: nowIso() };
      data.products.push(item);
    }
    persist();
    return currentState();
  });
  ipcMain.handle('data:archive-product', (_event, id, archived) => {
    ensureReady();
    const product = findById(data.products, id, '产品');
    if (!archived && findById(data.platforms, product.platformId, '所属平台').archived) throw new Error('请先恢复所属平台，再恢复产品。');
    product.archived = Boolean(archived); product.updatedAt = nowIso();
    persist();
    return currentState();
  });
  ipcMain.handle('data:save-type', (_event, payload) => {
    ensureReady();
    const name = safeText(payload.name, '资产类型名称', true);
    let item;
    if (payload.id) {
      item = findById(data.assetTypes, payload.id, '资产类型');
      item.name = name; item.color = /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : '#7a8191';
    } else {
      item = { id: newId('type'), name, color: /^#[0-9a-fA-F]{6}$/.test(payload.color) ? payload.color : '#7a8191', role: 'asset', sort: (Math.max(0, ...data.assetTypes.map((entry) => entry.sort)) + 10), archived: false };
      data.assetTypes.push(item);
    }
    persist();
    return currentState();
  });
  ipcMain.handle('data:archive-type', (_event, id, archived) => {
    ensureReady();
    const item = findById(data.assetTypes, id, '资产类型');
    if (item.role === 'debt' && archived) throw new Error('负债类型不能归档，请先将相关产品调整到其他类型。');
    if (archived && data.products.some((product) => product.assetTypeId === id && !product.archived)) throw new Error('请先归档或调整使用该类型的产品。');
    item.archived = Boolean(archived);
    persist();
    return currentState();
  });
  ipcMain.handle('data:delete-type', (_event, id) => {
    ensureReady();
    const item = findById(data.assetTypes, id, '资产类型');
    if (data.products.some((product) => product.assetTypeId === id)) throw new Error('该类型已经被产品使用。为保护历史记录，请使用归档而不是删除。');
    data.assetTypes = data.assetTypes.filter((entry) => entry.id !== item.id);
    persist();
    return currentState();
  });
  ipcMain.handle('data:move', (_event, collection, id, direction) => {
    ensureReady();
    const map = { platforms: data.platforms, products: data.products, assetTypes: data.assetTypes };
    if (!map[collection] || !['up', 'down'].includes(direction)) throw new Error('排序请求无效');
    updateSort(map[collection], id, direction);
    persist();
    return currentState();
  });
  ipcMain.handle('data:save-snapshot', (_event, payload) => {
    ensureReady();
    const date = safeText(payload.date, '日期', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不正确');
    const values = {};
    const known = new Set(data.products.map((product) => product.id));
    for (const [id, amount] of Object.entries(payload.values || {})) {
      if (known.has(id)) values[id] = finiteMoney(amount);
    }
    const existingIndex = data.snapshots.findIndex((snapshot) => snapshot.date === date);
    if (existingIndex >= 0 && !payload.overwrite) return { needsOverwriteConfirmation: true };
    const snapshot = { id: existingIndex >= 0 ? data.snapshots[existingIndex].id : newId('snapshot'), date, note: safeText(payload.note, '备注'), values, createdAt: existingIndex >= 0 ? data.snapshots[existingIndex].createdAt : nowIso(), updatedAt: nowIso() };
    if (existingIndex >= 0) data.snapshots.splice(existingIndex, 1, snapshot);
    else data.snapshots.push(snapshot);
    const backupName = persist({ backup: true });
    return { ...currentState(), saved: true, backupName };
  });
  ipcMain.handle('data:delete-snapshot', (_event, id) => {
    ensureReady();
    const index = data.snapshots.findIndex((snapshot) => snapshot.id === id);
    if (index < 0) throw new Error('记录不存在');
    data.snapshots.splice(index, 1);
    persist({ backup: true });
    return currentState();
  });
  ipcMain.handle('data:export-json', async () => {
    ensureReady();
    const response = await dialog.showSaveDialog(mainWindow, { title: '导出完整 JSON 备份', defaultPath: '窝头RJ存钱罐_' + localStamp() + '.json', filters: [{ name: 'JSON 文件', extensions: ['json'] }] });
    if (response.canceled || !response.filePath) return { cancelled: true };
    atomicWrite(response.filePath, JSON.stringify(data, null, 2));
    data.metadata.lastExportAt = nowIso(); persist();
    return { filePath: response.filePath, state: currentState() };
  });
  ipcMain.handle('data:export-csv', async () => {
    ensureReady();
    const response = await dialog.showSaveDialog(mainWindow, { title: '导出历史 CSV', defaultPath: '窝头RJ历史_' + localStamp() + '.csv', filters: [{ name: 'CSV 文件', extensions: ['csv'] }] });
    if (response.canceled || !response.filePath) return { cancelled: true };
    const lines = [['日期', '净资产', '总资产', '总负债', '较上次变化', '变化率', '备注']].map((row) => row.map(csvCell).join(','));
    for (const row of [...snapshotRows()].reverse()) lines.push([row.date, row.totals.net, row.totals.assets, row.totals.debts, row.change ?? '', row.changeRate ?? '', row.note].map(csvCell).join(','));
    atomicWrite(response.filePath, '\ufeff' + lines.join('\r\n'));
    data.metadata.lastExportAt = nowIso(); persist();
    return { filePath: response.filePath, state: currentState() };
  });
  ipcMain.handle('data:export-pdf', async () => {
    ensureReady();
    const response = await dialog.showSaveDialog(mainWindow, { title: '导出 PDF 报表', defaultPath: '窝头RJ资产报表_' + localStamp() + '.pdf', filters: [{ name: 'PDF 文件', extensions: ['pdf'] }] });
    if (response.canceled || !response.filePath) return { cancelled: true };
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportHtml()));
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4', marginsType: 1 });
      fs.writeFileSync(response.filePath, pdf);
      data.metadata.lastExportAt = nowIso(); persist();
      return { filePath: response.filePath, state: currentState() };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
    }
  });
  ipcMain.handle('data:preview-import', async () => {
    const response = await dialog.showOpenDialog(mainWindow, { title: '选择要恢复的 JSON 文件', properties: ['openFile'], filters: [{ name: 'JSON 文件', extensions: ['json'] }] });
    if (response.canceled || !response.filePaths[0]) return { cancelled: true };
    const source = response.filePaths[0];
    const candidate = normalizeData(JSON.parse(fs.readFileSync(source, 'utf8')));
    const productMap = new Map(candidate.products.map((item) => [item.id, item]));
    const typeMap = new Map(candidate.assetTypes.map((item) => [item.id, item]));
    const latest = [...candidate.snapshots].sort((left, right) => left.date.localeCompare(right.date)).at(-1);
    let assets = 0; let debts = 0;
    if (latest) for (const [productId, amount] of Object.entries(latest.values)) {
      const product = productMap.get(productId); const type = product && typeMap.get(product.assetTypeId);
      if (!product || product.includeInTotal === false) continue;
      if (type && type.role === 'debt') debts += Math.abs(Number(amount) || 0);
      else assets += Math.max(0, Number(amount) || 0);
    }
    const token = crypto.randomUUID();
    importSessions.set(token, { candidate, createdAt: Date.now() });
    return { token, summary: { snapshots: candidate.snapshots.length, platforms: candidate.platforms.length, products: candidate.products.length, latestNet: assets - debts, latestDate: latest ? latest.date : null } };
  });
  ipcMain.handle('data:commit-import', (_event, token) => {
    ensureReady();
    const sessionEntry = importSessions.get(token);
    if (!sessionEntry || Date.now() - sessionEntry.createdAt > 10 * 60 * 1000) throw new Error('导入预览已过期，请重新选择文件。');
    writeBackup(data);
    data = sessionEntry.candidate;
    persist({ backup: true });
    importSessions.delete(token);
    return { ...currentState(), imported: true };
  });
  ipcMain.handle('data:clear-all', (_event, phrase) => {
    ensureReady();
    if (phrase !== '确认清空') throw new Error('请输入“确认清空”后再执行。');
    writeBackup(data);
    data = defaultData();
    persist({ backup: true });
    return { ...currentState(), cleared: true };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 790,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#fffaff',
    title: '窝头RJの存钱罐',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'rj.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  // The renderer loads only local files. Block accidental http(s) traffic too.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  dataDirectory = readLocation();
  if (dataDirectory && fs.existsSync(dataDirectory)) {
    try {
      const result = loadFromDirectory(dataDirectory);
      recoveryNotice = result.recovered ? '已从备份 ' + result.recovered + ' 恢复主数据。' : null;
    } catch (error) {
      recoveryNotice = error.message;
      data = null;
    }
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
