/* 数据层：Supabase 云数据库优先；云端不可用时自动回退本地 IndexedDB / localStorage。
   首次成功连上云端时，会把浏览器里已有的错题自动上传一次（按 id 覆盖，重复执行安全）。 */
const DB = (function () {
  /* ===== 你的 Supabase 配置 =====
     publishable key 可以放在前端，但必须在 Supabase 里配好 RLS 策略（见部署说明）。 */
  const SUPABASE_URL = 'https://wubvgwunxhnvqhwganpe.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_9sUd9pIjFiZIUu7ORI6fmg_KQsPvWNl';
  const TABLE = 'mistakes';
  const MIGRATED_KEY = 'ctb_supabase_migrated_v1';
  const BATCH = 20; // 图片是 base64，分批上传避免单次请求过大

  /* ---------- 本地实现（云端回退 + 首次迁移用，逻辑与原版一致） ---------- */
  const LocalDB = (function () {
    const DB_NAME = 'cuotiben-db';
    const STORE = 'mistakes';
    const LS_KEY = 'ctb_items_v1';
    let db = null;
    let mode = 'indexedDB';

    function openIDB() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB 不可用'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
        req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
      });
    }

    async function init() {
      try { db = await openIDB(); mode = 'indexedDB'; }
      catch (e) { db = null; mode = 'localStorage'; }
      return mode;
    }

    function readLS() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
      catch (e) { return []; }
    }
    function writeLS(items) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(items)); }
      catch (e) { throw new Error('本机浏览器存储空间不足，请先导出备份并删除部分图片。'); }
    }

    function tx(fn) {
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    function read(fn) {
      return new Promise((resolve, reject) => {
        const req = fn(db.transaction(STORE, 'readonly').objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function all() {
      const items = mode === 'indexedDB' ? (await read((s) => s.getAll())) : readLS();
      return (items || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    async function get(id) {
      if (mode === 'indexedDB') return read((s) => s.get(id));
      return readLS().find((x) => x.id === id) || null;
    }
    async function put(item) {
      if (mode === 'indexedDB') return tx((s) => s.put(item));
      const items = readLS();
      const i = items.findIndex((x) => x.id === item.id);
      if (i >= 0) items[i] = item; else items.push(item);
      writeLS(items);
      return item.id;
    }
    async function bulkPut(items) {
      if (mode === 'indexedDB') {
        return new Promise((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const s = t.objectStore(STORE);
          items.forEach((it) => s.put(it));
          t.oncomplete = () => resolve(items.length);
          t.onerror = () => reject(t.error);
        });
      }
      const old = readLS();
      const map = new Map(old.map((x) => [x.id, x]));
      items.forEach((it) => map.set(it.id, it));
      writeLS(Array.from(map.values()));
      return items.length;
    }
    async function remove(id) {
      if (mode === 'indexedDB') return tx((s) => s.delete(id));
      writeLS(readLS().filter((x) => x.id !== id));
    }
    async function clear() {
      if (mode === 'indexedDB') return tx((s) => s.clear());
      writeLS([]);
    }
    function info() { return { mode }; }

    return { init, all, get, put, bulkPut, remove, clear, info };
  })();

  /* ---------- Supabase 实现 ---------- */
  let mode = 'connecting';
  let lastError = '';

  function apiHeaders(extra) {
    const h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
    if (extra) Object.keys(extra).forEach((k) => { h[k] = extra[k]; });
    return h;
  }

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: apiHeaders() }, options || {});
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.headers = apiHeaders({
        'Content-Type': 'application/json',
        // id 冲突时覆盖，而不是报错；return=minimal 让响应更小
        Prefer: 'resolution=merge-duplicates,return=minimal'
      });
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
    } catch (e) {
      throw new Error('连接 Supabase 失败：' + ((e && e.message) || '网络错误'));
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j.message || j.hint || j.details || '';
      } catch (e) { /* 响应不是 JSON 时忽略 */ }
      throw new Error('Supabase 返回 ' + res.status + (detail ? '：' + String(detail).slice(0, 120) : ''));
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function rowOf(item) {
    return {
      id: String(item.id),
      data: item,
      created_at: new Date(Number(item.createdAt) || Date.now()).toISOString()
    };
  }

  async function pushRows(items) {
    let pushed = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      await api(TABLE, { method: 'POST', body: chunk.map(rowOf) });
      pushed += chunk.length;
    }
    return pushed;
  }

  async function switchToLocal(e) {
    lastError = (e && e.message) ? e.message : String(e);
    mode = 'local';
    return LocalDB.init();
  }

  function sorted(items) {
    return (items || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function init() {
    try {
      await api(TABLE + '?select=id&limit=1');
      mode = 'supabase';
      lastError = '';
      // 首次连通：把浏览器里已有的错题搬到云端；id 相同会覆盖，重复执行安全
      try {
        if (!localStorage.getItem(MIGRATED_KEY)) {
          await LocalDB.init();
          const local = await LocalDB.all();
          if (local.length) await pushRows(local);
          localStorage.setItem(MIGRATED_KEY, '1');
        }
      } catch (e) { /* 迁移失败不阻断使用，下次刷新会重试 */ }
      return mode;
    } catch (e) {
      await switchToLocal(e);
      return mode;
    }
  }

  async function all() {
    if (mode !== 'supabase') return sorted(await LocalDB.all());
    try {
      const rows = await api(TABLE + '?select=data&order=created_at.desc&limit=1000');
      return sorted((rows || []).map((r) => r.data).filter(Boolean));
    } catch (e) {
      await switchToLocal(e);
      return sorted(await LocalDB.all());
    }
  }

  async function get(id) {
    if (mode !== 'supabase') return LocalDB.get(id);
    try {
      const rows = await api(TABLE + '?select=data&id=eq.' + encodeURIComponent(id) + '&limit=1');
      return rows && rows[0] ? rows[0].data : null;
    } catch (e) {
      await switchToLocal(e);
      return LocalDB.get(id);
    }
  }

  async function put(item) {
    if (mode !== 'supabase') return LocalDB.put(item);
    try {
      await pushRows([item]);
      return item.id;
    } catch (e) {
      await switchToLocal(e);
      return LocalDB.put(item);
    }
  }

  async function bulkPut(items) {
    if (mode !== 'supabase') return LocalDB.bulkPut(items);
    try {
      return await pushRows(items);
    } catch (e) {
      await switchToLocal(e);
      return LocalDB.bulkPut(items);
    }
  }

  async function remove(id) {
    if (mode !== 'supabase') return LocalDB.remove(id);
    try {
      await api(TABLE + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (e) {
      await switchToLocal(e);
      return LocalDB.remove(id);
    }
  }

  async function clear() {
    if (mode !== 'supabase') return LocalDB.clear();
    try {
      await api(TABLE + '?id=not.is.null', { method: 'DELETE' });
    } catch (e) {
      await switchToLocal(e);
      return LocalDB.clear();
    }
  }

  function info() {
    if (mode === 'supabase') return { mode: 'supabase', error: '' };
    const local = LocalDB.info();
    return { mode: local.mode, error: lastError };
  }

  return { init, all, get, put, bulkPut, remove, clear, info };
})();
