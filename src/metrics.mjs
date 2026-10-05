// Only counters and identifiers survive parsing; conversation content is discarded.
const number = value => typeof value === 'number' && Number.isFinite(value);
const counter = value => number(value) && Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const newCycle = () => ({ messages: new Map(), timings: new Map(), mixed: false });

export const reasons = {
  mixed: '同一次输出含工具调用或其他内容，无法单独分配正文 token',
  multiple: '同一次输出有多段消息，无法单独分配 token',
  timing: '缺少与消息 ID 对应的完整时间戳',
  usage: '缺少有效的输出或推理 token 明细',
  short: '输出时段短于 250 毫秒，速度不稳定',
  boundary: '回复与用量的轮次或时间边界无法确认',
  legacy: '此记录没有可配对的逐回复用量，仅有旧版或汇总数据',
  empty: '没有可计量的正文输出',
};

export class SessionMetrics {
  constructor(id = 'unknown') {
    this.id = id;
    this.model = '未知模型';
    this.records = [];
    this.active = false;
    this.turnId = null;
    this.cycle = newCycle();
    this.seen = new Set();
    this.lastEventAt = null;
    this.turns = new Map();
    this.errors = 0;
    this.legacyOnly = false;
  }

  ingest(row) {
    const p = row?.payload;
    if (!p || typeof p !== 'object') return;
    const time = stamp(row.timestamp);
    if (number(time)) this.lastEventAt = Math.max(this.lastEventAt ?? 0, time);
    if (row.type === 'session_meta') {
      this.id = typeof p.id === 'string' ? p.id : this.id;
      return;
    }
    if (row.type === 'turn_context') {
      if (typeof p.model === 'string') this.model = p.model;
      return;
    }
    if (row.type === 'token_usage_record') return this.consumeUsage(p, time);
    if (row.type === 'response_item') {
      if (p.type === 'message' && p.role === 'assistant') {
        if (typeof p.id === 'string') this.cycle.messages.set(p.id, { phase: p.phase ?? null });
        else this.cycle.mixed = true;
      } else if (p.type === 'message' && p.role === 'user') {
        // Mid-turn steering is a new input boundary, never extend the prior response window.
        this.cycle = newCycle();
      } else if (!['reasoning', 'function_call_output', 'custom_tool_call_output', 'message'].includes(p.type)) {
        this.cycle.mixed = true;
      }
      return;
    }
    if (row.type !== 'event_msg') return;
    if (p.type === 'task_started') {
      this.flushUnpaired(time);
      this.cycle = newCycle();
      this.turnId = p.turn_id;
      this.active = true;
      this.startedAt = stamp(p.started_at) || time;
    } else if (p.type === 'item_completed' && p.item?.type === 'AgentMessage') {
      this.cycle.timings.set(p.item.id, {
        start: p.started_at_ms, end: p.completed_at_ms, turnId: p.turn_id,
        phase: p.item.phase ?? 'unknown',
      });
    } else if (p.type === 'token_count') {
      this.legacyOnly = this.seen.size === 0;
    } else if (['task_complete', 'task_aborted', 'turn_aborted'].includes(p.type)) {
      if (p.turn_id && this.turnId && p.turn_id !== this.turnId) return;
      this.flushUnpaired(time);
      this.active = false;
      if (p.type === 'task_complete' && this.turnId) {
        this.turns.set(this.turnId, {
          durationMs: number(p.duration_ms) && p.duration_ms >= 0 ? p.duration_ms : null,
          ttftMs: number(p.time_to_first_token_ms) && p.time_to_first_token_ms >= 0 ? p.time_to_first_token_ms : null,
        });
      }
      this.cycle = newCycle();
    }
  }

  add(record) {
    this.records.push(record);
    if (this.records.length > 100) this.records.shift();
    if (this.turns.size > 120) this.turns.delete(this.turns.keys().next().value);
  }

  consumeUsage(p, time) {
    if (typeof p.response_id !== 'string' || this.seen.has(p.response_id)) return;
    this.seen.add(p.response_id);
    const c = this.cycle;
    this.cycle = newCycle();
    this.legacyOnly = false;
    if (!c.messages.size && !c.timings.size) return; // Tool-only calls do not become reply samples.
    const entries = [...c.messages.entries()];
    const [messageId, msg] = entries[0] ?? [...c.timings.entries()][0];
    const timing = c.timings.get(messageId);
    const u = p.usage ?? {};
    let reason = null;
    if (c.mixed) reason = 'mixed';
    else if (entries.length !== 1 || c.timings.size !== 1) reason = 'multiple';
    else if (!p.turn_id || p.turn_id !== this.turnId || timing?.turnId !== p.turn_id || (p.thread_id && p.thread_id !== this.id)) reason = 'boundary';
    else if (!counter(u.output_tokens) || !counter(u.reasoning_output_tokens) || u.reasoning_output_tokens > u.output_tokens) reason = 'usage';
    else if (!timing || !number(timing.start) || !number(timing.end) || timing.end <= timing.start) reason = 'timing';
    else if (!number(time) || timing.end > time || (number(this.startedAt) && timing.start < this.startedAt)) reason = 'boundary';
    else if (timing.end - timing.start < 250) reason = 'short';
    const outputTokens = counter(u.output_tokens) ? u.output_tokens : null;
    const reasoningTokens = counter(u.reasoning_output_tokens) ? u.reasoning_output_tokens : null;
    const textTokens = outputTokens !== null && reasoningTokens !== null && reasoningTokens <= outputTokens ? outputTokens - reasoningTokens : null;
    if (!reason && !textTokens) reason = 'empty';
    const durationMs = timing && number(timing.end) && number(timing.start) && timing.end > timing.start ? timing.end - timing.start : null;
    this.add({
      id: p.response_id, messageId, turnId: p.turn_id, model: this.model,
      phase: msg?.phase ?? timing?.phase ?? 'unknown', completedAt: timing?.end ?? time,
      textTokens, outputTokens, reasoningTokens, durationMs,
      tps: reason ? null : textTokens / (durationMs / 1000),
      quality: reason ? 'unavailable' : 'estimate', reason,
    });
  }

  flushUnpaired(time) {
    for (const [id, message] of this.cycle.messages) {
      const t = this.cycle.timings.get(id);
      this.add({ id: `unpaired-${id}`, messageId: id, turnId: this.turnId,
        model: this.model, phase: message.phase, completedAt: t?.end ?? time,
        tps: null, textTokens: null, outputTokens: null, reasoningTokens: null,
        durationMs: null, quality: 'unavailable', reason: 'legacy' });
    }
  }

  snapshot(now = Date.now()) {
    return { id: this.id, model: this.model, lastEventAt: this.lastEventAt,
      status: this.active ? (now - this.lastEventAt > 15 * 60 * 1000 ? 'unknown' : 'active') : 'idle',
      startedAt: this.startedAt ?? null, legacyOnly: this.legacyOnly, parseErrors: this.errors,
      records: this.records.map(r => ({ ...r, turn: this.turns.get(r.turnId) ?? null })),
    };
  }
}
