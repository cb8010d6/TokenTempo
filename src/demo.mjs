export function demoState() {
  const now = Date.now();
  const values = [31.2, 34.5, 32.8, 36.1, 35.4, 38.7, 33.7, 37.2];
  return { demo: true, scanning: false, warnings: [], updatedAt: now,
    sessions: [{ id: 'demo-session-01', model: 'Demo model', status: 'idle', lastEventAt: now,
      records: values.map((tps, i) => ({ id: `demo-${i}`, turnId: `turn-${i}`, model: 'Demo model', phase: 'final_answer',
        completedAt: now - (values.length - i) * 60000, tps, quality: 'estimate', reason: null,
        textTokens: Math.round(tps * 15), outputTokens: Math.round(tps * 15) + 100, reasoningTokens: 100,
        durationMs: 15000, turn: { durationMs: 24500, ttftMs: 5200 } })) }] };
}
