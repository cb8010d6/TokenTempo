// A dependency-free terminal view. Log-sourced strings are stripped of terminal controls.
const ansi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
export function safe(value) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\p{Mark}/gu, '');
}
function wide(cp) {
  return cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x1f000);
}
export function width(s) { return [...s.replace(ansi, '')].reduce((n,c)=>n+(wide(c.codePointAt(0))?2:1),0); }
export function fit(value, size) {
  if (size <= 0) return '';
  const text = safe(value);
  let out = '', used = 0;
  for (const c of text) { const w = wide(c.codePointAt(0)) ? 2 : 1; if (used + w > size) break; out += c; used += w; }
  return out + ' '.repeat(Math.max(0,size-used));
}
const fmt = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:1}) : '—';
const secs = ms => ms == null ? '—' : `${fmt(ms/1000)} s`;
const clock = ms => ms == null ? '—' : new Date(ms).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
export const labels = {mixed:'混有工具调用',multiple:'多段消息无法分配',timing:'缺少消息时间',usage:'缺少 token 明细',short:'时段过短',boundary:'无法配对记录',legacy:'缺少逐回复用量',empty:'无正文 token'};
function median(list) { const a=list.slice().sort((x,y)=>x-y),n=a.length;return n ? n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null; }

export function selectView(state, selectedId = null, phase = 'final_answer') {
  const session = selectedId ? state.sessions.find(s=>s.id===selectedId) : state.sessions[0];
  const records = (session?.records ?? []).filter(r=>phase==='all'||r.phase===phase).sort((a,b)=>b.completedAt-a.completedAt);
  const samples = records.filter(r=>r.quality==='estimate' && Number.isFinite(r.tps));
  return {session, records, samples, latest:samples[0], median:median(samples.slice(0,20).map(r=>r.tps))};
}

export function render(state, view={}, {columns=116,rows=36,color=true,now=Date.now()}={}) {
  const cols=Math.max(32,Math.min(columns,160)), inside=cols-4;
  const {session,records,samples,latest,median:med}=selectView(state,view.selectedId,view.phase);
  const out=[];
  const paint=(s,c)=>color?`\x1b[${c}m${s}\x1b[0m`:s;
  const line=(s='',c='')=>out.push(c?paint(fit(s,cols),c):fit(s,cols));
  const rule=()=>line('─'.repeat(cols),'38;5;240');
  const box=(s,c='')=>line(`  ${fit(s,inside)}`,c);
  if (cols<76 || rows<24) {
    line('TokenTempo · 词速表','1;38;5;156');rule();line('请放大窗口至至少 76 列 × 24 行。');line(`当前 ${columns} 列 × ${rows} 行`);line(`最近正文速度估算: ${fmt(latest?.tps)} tokens/s`);line('Q 退出');return out.slice(0,rows).join('\n');
  }
  line('  TokenTempo  /  词速表                                             v0.1.0  LOCAL ONLY','1;38;5;156');
  rule();
  box(state.demo?'DEMO · 虚构样例数据':state.scanning?'正在扫描最近的本地会话…':'WORK + CODEX  /  正文输出速度估算','38;5;109');
  const idx=session?state.sessions.findIndex(s=>s.id===session.id)+1:0;
  box(`${view.selectedId?'已固定':'自动跟随'} ${idx}/${state.sessions.length}  ·  ${safe(session?.model ?? '等待会话')}  ·  ${safe(session?.id?.slice(-12) ?? '')}`);
  const activity=session?.status==='active'?'本轮进行中 · 下面保留上次完成的速度':session?.status==='unknown'?'日志长时间未更新 · 运行状态未知':'等待下一条回复 · 完成后自动更新';
  box(activity,'38;5;178');
  rule();
  box('最近可计算的正文速度  /  ESTIMATED TEXT RATE','38;5;109');
  box(`≈ ${fmt(latest?.tps)} tokens/s`,'1;38;5;156');
  box(latest?`样本: ${clock(latest.completedAt)}  ·  ${safe(latest.model)}`:'尚无可计算样本。完成一次文本回复后再看这里。','38;5;245');
  box(`正文近似 ${fmt(latest?.textTokens)} tokens    输出时段 ${secs(latest?.durationMs)}    本轮 TTFT ${secs(latest?.turn?.ttftMs)}`);
  box(`最近 20 条中位数 ${fmt(med)} t/s    整轮用时 ${secs(latest?.turn?.durationMs)}    可计算 ${samples.length}/${records.length}`);
  rule();
  box('最近回复速度  /  每个点是一条完成的回复','38;5;109');
  const chartSamples=samples.slice(0,20).reverse();
  if(chartSamples.length){const vals=chartSamples.map(r=>r.tps),max=Math.max(...vals,1),bars='▁▂▃▄▅▆▇█';box(vals.map(v=>bars[Math.min(7,Math.floor(v/max*7))]).join('  '),'38;5;156');box(`较早 ← → 较新    范围 ${fmt(Math.min(...vals))} – ${fmt(Math.max(...vals))} t/s`,'38;5;245');}
  else {box('—');box('不使用输入 token，也不按日志刷新间隔计算速度。','38;5;245');}
  rule();
  const detailed=cols>=106;
  const headings=detailed?['完成时间', '正文 t/s', '非推理 token', '输出时段', '整轮用时', '数据状态']:['完成时间','正文 t/s','token','时段','状态'];
  const sizes=detailed?[18,14,16,13,13,inside-74]:[16,12,10,10,inside-48];
  const row=values=>values.map((v,i)=>fit(v,sizes[i])).join('');
  box(`${view.phase==='all'?'所有文本回复':'最终回复'}  /  已记录 ${records.length} 条`,'38;5;109');
  box(row(headings),'38;5;245');
  const budget=Math.max(1,rows-25-(view.details?5:0));
  if (!records.length) box('尚无记录。← → 切换会话；F 切换回复类型。','38;5;245');
  for(const r of records.slice(0,budget)){
    const v=detailed?[clock(r.completedAt),r.tps==null?'—':`≈ ${fmt(r.tps)}`,fmt(r.textTokens),secs(r.durationMs),secs(r.turn?.durationMs),r.quality==='estimate'?'日志估算':labels[r.reason]||'无法计算']:[clock(r.completedAt),r.tps==null?'—':`≈ ${fmt(r.tps)}`,fmt(r.textTokens),secs(r.durationMs),r.quality==='estimate'?'估算':labels[r.reason]||'无法计算'];
    box(row(v),r.quality==='estimate'?'38;5;152':'38;5;178');
  }
  if(view.details){rule();box('公式: (本次 output_tokens − reasoning_output_tokens) / 正文消息秒数');box('仅配对单段纯文本输出；混合工具、时间缺失或小于 250 ms 时不算速度。');box('消息生命周期不等于逐 token 到达时间，非推理输出可能含协议开销。');box('TTFT 是整轮客户端记录；本工具不测服务端解码速度。');}
  while(out.length<rows-4)line();
  rule();
  const warning=state.warnings?.[0] || (session?.parseErrors?`有 ${session.parseErrors} 条无法解析的日志，相关样本不计速度。`:'完成后更新 · 不是瞬时速度 · 不读取登录凭据或发起模型调用');
  box(warning,'38;5;245');
  box('← → 会话   A 自动跟随   F 回复类型   D 口径说明   R 刷新   Q 退出','38;5;109');
  box(`更新 ${clock(state.updatedAt)}${state.updatedAt && now-state.updatedAt>10000?' · 数据可能过期':''}`,'38;5;240');
  return out.slice(0,rows).join('\n');
}
