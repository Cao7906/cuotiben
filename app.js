/* 初中生错题本 · 应用逻辑 */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeImg = (s) => (typeof s === 'string' && s.indexOf('data:image/') === 0) ? s : '';
  const uid = () => 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const fmtDate = (ts) => { const d = new Date(ts || Date.now()); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
  const fmtFull = (ts) => ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const colorOf = (s) => SUBJECT_COLORS[s] || SUBJECT_COLORS['其他'];
  const icon = (id, cls = 'icon') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
  const DAY = 86400000;

  const state = {
    items: [], tab: 'list', subject: '全部', status: 'all', sort: 'new', keyword: '',
    editingId: null, detailId: null, captureImages: [], openAnswers: new Set()
  };
  let deferredPrompt = null;
  let toastTimer = null;

  /* ---------------- 通用 UI ---------------- */
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  function showLoading(text) { $('#loadingText').textContent = text || '处理中…'; $('#loading').hidden = false; }
  function hideLoading() { $('#loading').hidden = true; }
  function openModal(id) { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(id) {
    $('#' + id).hidden = true;
    if ($('#editorModal').hidden && $('#detailModal').hidden) document.body.style.overflow = '';
    if (id === 'editorModal') state.editingId = null;
  }
  function closeAllModals() { closeModal('editorModal'); closeModal('detailModal'); }

  /* ---------------- 初始化 ---------------- */
  async function boot() {
    await DB.init();
    state.items = await DB.all();
    fillSelects();
    bindEvents();
    applySettingsToForm();
    renderAll();
    refreshStatus();
    setupInstall();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function fillSelects() {
    const opts = (list) => list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    $('#fSubject').innerHTML = opts(SUBJECTS);
    $('#fDifficulty').innerHTML = opts(DIFFICULTIES);
    $('#fCause').innerHTML = opts(CAUSES);
    $('#captureSubject').innerHTML = '<option value="">自动判断学科</option>' + opts(SUBJECTS);
  }

  function renderAll() { renderChips(); renderList(); renderStats(); }

  /* ---------------- 列表 ---------------- */
  function renderChips() {
    const used = SUBJECTS.filter((s) => state.items.some((i) => i.subject === s));
    const list = ['全部'].concat(used);
    if (state.subject !== '全部' && list.indexOf(state.subject) < 0) state.subject = '全部';
    $('#subjectChips').innerHTML = list.map((s) =>
      `<button class="chip ${s === state.subject ? 'on' : ''}" data-subject="${esc(s)}">${esc(s)}${s === '全部' ? '' : ' <span style="opacity:.7">' + state.items.filter((i) => i.subject === s).length + '</span>'}</button>`
    ).join('');
  }

  function filteredItems() {
    const kw = state.keyword.trim().toLowerCase();
    let list = state.items.filter((it) => {
      if (state.subject !== '全部' && it.subject !== state.subject) return false;
      if (state.status === 'todo' && it.mastered) return false;
      if (state.status === 'done' && !it.mastered) return false;
      if (kw) {
        const hay = [it.question, it.answer, it.analysis, it.myAnswer, it.note, (it.knowledgePoints || []).join(' '), it.subject, it.cause].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    const hard = (d) => DIFFICULTIES.indexOf(d);
    list.sort((a, b) => {
      if (state.sort === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
      if (state.sort === 'hard') return hard(b.difficulty) - hard(a.difficulty) || (b.createdAt || 0) - (a.createdAt || 0);
      if (state.sort === 'review') return (a.mastered ? 1 : 0) - (b.mastered ? 1 : 0) || (a.lastReviewAt || 0) - (b.lastReviewAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return list;
  }

  function cardHTML(it) {
    const c = colorOf(it.subject);
    const imgs = it.images || [];
    const cover = imgs.length
      ? `<img src="${esc(safeImg(imgs[0]))}" alt="题目图片" loading="lazy">`
      : `<span class="cover-fallback">${esc(it.subject || '题')}</span>`;
    const tags = (it.knowledgePoints || []).slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join('')
      || '<span class="tag gray">未标注知识点</span>';
    return `<article class="mistake-card" data-open="${esc(it.id)}" style="--sub:${c};--cover-bg:${c}1c">
      <div class="card-cover">${cover}<div class="cover-veil"></div>
        <div class="cover-badges"><span class="pill subject" style="background:${c}">${esc(it.subject)}</span><span class="pill">${esc(it.difficulty)}</span></div>
        <span class="mastered-dot ${it.mastered ? '' : 'todo'}" title="${it.mastered ? '已掌握' : '待复习'}">${icon(it.mastered ? 'check' : 'clock')}</span>
      </div>
      <div class="card-body">
        <p class="card-title">${esc(it.question)}</p>
        <div class="tags">${tags}${it.similar && it.similar.length ? '<span class="tag gray">含' + it.similar.length + '道变式</span>' : ''}</div>
        <div class="meta-line">${icon('clock')}<span>${fmtDate(it.createdAt)}</span><span>·</span><span>${esc(it.cause || '未分类')}</span></div>
      </div>
      <div class="card-footer">
        <button class="text-btn" data-similar="${esc(it.id)}">${icon('spark')}举一反三</button>
        <button class="master-toggle ${it.mastered ? 'done' : ''}" data-toggle="${esc(it.id)}">${icon(it.mastered ? 'check' : 'target')}${it.mastered ? '已掌握' : '标记掌握'}</button>
      </div>
    </article>`;
  }

  function renderList() {
    const list = filteredItems();
    $('#cardGrid').innerHTML = list.map(cardHTML).join('');
    const done = list.filter((x) => x.mastered).length;
    $('#resultCount').textContent = state.items.length
      ? `筛出 ${list.length} 道 · 其中 ${done} 道已掌握（总库 ${state.items.length} 道）`
      : '';
    const empty = $('#emptyState');
    if (list.length) { empty.hidden = true; return; }
    empty.hidden = false;
    const hasData = state.items.length > 0;
    $('h3', empty).textContent = hasData ? '没有符合条件的错题' : '还没有错题';
    $('p', empty).textContent = hasData ? '换个学科、状态或关键词试试' : '点右下角的加号，拍下第一道错题吧';
    const btn = $('#emptyAdd');
    btn.textContent = hasData ? '清除筛选' : '添加错题';
    btn.dataset.mode = hasData ? 'reset' : 'add';
  }

  function resetFilters() {
    state.subject = '全部'; state.status = 'all'; state.keyword = ''; state.sort = 'new';
    $('#searchInput').value = ''; $('#sortSelect').value = 'new';
    $$('#statusFilter button').forEach((b) => b.classList.toggle('on', b.dataset.status === 'all'));
    renderAll();
  }

  /* ---------------- 详情 ---------------- */
  function openDetail(id, scrollToSimilar) {
    state.detailId = id;
    renderDetail();
    openModal('detailModal');
    $('#detailModal .modal-body').scrollTop = 0;
    if (scrollToSimilar) requestAnimationFrame(() => {
      const el = $('#similarSection');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderDetail() {
    const it = state.items.find((x) => x.id === state.detailId);
    if (!it) { closeModal('detailModal'); return; }
    const c = colorOf(it.subject);
    const imgs = (it.images || []).map((s) => safeImg(s)).filter(Boolean);
    const kps = it.knowledgePoints || [];
    // 历史缓存的变式题也做一次一致性校正，避免旧的错误答案继续展示
    const fixAnswer = (AI.__internal && AI.__internal.reconcileAnswer) || ((x) => x);
    const sims = (it.similar || []).map(fixAnswer);
    // 校正结果静默回写一次，避免导出备份或下次打开仍是旧的错误答案
    if (sims.some((s) => s.answerFixed)) {
      const clean = sims.map((s) => { const c = Object.assign({}, s); delete c.answerFixed; return c; });
      it.similar = clean;
      DB.put(it).catch(() => {});
    }
    const imagesHTML = imgs.length
      ? `<div class="detail-images">${imgs.map((s) => `<img src="${esc(s)}" alt="错题图片">`).join('')}</div>` : '';
    const similarHTML = sims.length ? sims.map((s, i) => {
      const key = it.id + '_' + i;
      const shown = state.openAnswers.has(key);
      return `<div class="similar-item">
        <div class="num">变式 ${i + 1} · ${esc(s.difficulty || it.difficulty)}</div>
        <div class="q">${esc(s.question)}</div>
        <button class="eye-btn" data-act="ans" data-i="${i}">${icon('eye')}${shown ? '收起答案' : '查看答案与解析'}</button>
        <div class="ans" data-ans="${i}" ${shown ? '' : 'hidden'}>
          <div><b>答案：</b>${esc(s.answer || '—')}${s.answerFixed ? ' <span style="color:var(--muted);font-size:12px">（已按解析结论校正）</span>' : ''}</div>
          <div style="margin-top:6px"><b>解析：</b>${esc(s.analysis || '—')}</div>
          ${(s.knowledgePoints || []).length ? '<div style="margin-top:6px;color:var(--muted);font-size:12px">知识点：' + esc(s.knowledgePoints.join('、')) + '</div>' : ''}
        </div>
      </div>`;
    }).join('') : `<div class="tip-box" style="background:#f3f6fc;color:var(--ink-2)">${icon('info')}<span>还没有生成同类题。点下方按钮，AI 会按相同知识点出 3 道由易到难的变式题。</span></div>`;

    const bodyEl = $('#detailBody');
    const keepScroll = bodyEl.scrollTop;
    bodyEl.innerHTML = `
      ${imagesHTML}
      <div class="detail-head">
        <span class="badge subject" style="--sub:${c}">${esc(it.subject)}</span>
        <span class="badge">${esc(it.difficulty)}</span>
        <span class="badge gray">${esc(it.cause || '未分类')}</span>
        <span class="badge ${it.mastered ? 'green' : 'amber'}">${it.mastered ? '已掌握' : '待复习'}</span>
      </div>
      <div class="detail-block"><h4>题目</h4><div class="content q">${esc(it.question)}</div></div>
      <div class="answer-pair">
        <div class="detail-block"><h4>我的答案（错答）</h4><div class="content wrong">${esc(it.myAnswer || '—')}</div></div>
        <div class="detail-block"><h4>正确答案</h4><div class="content right">${esc(it.answer || '—')}</div></div>
      </div>
      <div class="detail-block"><h4>解析</h4><div class="content">${esc(it.analysis || '暂无解析')}</div></div>
      <div class="detail-block"><h4>知识点</h4><div class="tags" style="margin:0">${kps.length ? kps.map((k) => `<span class="tag">${esc(k)}</span>`).join('') : '<span class="tag gray">未标注</span>'}</div></div>
      <div class="kv-grid">
        <div class="kv"><small>录入时间</small><b>${fmtFull(it.createdAt)}</b></div>
        <div class="kv"><small>复习次数</small><b>${it.reviewCount || 0} 次</b></div>
        <div class="kv"><small>最近复习</small><b>${fmtFull(it.lastReviewAt)}</b></div>
        <div class="kv"><small>录入方式</small><b>${it.source === 'ai' ? 'AI 识别' : it.source === 'demo' ? '演示数据' : '手动录入'}</b></div>
      </div>
      ${it.note ? `<div class="detail-block"><h4>复盘备注</h4><div class="content">${esc(it.note)}</div></div>` : ''}
      <div class="detail-actions">
        <button class="primary-btn" data-act="master">${icon(it.mastered ? 'refresh' : 'check')}${it.mastered ? '放回待复习' : '标记为已掌握'}</button>
        <button class="ghost-btn danger" data-act="del">${icon('trash')}删除</button>
      </div>
      <div id="similarSection" class="stats-card" style="margin-top:18px">
        <h3>${icon('spark')} 举一反三</h3>
        <p class="sub">同一知识点的变式训练${it.similarSource === 'demo' ? ' · 演示示例' : ''}</p>
        ${similarHTML}
        <button class="ghost-btn" style="width:100%;margin-top:6px" data-act="gen">${icon(sims.length ? 'refresh' : 'spark')}${sims.length ? '重新生成 3 道' : '生成 3 道同类题'}</button>
      </div>`;
    bodyEl.scrollTop = keepScroll;
  }

  /* ---------------- 掌握 / 举一反三 ---------------- */
  async function toggleMaster(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.mastered = !it.mastered;
    it.reviewCount = (it.reviewCount || 0) + 1;
    it.lastReviewAt = Date.now();
    it.updatedAt = Date.now();
    await DB.put(it);
    state.items = await DB.all();
    renderAll();
    if (state.detailId === id && !$('#detailModal').hidden) renderDetail();
    toast(it.mastered ? '已标记为「已掌握」，复习进度 +1' : '已放回「未掌握」，继续加油');
  }

  async function generateSimilar(id, force) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    if (!force && it.similar && it.similar.length) { openDetail(id, true); return; }
    showLoading('AI 正在生成同类题…');
    try {
      const r = await AI.similar(it);
      it.similar = r.items;
      it.similarSource = r.source;
      it.updatedAt = Date.now();
      state.openAnswers.clear();
      await DB.put(it);
      state.items = await DB.all();
      openDetail(id, true);
      toast(r.source === 'demo' ? '演示模式：已生成 3 道示例变式题' : '已生成 3 道同类题');
    } catch (e) { toast('生成失败：' + e.message, 4200); }
    finally { hideLoading(); }
  }

  /* ---------------- 录入 / 编辑 ---------------- */
  function renderPreview() {
    const addRemove = (src, i) => `<div class="preview-item"><img src="${esc(safeImg(src))}" alt="图片 ${i + 1}"><button data-remove-img="${i}" aria-label="移除图片">${icon('close')}</button></div>`;
    $('#previewStrip').innerHTML = state.captureImages.map(addRemove).join('');
    $('#formImages').innerHTML = state.captureImages.map((s, i) =>
      `<div class="preview-item"><img src="${esc(safeImg(s))}" alt="图片 ${i + 1}"></div>`).join('');
  }

  function fillForm(o) {
    $('#fQuestion').value = o.question || '';
    $('#fSubject').value = SUBJECTS.indexOf(o.subject) >= 0 ? o.subject : '其他';
    $('#fDifficulty').value = DIFFICULTIES.indexOf(o.difficulty) >= 0 ? o.difficulty : '中等';
    $('#fCause').value = CAUSES.indexOf(o.cause) >= 0 ? o.cause : '其他';
    $('#fMyAnswer').value = o.myAnswer || '';
    $('#fAnswer').value = o.answer || '';
    $('#fAnalysis').value = o.analysis || '';
    $('#fKnowledge').value = (o.knowledgePoints || []).join('、');
    $('#fNote').value = o.note || '';
    $('#fMastered').checked = !!o.mastered;
    renderPreview();
  }

  function showFormStep(show) {
    $('#captureStep').hidden = show;
    $('#formStep').hidden = !show;
    $('#editorSave').hidden = !show;
    const body = $('#editorModal .modal-body');
    if (body) body.scrollTop = 0;
  }

  function openEditor(item) {
    closeModal('detailModal');
    state.editingId = item ? item.id : null;
    state.captureImages = item ? (item.images || []).slice() : [];
    $('#editorTitle').textContent = item ? '编辑错题' : '添加错题';
    $('#captureSubject').value = '';
    if (item) { fillForm(item); showFormStep(true); }
    else {
      fillForm({ subject: '数学', difficulty: '中等', cause: '其他', knowledgePoints: [], question: '' });
      showFormStep(false);
      renderPreview();
      refreshStatus();
    }
    openModal('editorModal');
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type && f.type.indexOf('image/') === 0);
    if (!files.length) { toast('请选择图片文件'); return; }
    const room = 4 - state.captureImages.length;
    if (room <= 0) { toast('最多支持 4 张图片'); return; }
    showLoading('正在压缩图片…');
    try {
      for (const f of files.slice(0, room)) {
        state.captureImages.push(await AI.compressImage(f));
      }
      renderPreview();
      toast('已添加 ' + Math.min(files.length, room) + ' 张图片');
    } catch (e) { toast('图片处理失败：' + e.message); }
    finally { hideLoading(); }
  }

  async function doRecognize() {
    if (!state.captureImages.length) { toast('请先添加题目图片，或直接点「手动录入」'); return; }
    showLoading('AI 正在识别题目并生成解析…');
    try {
      const r = await AI.recognize(state.captureImages, $('#captureSubject').value);
      fillForm(r);
      showFormStep(true);
      toast(r.source === 'demo' ? '演示模式：已填入示例数据，请核对后修改' : '识别完成，请核对内容后保存');
    } catch (e) { toast('识别失败：' + e.message, 4600); }
    finally { hideLoading(); }
  }

  async function saveForm() {
    const q = $('#fQuestion').value.trim();
    if (!q) { toast('题目不能为空'); $('#fQuestion').focus(); return; }
    const old = state.editingId ? state.items.find((x) => x.id === state.editingId) : null;
    const now = Date.now();
    const mastered = $('#fMastered').checked;
    const item = {
      id: old ? old.id : uid(),
      createdAt: old ? old.createdAt : now,
      updatedAt: now,
      subject: $('#fSubject').value,
      question: q,
      myAnswer: $('#fMyAnswer').value.trim(),
      answer: $('#fAnswer').value.trim(),
      analysis: $('#fAnalysis').value.trim(),
      knowledgePoints: $('#fKnowledge').value.split(/[,，、;；]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
      difficulty: $('#fDifficulty').value,
      cause: $('#fCause').value,
      note: $('#fNote').value.trim(),
      images: state.captureImages.slice(),
      mastered,
      reviewCount: old ? (old.reviewCount || 0) + (old.mastered !== mastered ? 1 : 0) : 0,
      lastReviewAt: old ? (old.mastered !== mastered ? now : old.lastReviewAt || null) : null,
      similar: old ? (old.similar || []) : [],
      similarSource: old ? old.similarSource : undefined,
      source: old ? (old.source || 'manual') : 'manual'
    };
    try {
      await DB.put(item);
      state.items = await DB.all();
      renderAll();
      closeModal('editorModal');
      toast(old ? '修改已保存' : '错题已收入错题本');
    } catch (e) { toast('保存失败：' + e.message, 4200); }
  }

  /* ---------------- 统计 ---------------- */
  function renderStats() {
    const items = state.items;
    const total = items.length;
    const done = items.filter((x) => x.mastered).length;
    const rate = total ? Math.round(done / total * 100) : 0;
    const reviews = items.reduce((n, x) => n + (x.reviewCount || 0), 0);
    const C = 2 * Math.PI * 44;
    const hero = `<div class="stats-hero">
      <div class="ring-wrap">
        <svg width="104" height="104" viewBox="0 0 104 104">
          <circle cx="52" cy="52" r="44" fill="none" stroke="rgba(255,255,255,.24)" stroke-width="9"/>
          <circle cx="52" cy="52" r="44" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${(C * rate / 100).toFixed(1)} ${C.toFixed(1)}"/>
        </svg>
        <div class="ring-label"><b>${rate}%</b><small>掌握率</small></div>
      </div>
      <div class="hero-numbers">
        <div class="hero-num"><b>${total}</b><span>错题总数</span></div>
        <div class="hero-num"><b>${done}</b><span>已掌握</span></div>
        <div class="hero-num"><b>${total - done}</b><span>待复习</span></div>
        <div class="hero-num"><b>${reviews}</b><span>累计复习次数</span></div>
      </div>
    </div>`;

    if (!total) {
      $('#statsBody').innerHTML = hero + `<div class="stats-card" style="text-align:center;padding:34px 18px">
        <h3 style="justify-content:center">${icon('chart')} 还没有统计数据</h3>
        <p class="sub" style="margin:8px 0 0">录入几道错题，或到「设置 → 生成示例数据」看看效果</p>
      </div>`;
      return;
    }

    // 各学科错题量
    const bySubject = SUBJECTS.map((s) => {
      const list = items.filter((x) => x.subject === s);
      return { name: s, count: list.length, done: list.filter((x) => x.mastered).length, color: colorOf(s) };
    }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
    const max = Math.max.apply(null, bySubject.map((x) => x.count));
    const subjectBars = bySubject.map((x) => `<div class="bar-row">
      <div class="bar-top"><b>${esc(x.name)}</b><span>${x.count} 题 · 已掌握 ${x.done}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(x.count / max * 100).toFixed(1)}%;--bar-color:${x.color}"></div></div>
    </div>`).join('');

    // 复习进度
    const progress = bySubject.map((x) => `<div class="progress-line">
      <span class="name">${esc(x.name)}</span>
      <span class="track"><i style="width:${Math.round(x.done / x.count * 100)}%"></i></span>
      <span class="val">${x.done}/${x.count}</span>
    </div>`).join('');

    // 错因分布
    const causes = {};
    items.forEach((x) => { const k = x.cause || '其他'; causes[k] = (causes[k] || 0) + 1; });
    const causeList = Object.keys(causes).map((k) => ({ k, n: causes[k] })).sort((a, b) => b.n - a.n).slice(0, 6);
    const maxC = causeList[0].n;
    const causeBars = causeList.map((x) => `<div class="bar-row">
      <div class="bar-top"><b>${esc(x.k)}</b><span>${x.n} 题 · ${Math.round(x.n / total * 100)}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(x.n / maxC * 100).toFixed(1)}%;--bar-color:#ee8a5f"></div></div>
    </div>`).join('');

    // 难度分布
    const diffCloud = DIFFICULTIES.map((d) => {
      const n = items.filter((x) => x.difficulty === d).length;
      return `<div class="diff-chip"><b>${n}</b>${esc(d)}</div>`;
    }).join('');

    // 近 7 天新增
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY);
      const n = items.filter((x) => { const t = new Date(x.createdAt); t.setHours(0, 0, 0, 0); return t.getTime() === d.getTime(); }).length;
      days.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), n });
    }
    const maxD = Math.max(1, ...days.map((x) => x.n));
    const spark = days.map((d) => `<div class="spark-col"><div class="spark-bar" style="height:${Math.max(3, d.n / maxD * 66)}px" title="${d.label}：${d.n} 题"></div><span>${d.label}</span></div>`).join('');

    $('#statsBody').innerHTML = hero + `
      <div class="stats-card"><h3>${icon('book')} 各学科错题量</h3><p class="sub">按录入数量排序，条形长度代表题量</p>${subjectBars}
        <div class="legend"><span><i style="background:var(--primary)"></i>学科题量</span><span>共 ${bySubject.length} 个学科</span></div>
      </div>
      <div class="stats-card"><h3>${icon('target')} 复习进度</h3><p class="sub">各学科「已掌握 / 总数」</p>${progress}
        <div class="bar-row" style="margin-top:16px;margin-bottom:2px"><div class="bar-top"><b>总体进度</b><span>${done} / ${total} · ${rate}%</span></div>
          <div class="bar-track" style="height:11px"><div class="bar-fill done" style="width:${rate}%"></div></div></div>
      </div>
      <div class="stats-card"><h3>${icon('info')} 错因分布</h3><p class="sub">优先攻克占比最高的错因</p>${causeBars}</div>
      <div class="stats-card"><h3>${icon('layers')} 难度分布</h3><p class="sub">看看错题集中在哪个难度档</p><div class="difficulty-cloud">${diffCloud}</div></div>
      <div class="stats-card"><h3>${icon('clock')} 近 7 天录入</h3><p class="sub">保持节奏，每天整理一点点</p><div class="spark-bars">${spark}</div></div>`;
  }

  /* ---------------- 设置 ---------------- */
  function applySettingsToForm() {
    const s = AI.getSettings();
    $('#aiMode').value = s.aiMode;
    $('#provider').value = s.provider;
    $('#baseUrl').value = s.baseUrl;
    $('#apiKey').value = s.apiKey;
    $('#model').value = s.model;
    $('#textModel').value = s.textModel || '';
  }
  function collectSettings() {
    return {
      aiMode: $('#aiMode').value, provider: $('#provider').value,
      baseUrl: $('#baseUrl').value.trim(), apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim(), textModel: $('#textModel').value.trim()
    };
  }
  async function refreshStatus() {
    const st = await AI.status();
    $('#aiStatusLine').textContent = '当前：' + st.label;
    $('#captureNote').textContent = '识别方式：' + st.label;
    const dbi = DB.info();
    const engine = dbi.mode === 'supabase' ? 'Supabase 云数据库（多设备同步）'
      : dbi.mode === 'indexedDB' ? '本地 IndexedDB（云端暂不可用）'
      : '本地 localStorage（云端暂不可用）';
    $('#storageLine').textContent = '存储：' + engine + ' · 当前共 ' + (await DB.all()).length + ' 道错题'
      + (dbi.error ? ' · 云端连接失败：' + String(dbi.error).slice(0, 70) : '');
  }

  function ensureItem(x) {
    if (!x || typeof x !== 'object') return null;
    const kp = Array.isArray(x.knowledgePoints) ? x.knowledgePoints : String(x.knowledgePoints || '').split(/[,，、]+/);
    const imgs = Array.isArray(x.images) ? x.images : (x.image ? [x.image] : []);
    return {
      id: String(x.id || uid()), createdAt: Number(x.createdAt) || Date.now(), updatedAt: Number(x.updatedAt) || Date.now(),
      subject: SUBJECTS.indexOf(x.subject) >= 0 ? x.subject : '其他',
      question: String(x.question || ''), myAnswer: String(x.myAnswer || ''), answer: String(x.answer || ''),
      analysis: String(x.analysis || ''), note: String(x.note || ''),
      knowledgePoints: kp.map(String).filter(Boolean).slice(0, 8),
      difficulty: DIFFICULTIES.indexOf(x.difficulty) >= 0 ? x.difficulty : '中等',
      cause: CAUSES.indexOf(x.cause) >= 0 ? x.cause : '其他',
      images: imgs.map(safeImg).filter(Boolean).slice(0, 4),
      mastered: !!x.mastered, reviewCount: Number(x.reviewCount) || 0,
      lastReviewAt: Number(x.lastReviewAt) || null,
      similar: Array.isArray(x.similar) ? x.similar.slice(0, 3) : [],
      similarSource: x.similarSource, source: x.source || 'manual'
    };
  }

  function exportData() {
    const data = { app: '初中生错题本', version: 1, exportedAt: new Date().toISOString(), items: state.items };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '错题本备份-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('备份已导出，包含 ' + state.items.length + ' 道错题');
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(arr)) throw new Error('文件格式不正确');
      const items = arr.map(ensureItem).filter((x) => x && x.question);
      if (!items.length) throw new Error('文件中没有可导入的错题');
      await DB.bulkPut(items);
      state.items = await DB.all();
      renderAll(); refreshStatus();
      toast('已导入 / 合并 ' + items.length + ' 道错题');
    } catch (e) { toast('导入失败：' + e.message, 4000); }
  }

  function buildDemoItems() {
    const keys = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '道德与法治'];
    const now = Date.now();
    return keys.map((sub, idx) => {
      const list = DEMO_BANK[sub] || DEMO_BANK['其他'];
      const b = list[idx % list.length];
      const t = now - (idx * 2 + 1) * DAY - (idx % 3) * 3600000;
      return {
        id: uid(), createdAt: t, updatedAt: t, subject: sub,
        question: b.question, myAnswer: b.myAnswer, answer: b.answer, analysis: b.analysis,
        knowledgePoints: b.knowledgePoints.slice(), difficulty: b.difficulty, cause: b.cause,
        note: b.note, images: [], mastered: idx % 3 === 0,
        reviewCount: idx % 4, lastReviewAt: idx % 3 === 0 ? t + DAY : null,
        similar: [], source: 'demo'
      };
    });
  }

  /* ---------------- 安装到桌面 ---------------- */
  function setupInstall() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    $('#installBtn').hidden = false;
    $('#installBtn2').hidden = false;
  }
  async function onInstall() {
    if (location.protocol === 'file:') {
      toast('请先用 start.bat 启动，再访问 http://localhost:5173 添加到桌面', 5000); return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const r = await deferredPrompt.userChoice;
      deferredPrompt = null;
      toast(r.outcome === 'accepted' ? '正在安装…' : '已取消安装');
    } else {
      toast('iPhone：点底部「分享」→「添加到主屏幕」；Android：浏览器菜单 →「安装应用」', 5200);
    }
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; setupInstall(); });

  /* ---------------- 事件绑定 ---------------- */
  function switchTab(tab) {
    state.tab = tab;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'settings') refreshStatus();
  }

  function bindEvents() {
    // 导航
    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#goSettings').addEventListener('click', () => switchTab('settings'));
    $('#installBtn').addEventListener('click', onInstall);
    $('#installBtn2').addEventListener('click', onInstall);

    // 筛选
    let searchTimer;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.keyword = e.target.value; renderList(); }, 140);
    });
    $('#subjectChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-subject]');
      if (!b) return;
      state.subject = b.dataset.subject; renderAll();
    });
    $('#statusFilter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      state.status = b.dataset.status;
      $$('#statusFilter button').forEach((x) => x.classList.toggle('on', x === b));
      renderList();
    });
    $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
    $('#emptyAdd').addEventListener('click', (e) => {
      if (e.target.dataset.mode === 'reset') resetFilters(); else openEditor(null);
    });

    // 列表卡片
    $('#cardGrid').addEventListener('click', (e) => {
      const sim = e.target.closest('[data-similar]');
      if (sim) { generateSimilar(sim.dataset.similar); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) { toggleMaster(tg.dataset.toggle); return; }
      const card = e.target.closest('[data-open]');
      if (card) openDetail(card.dataset.open);
    });

    // 详情
    $('#detailEdit').addEventListener('click', () => {
      const it = state.items.find((x) => x.id === state.detailId);
      if (it) openEditor(it);
    });
    $('#detailBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = state.detailId;
      if (btn.dataset.act === 'ans') {
        const box = $('#detailBody [data-ans="' + btn.dataset.i + '"]');
        if (box) {
          box.hidden = !box.hidden;
          const key = id + '_' + btn.dataset.i;
          box.hidden ? state.openAnswers.delete(key) : state.openAnswers.add(key);
          btn.innerHTML = icon('eye') + (box.hidden ? '查看答案与解析' : '收起答案');
        }
      } else if (btn.dataset.act === 'gen') generateSimilar(id, true);
      else if (btn.dataset.act === 'master') toggleMaster(id);
      else if (btn.dataset.act === 'del') {
        const it = state.items.find((x) => x.id === id);
        if (!it) return;
        if (!confirm('确定删除这道错题吗？此操作不可撤销。')) return;
        DB.remove(id).then(async () => {
          state.items = await DB.all();
          closeModal('detailModal'); renderAll(); refreshStatus(); toast('已删除');
        });
      }
    });

    // 录入
    $('#fabAdd').addEventListener('click', () => openEditor(null));
    $('#dropZone').addEventListener('click', () => $('#fileInput').click());
    $('#dropZone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('#fileInput').click(); });
    $('#btnCamera').addEventListener('click', () => $('#cameraInput').click());
    $('#btnAlbum').addEventListener('click', () => $('#fileInput').click());
    ['dragenter', 'dragover'].forEach((ev) => $('#dropZone').addEventListener(ev, (e) => { e.preventDefault(); $('#dropZone').classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => $('#dropZone').addEventListener(ev, (e) => { e.preventDefault(); $('#dropZone').classList.remove('dragover'); }));
    $('#dropZone').addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    const onPick = (input) => input.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    onPick($('#fileInput')); onPick($('#cameraInput'));
    $('#previewStrip').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove-img]');
      if (!b) return;
      state.captureImages.splice(Number(b.dataset.removeImg), 1);
      renderPreview();
    });
    $('#btnRecognize').addEventListener('click', doRecognize);
    $('#btnReRecognize').addEventListener('click', doRecognize);
    $('#btnManual').addEventListener('click', () => {
      fillForm({ subject: $('#captureSubject').value || '数学', difficulty: '中等', cause: '其他', knowledgePoints: [], question: '' });
      showFormStep(true);
    });
    $('#btnBackCapture').addEventListener('click', () => showFormStep(false));
    $('#editorSave').addEventListener('click', saveForm);
    $('#mistakeForm').addEventListener('submit', (e) => e.preventDefault());

    // 模态关闭
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
    ['editorModal', 'detailModal'].forEach((id) => {
      $('#' + id).addEventListener('click', (e) => { if (e.target.id === id) closeModal(id); });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

    // 设置
    $('#provider').addEventListener('change', (e) => {
      AI.applyPreset(e.target.value);
      const s = AI.getSettings();
      $('#baseUrl').value = s.baseUrl; $('#model').value = s.model; $('#textModel').value = s.textModel || '';
      refreshStatus();
    });
    $('#aiMode').addEventListener('change', refreshStatus);
    $('#saveAiConfig').addEventListener('click', () => {
      AI.saveSettings(collectSettings());
      refreshStatus();
      toast('设置已保存到本机浏览器');
    });
    $('#testAi').addEventListener('click', async () => {
      AI.saveSettings(collectSettings());
      showLoading('正在测试 AI 连接…');
      const r = await AI.testConnection();
      hideLoading();
      refreshStatus();
      toast((r.ok ? '连接正常：' : '连接失败：') + r.message, 4600);
    });
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
    $('#demoBtn').addEventListener('click', async () => {
      if (state.items.length && !confirm('将追加 9 道示例错题（现有数据不会删除），继续吗？')) return;
      await DB.bulkPut(buildDemoItems());
      state.items = await DB.all();
      renderAll(); refreshStatus();
      toast('已生成 9 道示例错题，去「复习统计」看看效果');
      switchTab('stats');
    });
    $('#clearBtn').addEventListener('click', async () => {
      if (!confirm('确定清空全部错题吗？建议先导出备份。')) return;
      if (!confirm('再次确认：清空后无法恢复，继续？')) return;
      await DB.clear();
      state.items = [];
      renderAll(); refreshStatus(); toast('已清空全部数据');
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
