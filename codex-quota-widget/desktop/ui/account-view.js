(() => {
  'use strict';
  const validMode = value => value === 'api' || value === 'subscription';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  function windowText(item) {
    const used = number(item.usedPercent);
    return used === null ? '额度比例未知' : `已用 ${used.toFixed(1)}% · 剩余 ${Math.max(0, 100 - used).toFixed(1)}%${item.stale ? '（快照已过期）' : ''}`;
  }
  function tokenText(value) { const n = number(value); return n === null ? '暂无记录' : n.toLocaleString() + ' token'; }
  function quotaLabel(item) { return item.windowDurationMins === 300 ? '5 小时额度' : item.windowDurationMins === 10080 ? '每周额度' : item.label || '额度窗口'; }
  function noticeText(value) {
    if (!value || value.notify === false) return '';
    if (value.failureKind === 'high-demand') return '挤不进去...';
    return number(value.tokens) === null ? '本轮 token 暂无记录' : '本轮本机已观测：' + tokenText(value.tokens);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validMode, windowText, tokenText, noticeText, quotaLabel };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const key = 'dshw-account-view';
  let mode = 'api', card = null, content = null, root = null, generation = 0, switching = false, latestNotice = null;
  let modeButtons = [], status = null, modeRevision = 0, refreshButton = null;
  let latestQuota = null, quotaRequest = null, updateStatus = null;
  let scene = 'quota', turnRecord = null, turnTimer = null, headerLabel = null;
  let turnSequence = 0, turnPollPending = false, quotaTurnEnabled = false, turnsAligned = false;
  const dismissedTurns = new Set(), noticeStartedAt = Date.now();
  const percentages = new Map();
  try { const saved = localStorage.getItem(key); if (validMode(saved)) mode = saved; } catch {}
  function text(parent, tag, value) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
  function date(value) { if (!value) return '未知'; const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '未知'; }
  function close() {
    if (turnRecord?.id) { dismissedTurns.add(turnRecord.id); if (dismissedTurns.size > 64) dismissedTurns.delete(dismissedTurns.values().next().value); }
    clearTimeout(turnTimer); turnTimer = null; turnRecord = null; scene = 'quota';
    generation++; card?.remove(); card = content = updateStatus = refreshButton = headerLabel = null;
  }
  function position() {
    if (!card) return;
    const anchor = (root || document).querySelector('.dshwv-img') || document.querySelector('.dshwv-img');
    if (!anchor) return;
    // Reuse the upstream 1026 x 700 bubble stage inside the square pet root.
    // Its image occupies the lower 59.45%; both now share the same size/origin.
    const host = anchor.closest('.dshwv-root');
    if (!host) return;
    const bounds = host.getBoundingClientRect(), width = bounds.width, height = width * 700 / 1026;
    if (!(width > 0)) return;
    const size = width + 'px';
    if (card.style.getPropertyValue('--quota-size') !== size) card.style.setProperty('--quota-size', size);
    const mirrored = host.classList.contains('dshwv-left');
    card.classList.toggle('quota-left', mirrored);
    const left = Math.max(0, Math.min(window.innerWidth - width, bounds.left)) + 'px';
    const top = Math.max(0, Math.min(window.innerHeight - height, bounds.top)) + 'px';
    if(card.style.left!==left)card.style.left=left;
    if(card.style.top!==top)card.style.top=top;
  }
  function updateButtons() { for (const button of modeButtons) { button.disabled = switching; button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); } for(const el of document.querySelectorAll('[data-account-api]'))el.hidden=mode==='subscription';
    document.documentElement.dataset.accountMode = mode;
    for (const el of document.querySelectorAll('.whale-mode-description')) el.textContent = mode === 'subscription' ? '查看 5 小时 / 周额度与本机 token 用量' : '查看当前 API 余额与消费记录';
    for (const el of document.querySelectorAll('.whale-mode-open')) el.textContent = mode === 'subscription' ? '查看订阅额度 →' : '配置 API 余额 →';
  }
  function followCard(ownCard) {
    if (card !== ownCard) return;
    position(); window.requestAnimationFrame(() => followCard(ownCard));
  }
  function commit(next) {
    if (mode !== next) { latestQuota = null; percentages.clear(); }
    mode = next; try { localStorage.setItem(key, mode); } catch {}
    close(); latestNotice = null; updateButtons();
    window.dispatchEvent(new CustomEvent('whale-account-view', { detail: { mode } }));
  }
  async function setMode(next) {
    if (!validMode(next) || switching) return false;
    modeRevision++; switching = true; updateButtons(); if (status) status.textContent = '正在保存…';
    try {
      const response = await fetch('/api/display-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      if (!response.ok) throw Error('切换失败，请重试');
      const result = await response.json();
      if (result.ok === false || (result.mode || result.displayMode) !== next) throw Error('模式未保存，请重试');
      commit(next); if (status) status.textContent = next === 'subscription' ? '已切换。点击下方按钮查看额度。' : '已切换为 API 余额模式。'; return true;
    } catch (e) { if (status) status.textContent = e.message || '切换失败，请重试'; return false; }
    finally { switching = false; updateButtons(); }
  }
  function renderQuota(sub) {
      if (!content) return;
      content.replaceChildren();
      if (!sub.available) text(content, 'p', sub.reason || '暂时无法读取额度，请稍后刷新。');
      else {
        if (!(sub.windows || []).length) text(content, 'p', '暂无可用额度窗口');
        for (const item of sub.windows || []) {
          const section = text(content, 'section', ''); section.className = 'quota-window';
          const row = text(section, 'div', ''); row.className = 'quota-row';
          const label = text(row, 'span', quotaLabel(item));
          if (item.limitId && item.limitId !== 'codex') label.textContent = (item.limitName || item.limitId) + ' · ' + quotaLabel(item);
          const used = number(item.usedPercent);
          const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
          const value = text(row, 'strong', remaining === null ? '—' : remaining.toFixed(0) + '%'); value.className = 'quota-value';
          if (remaining !== null) {
            const previous = percentages.get(item.id);
            if (previous !== undefined && previous !== remaining && !matchMedia('(prefers-reduced-motion: reduce)').matches) value.animate([{ transform: 'translateY(-8px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
            percentages.set(item.id, remaining);
            const meter = document.createElement('progress'); meter.max = 100; meter.value = remaining; meter.setAttribute('aria-label', quotaLabel(item) + '剩余百分比'); section.append(meter);
            if (remaining <= 20) section.classList.add('quota-low');
          }
          text(section, 'small', '重置：' + date(item.resetsAt));
          section.title = quotaLabel(item) + ' · 重置：' + date(item.resetsAt);
          if (item.stale) text(section, 'small', '上次读取的数据 · 等待刷新').className = 'quota-stale';
        }
      }
      if (sub.observedAt) text(content, 'small', '更新于 ' + new Date(sub.observedAt).toLocaleTimeString('zh-CN', { hour12: false }) + ' · 60 秒自动刷新').className = 'quota-updated';
      position();
  }
  async function refresh(manual = false) {
    if (mode !== 'subscription' || !card) return;
    const own = ++generation;
    if (!content.children.length) {
      if (latestQuota) renderQuota(latestQuota);
      else text(content, 'p', '正在读取额度…');
    }
    if (refreshButton && scene === 'quota') refreshButton.disabled = true;
    if (updateStatus && scene === 'quota') updateStatus.textContent = '更新中';
    position();
    try {
      if (!quotaRequest) {
        quotaRequest = fetch('/api/quota' + (manual === true ? '?refresh=1' : ''), { cache: 'no-store' }).then(async response => {
          if (!response.ok) throw Error('暂时无法读取额度');
          const data = await response.json();
          if (data.ok === false) throw Error('暂时无法读取额度');
          return data.subscription || {};
        }).finally(() => { quotaRequest = null; });
      }
      const sub = await quotaRequest;
      // A read completed after the bubble closed still warms the next opening.
      if (mode !== 'subscription') return;
      latestQuota = sub.available ? sub : null;
      if (own !== generation || !card || scene !== 'quota') return;
      renderQuota(sub);
      if (updateStatus) updateStatus.textContent = (sub.windows || []).some(item => item.stale) ? '上次数据' : '';
    } catch (e) {
      if (own === generation && content && scene === 'quota') {
        if (!latestQuota) { content.replaceChildren(); text(content, 'p', e.message || '读取失败，请稍后重试'); }
        if (updateStatus) updateStatus.textContent = '更新失败';
        position();
      }
    } finally { if (own === generation && refreshButton) refreshButton.disabled = false; }
  }
  function toggleBubble(anchorRoot) {
    if (mode !== 'subscription') return false;
    if (card) return true;
    root = anchorRoot?.querySelector ? anchorRoot : document;
    card = document.createElement('section'); card.className = 'whale-account-card'; card.setAttribute('aria-label', 'Codex 剩余额度');
    card.title = '点击气泡查看文案，再点一次关闭';
    card.tabIndex = 0;
    card.addEventListener('click', event => {
      if (event.target.closest('button,a,input,select,textarea')) return;
      event.preventDefault(); event.stopPropagation();
      if (scene === 'random') close(); else advanceBubble();
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card || !['Enter',' '].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (scene === 'random') close(); else advanceBubble();
    });
    // Same silhouette, stroke, and three thought-bubble shapes as the MIT upstream.
    card.innerHTML = '<svg class="quota-thought" viewBox="0 0 1026 700" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#fff" stroke="#75469d" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/><ellipse cx="352" cy="561" rx="37.5" ry="26" fill="#fff" stroke="#75469d" stroke-width="18"/><ellipse cx="442" cy="646" rx="24.5" ry="18" fill="#fff" stroke="#75469d" stroke-width="18"/></svg>';
    const inside = text(card, 'div', ''); inside.className = 'quota-inside';
    const header = text(inside, 'div', ''); header.className = 'whale-account-header'; headerLabel = text(header, 'strong', '剩余额度');
    updateStatus = text(header, 'small', ''); updateStatus.className = 'quota-update-status'; updateStatus.setAttribute('role', 'status'); updateStatus.setAttribute('aria-live', 'polite');
    const actions = text(header, 'div', ''); actions.className = 'quota-actions';
    refreshButton = text(actions, 'button', '↻'); refreshButton.title = '刷新额度'; refreshButton.setAttribute('aria-label', '刷新额度'); refreshButton.onclick = () => {
      if (turnRecord?.id) dismissedTurns.add(turnRecord.id);
      clearTimeout(turnTimer); turnRecord = null; scene = 'quota'; headerLabel.textContent = '剩余额度';
      card.classList.remove('quota-random-scene'); content.className = 'quota-content';
      if (latestQuota) renderQuota(latestQuota); refresh(true);
    };
    content = text(inside, 'div', ''); content.className = 'quota-content';
    if (latestQuota) renderQuota(latestQuota);
    document.body.append(card); followCard(card); refresh(true); return true;
  }
  function advanceBubble() {
    if (!card) return;
    if (turnRecord?.id) dismissedTurns.add(turnRecord.id);
    clearTimeout(turnTimer); turnTimer = null; turnRecord = null;
    scene = 'random'; generation++;
    card.classList.add('quota-random-scene'); card.setAttribute('aria-label', '随机文字气泡');
    card.title = '点击气泡关闭'; updateStatus.textContent = '';
    content.replaceChildren(); content.className = 'quota-content quota-random-content';
    const phrase = window.WhaleBubbleText?.render(content);
    if (!phrase) text(content, 'p', 'GPT 已就位！');
    position();
    const own = card;
    requestAnimationFrame(() => {
      if (card !== own || scene !== 'random') return;
      const minimumFont = 11 * card.offsetWidth / 280;
      for (const row of content.querySelectorAll('.dshwv-trow')) {
        let fontSize = parseFloat(getComputedStyle(row).fontSize);
        for (let attempt = 0; attempt < 16 && fontSize > minimumFont &&
          (row.scrollHeight > content.clientHeight || row.scrollWidth > content.clientWidth); attempt++) {
          fontSize = Math.max(minimumFont, fontSize * .9); row.style.fontSize = fontSize + 'px';
        }
      }
      window.WhaleRendering?.presentFor(100);
    });
  }
  function notice(value) {
    if (mode !== 'subscription') return;
    latestNotice = value;
    if (quotaTurnEnabled) return;
    const message = noticeText(value);
    if (message) window.whaleToast?.(message);
    if (card) refresh();
  }
  function showTurn(record, closeMs = 5000) {
    if (mode !== 'subscription' || !record?.id || dismissedTurns.has(record.id)) return;
    if (!card) toggleBubble(document);
    clearTimeout(turnTimer); turnTimer = null;
    scene = 'turn'; turnRecord = record;
    card.classList.remove('quota-random-scene'); content.className = 'quota-content';
    headerLabel.textContent = record.concurrent ? '期间额度变化' : '本轮消耗（观测）';
    card.setAttribute('aria-label', '本轮额度消耗');
    card.title = record.note || '正在读取官方额度';
    content.replaceChildren();
    if (record.phase === 'updating') {
      text(content, 'p', '正在统计本轮额度…'); updateStatus.textContent = '更新中';
    } else {
      updateStatus.textContent = '';
      if (record.subscription?.available) latestQuota = record.subscription;
      const windows = record.windows || [];
      if (!windows.length) text(content, 'p', '未取到起止额度，暂无法确认');
      for (const item of windows) {
        const section = text(content, 'section', ''); section.className = 'quota-window quota-turn-window';
        const row = text(section, 'div', ''); row.className = 'quota-row'; text(row, 'span', quotaLabel(item));
        const known = typeof item.percentagePoints === 'number' && Number.isFinite(item.percentagePoints);
        const value = text(row, 'strong', known ? String(item.percentagePoints) + '%' :
          item.state === 'unchanged' ? '0%' : item.state === 'reset' ? '窗口已重置' : '待确认');
        value.className = 'quota-value quota-turn-value';
        if (!known && item.state !== 'unchanged') value.classList.add('quota-turn-message');
        section.title = item.state === 'unchanged' ? '官方百分比暂未变化，可能小于显示精度或尚未入账。' : record.note || '';
      }
      if (closeMs > 0) turnTimer = setTimeout(() => { if (turnRecord?.id === record.id) close(); }, closeMs);
    }
    position();
  }
  async function pollQuotaTurns() {
    if (turnPollPending || mode !== 'subscription') return;
    turnPollPending = true;
    try {
      const response = await fetch('/api/quota-turns?after=' + turnSequence, { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json(); if (!data.ok) return;
      quotaTurnEnabled = data.enabled === true;
      const first = !turnsAligned; turnsAligned = true;
      for (const record of data.records || []) {
        if (Number.isSafeInteger(record.seq)) turnSequence = Math.max(turnSequence, record.seq);
        if (!quotaTurnEnabled || first && record.completedAt < noticeStartedAt || Date.now() - record.completedAt > 120000) continue;
        showTurn(record, data.closeMs);
      }
      if (Number.isSafeInteger(data.seq)) turnSequence = Math.max(turnSequence, data.seq);
      if (!quotaTurnEnabled && scene === 'turn') close();
    } catch {} finally { turnPollPending = false; }
  }
  function init() {
    const style = document.createElement('style'); style.textContent = `.whale-account-card{position:fixed;z-index:2147483646;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid #9fcbd5;border-radius:16px;background:#f6fdff;color:#173d48;box-shadow:0 8px 26px #163f4433;font:13px/1.5 system-ui;pointer-events:none}.whale-account-card p{margin:8px 0}.whale-account-card small{display:block;color:#496873}.whale-account-card progress{width:100%;accent-color:#258b9c}.whale-account-header{display:flex;justify-content:space-between;align-items:center}.whale-account-card button,.whale-account-menu button{cursor:pointer;border:1px solid #9fcbd5;border-radius:8px;padding:5px 9px;background:#fff;color:#173d48}.whale-account-menu{font:12px/1.5 system-ui;padding:5px}.whale-account-menu summary{cursor:pointer}.whale-account-menu button[aria-pressed=true]{background:#237f91;color:white}.whale-account-menu small{display:block;max-width:230px;margin-top:5px}`; document.head.append(style);
    const menu = document.querySelector('.dshwv-menu');
    if (menu) {
      const details = text(menu, 'section', ''); details.className = 'whale-account-menu'; text(details, 'strong', 'Codex 额度 · 控制面板'); menu.prepend(details);
      const row = text(details, 'div', ''); row.setAttribute('role', 'group'); row.setAttribute('aria-label', '额度展示模式');
      for (const [value, label] of [['subscription', 'Codex 额度']]) { const button = text(row, 'button', label); button.dataset.mode = value; button.onclick = () => setMode(value); modeButtons.push(button); }
      text(details, 'p', '').className = 'whale-mode-description';
      const open = text(details, 'button', ''); open.className = 'whale-mode-open'; open.onclick = () => window.dispatchEvent(new Event(mode === 'subscription' ? 'whale-open-insights' : 'whale-open-settings'));
      status = text(details, 'small', '剩余额度百分比 · 官方接口 · 自动刷新'); status.setAttribute('role', 'status'); updateButtons();
      const view = menu.querySelector('.dshwv-menuview');
      if (view) {
        const rows = [...view.children];
        const groups = ['外观与位置', '声音与气泡', '用量与资源'].map(label => {
          const group = document.createElement('details'); group.className = 'whale-menu-group';
          text(group, 'summary', label); view.append(group); return group;
        });
        groups[0].open = true;
        for (const child of rows) {
          if (child.classList.contains('dshwv-menu-sep')) { child.remove(); continue; }
          const label = child.textContent;
          const index = /音效|音量|气泡|消耗提示|声音/.test(label) ? 1 : /币种|汇率|资源|工坊|API|额度|峰谷/.test(label) ? 2 : 0;
          groups[index].append(child);
        }
      }
    }
    const initialRevision = modeRevision;
    fetch('/api/display-mode', { cache: 'no-store' }).then(async response => { if (!response.ok) return; const data = await response.json(); const next = data.mode || data.displayMode; if (validMode(next) && !switching && modeRevision === initialRevision) { commit(next); if (next === 'subscription') toggleBubble(document); } }).catch(() => {});
    const styleQuota = document.createElement('style'); styleQuota.textContent = `
      .whale-account-card{--quota-size:280px;--dshw-u:calc(var(--quota-size) / 1026);width:var(--quota-size);height:calc(var(--quota-size) * 700 / 1026);max-width:none;max-height:none;padding:0;border:0;border-radius:0;background:transparent;color:#67418c;box-shadow:none;filter:drop-shadow(0 2px 6px #0002);font:calc(var(--dshw-u) * 48)/1.5 "Segoe UI","Microsoft YaHei",sans-serif;overflow:visible;animation:quota-appear .4s cubic-bezier(.34,1.56,.64,1)}
      .quota-thought{display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.quota-left .quota-thought{transform:scaleX(-1)}
      .quota-inside{position:absolute;left:11.25%;top:4%;width:66%;height:64%;display:flex;flex-direction:column;justify-content:center;text-align:center}.quota-left .quota-inside{left:22.75%}
      .whale-account-card .quota-inside,.whale-account-card .quota-inside *{pointer-events:none}.whale-account-card .quota-actions button{pointer-events:auto}
      .whale-account-header{justify-content:center;gap:calc(var(--dshw-u) * 18);margin-bottom:0;font-size:calc(var(--dshw-u) * 66);line-height:1.375}.quota-actions{display:flex;gap:calc(var(--dshw-u) * 7);position:absolute;right:calc(var(--dshw-u) * 11);top:25%;opacity:0;visibility:hidden}.whale-account-card:hover .quota-actions,.whale-account-card:focus-within .quota-actions{opacity:1;visibility:visible}
      .whale-account-card .quota-update-status{font-size:calc(var(--dshw-u) * 33);line-height:1.333;color:#a58aba;white-space:nowrap}.quota-update-status:empty{display:none}
      .whale-account-card button{border:0;background:transparent;color:#a58aba;padding:0;width:calc(var(--dshw-u) * 59);height:calc(var(--dshw-u) * 66);font-size:calc(var(--dshw-u) * 55);line-height:1.2}.whale-account-card button:hover{color:#573077}.whale-account-card button:disabled{opacity:.4}
      .quota-window:first-child .quota-row{display:flex;flex-direction:column;align-items:center;gap:0}.quota-row span{font-size:calc(var(--dshw-u) * 52);color:#a58aba}.quota-value{font-size:calc(var(--dshw-u) * 128);font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1;color:#67418c}
      .quota-window+.quota-window{margin-top:calc(var(--dshw-u) * 15)}.quota-window:not(:first-child) .quota-row{display:flex;justify-content:center;align-items:baseline;gap:calc(var(--dshw-u) * 22)}.quota-window:not(:first-child) .quota-value{font-size:calc(var(--dshw-u) * 62);font-weight:600}
      .quota-turn-window:first-child .quota-turn-message{font-size:calc(var(--dshw-u) * 77);line-height:1.5}
      .whale-account-card:has(.quota-turn-window) .whale-account-header{font-size:calc(var(--dshw-u) * 56)}
      .quota-turn-value:not(.quota-turn-message){color:#9e4b50}
      .whale-account-card{cursor:pointer;pointer-events:none}
      .quota-random-scene .whale-account-header>strong,.quota-random-scene .quota-update-status{display:none}
      .quota-random-content{display:flex;align-items:center;justify-content:center;height:100%;width:100%;text-align:center}
      .quota-random-content .dshwv-trow{max-width:100%!important;white-space:pre-wrap!important;overflow-wrap:anywhere;word-break:break-word;line-height:1.3;margin:0!important}
      .whale-account-card:focus-visible{outline:2px solid #a58aba;outline-offset:3px}
      .whale-account-card progress,.quota-window small,.whale-account-card .quota-updated{display:none}.quota-low .quota-value{color:#c87b8d}.quota-stale{display:block!important;color:#bd8592!important;font-size:calc(var(--dshw-u) * 33)!important}.quota-content>p{font-size:calc(var(--dshw-u) * 40);line-height:1.5;margin:0}
      .quota-window:first-child .quota-value:not(.quota-turn-value){background-image:linear-gradient(90deg,#573077,#70449b,#9469be,#b18acb,#d2b6e1,#d2b6e1,#b18acb,#9469be,#70449b,#573077);background-size:200% auto;background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:quota-number-flow 2.6s linear infinite;text-shadow:none}
      .quota-window.quota-low:first-child .quota-value:not(.quota-turn-value){background-image:linear-gradient(90deg,#a85b71,#c87b8d,#dda0b2,#c87b8d,#a85b71)}
      .quota-thought path,.quota-thought ellipse{pointer-events:visiblePainted}
      @keyframes quota-appear{from{opacity:0;transform:scale(.82) translateY(10px)}to{opacity:1;transform:none}}
      @keyframes quota-number-flow{0%{background-position:0% 0}100%{background-position:200% 0}}
      @media(prefers-reduced-motion:reduce){.whale-account-card,.quota-window:first-child .quota-value:not(.quota-turn-value){animation:none}.whale-account-card progress::-webkit-progress-value{transition:none}}
    `; document.head.append(styleQuota);
    setInterval(() => { if (mode === 'subscription' && card && scene === 'quota' && !document.hidden) refresh(); }, 60000);
    setInterval(pollQuotaTurns, 1000); pollQuotaTurns();
    window.addEventListener('resize', position);
    window.addEventListener('whale-mode-changing', close);
  }
  window.WhaleAccountView = { get mode() { return mode; }, toggleBubble, refresh, notice, close, setMode, quotaLabel, showTurn, pollQuotaTurns };
  // Deferred scripts run at readyState=interactive before the widget creates its menu.
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
