// Percentages are account-window observations, not a per-request billing meter.
export function quotaDifference(before, after) {
  const previous = new Map((before?.windows || []).map(w => [w.id, w]));
  return (after?.windows?.length ? after.windows : before?.windows || []).map(w => {
    const old = previous.get(w.id);
    const reset = old && (Number.isFinite(old.resetsAt) && old.resetsAt <= (after?.observedAt || Date.now()) ||
      Number.isFinite(old.resetsAt) && Number.isFinite(w.resetsAt) && Math.abs(old.resetsAt - w.resetsAt) > 60000);
    const valid = before?.available && after?.available && old && !old.stale && !w.stale && !reset &&
      Number.isFinite(old.usedPercent) && Number.isFinite(w.usedPercent) && w.usedPercent >= old.usedPercent;
    return { id: w.id, limitId: w.limitId, limitName: w.limitName, label: w.label,
      windowDurationMins: w.windowDurationMins, remainingPercent: w.remainingPercent,
      percentagePoints: valid ? Math.round((w.usedPercent - old.usedPercent) * 1000) / 1000 : null,
      state: valid ? w.usedPercent === old.usedPercent ? 'unchanged' : 'observed' : reset ? 'reset' : 'unknown' };
  });
}

export function createQuotaTurnTracker(quota, { clock = Date.now } = {}) {
  const active = new Map(), completed = new Set(), settling = new Set();
  const trackingStartedAt = clock();
  let records = [], sequence = 0, closed = false;
  const safeGet = () => Promise.resolve().then(() => quota.get({ force: true })).catch(() => ({ available: false, windows: [] }));
  function begin(meta) {
    if (closed || !meta?.id || meta.isSubagent || meta.historical || active.has(meta.id) || completed.has(meta.id)) return;
    const cached = quota.peek?.();
    const recent = cached?.available && Number.isFinite(cached.observedAt) && clock() - cached.observedAt <= 60000;
    const concurrent = active.size > 0;
    const partial = meta.partial || Number.isFinite(meta.startedAt) && meta.startedAt < trackingStartedAt - 1000;
    for (const entry of active.values()) entry.concurrent = true;
    for (const entry of settling) entry.concurrent = true;
    active.set(meta.id, { concurrent, identity: quota.identity?.(),
      before: partial ? Promise.resolve(null) : recent ? Promise.resolve(cached) : safeGet() });
  }
  function publish(record) {
    const next = { ...record, seq: ++sequence };
    records = [...records.filter(r => r.id !== next.id), next].slice(-32);
    return next;
  }
  async function end(meta) {
    if (closed || !meta?.id || meta.isSubagent || meta.historical || completed.has(meta.id)) return;
    const entry = active.get(meta.id); active.delete(meta.id);
    if (meta.outcome !== 'completed' || meta.notify === false) return;
    completed.add(meta.id); if (completed.size > 512) completed.delete(completed.values().next().value);
    if (entry) settling.add(entry);
    const base = { id: meta.id, completedAt: meta.ts || clock(), concurrent: !!entry?.concurrent };
    publish({ ...base, phase: 'updating', windows: [] });
    // Wait for the baseline first: short turns must not reuse the same in-flight
    // RPC for both their beginning and their end.
    let before = entry ? await entry.before : null;
    const after = await safeGet();
    if (entry) settling.delete(entry);
    if (closed) return;
    if (entry?.identity !== quota.identity?.()) before = null;
    const windows = quotaDifference(before, after);
    const concurrent = base.concurrent || !!entry?.concurrent;
    publish({ ...base, concurrent, phase: 'complete', windows, subscription: after,
      note: concurrent ? '期间有并行任务；这是账户窗口的变化，包含并行用量。' :
        '本轮期间观察到的账户额度变化；官方百分比可能延迟更新，也可能包含其他设备用量。' });
  }
  return { begin, end, read(after = 0) { return { ok: true, seq: sequence, records: records.filter(r => r.seq > after) }; },
    close() { closed = true; active.clear(); settling.clear(); records = []; completed.clear(); } };
}
