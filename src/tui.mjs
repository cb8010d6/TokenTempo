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
  const newest=[...(session?.records??[])].filter(r=>r.outputTokens!=null).sort((a,b)=>b.completedAt-a.completedAt)[0];
  return {session, records, samples, newest, latest:samples[0], median:median(samples.slice(0,20).map(r=>r.tps))};
}

const englishLabels={mixed:'mixed tool call',multiple:'multiple messages',timing:'missing timing',usage:'missing usage',short:'too short',boundary:'unmatched records',legacy:'no response usage',empty:'no text tokens'};
const ascii=s=>safe(s).replaceAll('—','-').replaceAll('≈','~').replaceAll('·','|').replaceAll('–','-').replace(/[^\x20-\x7e]/gu,'?');
export function defaultLanguage(platform=process.platform,env=process.env){return platform==='win32'&&!env.WT_SESSION&&!env.TERM_PROGRAM?'en':'zh';}

function renderEnglish(state,view,{columns,rows,color,now}){
  const cols=Math.max(1,Math.min(columns,160)),inside=Math.max(0,cols-4);
  const {session,records,samples,newest,latest,median:med}=selectView(state,view.selectedId,view.phase);
  const out=[],paint=(s,c)=>color?`\x1b[${c}m${s}\x1b[0m`:s;
  const line=(s='',c='')=>{const text=fit(ascii(s),cols);out.push(c?paint(text,c):text);};
  const box=(s='',c='')=>line('  '+ascii(s),c),rule=()=>line('-'.repeat(cols),'38;5;240');
  if(cols<76||rows<24){line('TokenTempo','1;38;5;156');rule();line('Enlarge the terminal to at least 76 columns x 24 rows.');line(`Current: ${columns} x ${rows}`);line(`Estimated text rate: ~ ${fmt(latest?.tps)} tokens/s`);line('Q Quit | L Language');return out.slice(0,rows).join('\n');}
  box('TokenTempo / REPLY SPEED                                      v0.1.3  LOCAL ONLY','1;38;5;156');rule();
  box(state.demo?'DEMO / SYNTHETIC DATA':state.scanning?'Scanning recent local sessions...':'WORK + CODEX / ESTIMATED TEXT RATE','38;5;109');
  const idx=session?state.sessions.findIndex(s=>s.id===session.id)+1:0;
  box(`${view.selectedId?'PINNED':'AUTO'} ${idx}/${state.sessions.length} | ${session?.model??'waiting for session'} | ${session?.id?.slice(-12)??''}`);
  box(session?.status==='active'?'Turn running / counters update after each recorded model output':session?.status==='unknown'?'No recent log activity / current status unknown':'Waiting for the next model output','38;5;178');rule();
  box('LATEST OUTPUT TOKENS / INCLUDES TOOL ARGUMENTS','38;5;109');
  box(`Non-reasoning ${fmt(newest?.nonReasoningTokens)} | Total output ${fmt(newest?.outputTokens)} | Reasoning ${fmt(newest?.reasoningTokens)}`,'1;38;5;156');
  box(`Recorded: ${clock(newest?.completedAt)} | ${newest?.scope==='mixed'?'Text + tools':newest?.scope==='tools'?'Tools / other output':'Text output'} | Completed counters, not live`,'38;5;245');
  box(`This text rate: ${newest?.tps==null?'unavailable - '+(englishLabels[newest?.reason]??'missing data'):'~ '+fmt(newest.tps)+' tokens/s'} | Turn TTFT ${secs(newest?.turn?.ttftMs)}`);
  box(`Historical text: ~ ${fmt(latest?.tps)} tokens/s @ ${clock(latest?.completedAt)} | Median ${fmt(med)} t/s`);rule();
  box('RECENT REPLIES / ONE POINT PER COMPLETED REPLY','38;5;109');
  const vals=samples.slice(0,20).reverse().map(r=>r.tps),bars='._-:=+*#',max=Math.max(...vals,1);
  box(vals.length?vals.map(v=>bars[Math.min(7,Math.floor(v/max*7))]).join('  '):'-','38;5;156');
  box(vals.length?`Older -> Newer | Range ${fmt(Math.min(...vals))} - ${fmt(Math.max(...vals))} t/s`:'Input tokens and log refresh intervals are never used as output speed.','38;5;245');rule();
  box(`${view.phase==='all'?'ALL MODEL OUTPUTS':'FINAL REPLIES'} / ${records.length} recorded`,'38;5;109');
  const detailed=cols>=106,sizes=detailed?[18,14,16,13,13,inside-74]:[16,12,10,10,inside-48];
  const row=values=>values.map((v,i)=>fit(ascii(v),sizes[i])).join('');
  box(row(detailed?['Completed','Text t/s','Non-reasoning','Total output','Reasoning','Status']:['Completed','Text t/s','Non-reas.','Total','Status']),'38;5;245');
  if(!records.length)box('No replies. Use Left/Right to change session, F to change reply type.','38;5;245');
  for(const r of records.slice(0,Math.max(1,rows-25-(view.details?5:0)))){
    const status=r.quality==='estimate'?'estimate':englishLabels[r.reason]??'unavailable';
    box(row(detailed?[clock(r.completedAt),r.tps==null?'-':`~ ${fmt(r.tps)}`,fmt(r.nonReasoningTokens),fmt(r.outputTokens),fmt(r.reasoningTokens),status]:[clock(r.completedAt),r.tps==null?'-':`~ ${fmt(r.tps)}`,fmt(r.nonReasoningTokens),fmt(r.outputTokens),status]),r.quality==='estimate'?'38;5;152':'38;5;178');
  }
  if(view.details){rule();box('Non-reasoning = total output - reasoning; includes text and tool arguments.');box('Mixed/tool counters are shown. Their full generation timing is not recorded.');box('ESTIMATED TEXT RATE = non-reasoning / message seconds, only for pure text.');box(`Last text duration ${secs(latest?.durationMs)} | Its whole turn ${secs(latest?.turn?.durationMs)} | TTFT is turn-level.`);}
  while(out.length<rows-4)line();rule();
  box(state.warnings?.length?'Some logs unavailable or outside the recent-session limit.':session?.parseErrors?`${session.parseErrors} malformed records; affected samples excluded.`:'Completed samples only | Not instantaneous TPS | No credentials or model calls','38;5;245');
  box('Left/Right Session | A Auto | F Replies | D Details | L Language | R Refresh | Q Quit','38;5;109');
  box(`Updated ${clock(state.updatedAt)}${state.updatedAt&&now-state.updatedAt>10000?' | may be stale':''}`,'38;5;240');
  return out.slice(0,rows).join('\n');
}

export function render(state, view={}, {columns=116,rows=36,color=true,now=Date.now()}={}) {
  if(view.language==='en')return renderEnglish(state,view,{columns,rows,color,now});
  const cols=Math.max(32,Math.min(columns,160)), inside=cols-4;
  const {session,records,samples,newest,latest,median:med}=selectView(state,view.selectedId,view.phase);
  const out=[];
  const paint=(s,c)=>color?`\x1b[${c}m${s}\x1b[0m`:s;
  const line=(s='',c='')=>out.push(c?paint(fit(s,cols),c):fit(s,cols));
  const rule=()=>line('─'.repeat(cols),'38;5;240');
  const box=(s,c='')=>line(`  ${fit(s,inside)}`,c);
  if (cols<76 || rows<24) {
    line('TokenTempo · 词速表','1;38;5;156');rule();line('请放大窗口至至少 76 列 × 24 行。');line(`当前 ${columns} 列 × ${rows} 行`);line(`最近正文速度估算: ${fmt(latest?.tps)} tokens/s`);line('Q 退出');return out.slice(0,rows).join('\n');
  }
  line('  TokenTempo  /  词速表                                             v0.1.3  LOCAL ONLY','1;38;5;156');
  rule();
  box(state.demo?'DEMO · 虚构样例数据':state.scanning?'正在扫描最近的本地会话…':'WORK + CODEX  /  正文输出速度估算','38;5;109');
  const idx=session?state.sessions.findIndex(s=>s.id===session.id)+1:0;
  box(`${view.selectedId?'已固定':'自动跟随'} ${idx}/${state.sessions.length}  ·  ${safe(session?.model ?? '等待会话')}  ·  ${safe(session?.id?.slice(-12) ?? '')}`);
  const activity=session?.status==='active'?'本轮进行中 · 每次模型输出用量落盘后更新':session?.status==='unknown'?'日志长时间未更新 · 运行状态未知':'等待下一次模型输出 · 用量落盘后更新';
  box(activity,'38;5;178');
  rule();
  box('最新一次输出 token  /  包含工具调用参数','38;5;109');
  box(`非推理 ${fmt(newest?.nonReasoningTokens)}    总输出 ${fmt(newest?.outputTokens)}    推理 ${fmt(newest?.reasoningTokens)}`,'1;38;5;156');
  box(`记录: ${clock(newest?.completedAt)}  ·  ${newest?.scope==='mixed'?'正文＋工具':newest?.scope==='tools'?'工具／其他输出':'文字输出'}  ·  已完成计数，非实时`,'38;5;245');
  box(`本次正文速度: ${newest?.tps==null?'—（'+(labels[newest?.reason]??'数据不足')+'）':'≈ '+fmt(newest.tps)+' tokens/s'}    本轮 TTFT ${secs(newest?.turn?.ttftMs)}`);
  box(`历史正文 ≈ ${fmt(latest?.tps)} tokens/s  @ ${clock(latest?.completedAt)}    中位数 ${fmt(med)} t/s`);
  rule();
  box('历史正文速度  /  每个点是一条可计算的文字回复','38;5;109');
  const chartSamples=samples.slice(0,20).reverse();
  if(chartSamples.length){const vals=chartSamples.map(r=>r.tps),max=Math.max(...vals,1),bars='▁▂▃▄▅▆▇█';box(vals.map(v=>bars[Math.min(7,Math.floor(v/max*7))]).join('  '),'38;5;156');box(`较早 ← → 较新    范围 ${fmt(Math.min(...vals))} – ${fmt(Math.max(...vals))} t/s`,'38;5;245');}
  else {box('—');box('不使用输入 token，也不按日志刷新间隔计算速度。','38;5;245');}
  rule();
  const detailed=cols>=106;
  const headings=detailed?['完成时间', '正文 t/s', '非推理 token', '总输出 token', '推理 token', '数据状态']:['完成时间','正文 t/s','非推理','总输出','状态'];
  const sizes=detailed?[18,14,16,13,13,inside-74]:[16,12,10,10,inside-48];
  const row=values=>values.map((v,i)=>fit(v,sizes[i])).join('');
  box(`${view.phase==='all'?'所有模型输出（含工具）':'最终回复'}  /  已记录 ${records.length} 条`,'38;5;109');
  box(row(headings),'38;5;245');
  const budget=Math.max(1,rows-25-(view.details?5:0));
  if (!records.length) box('尚无记录。← → 切换会话；F 切换回复类型。','38;5;245');
  for(const r of records.slice(0,budget)){
    const v=detailed?[clock(r.completedAt),r.tps==null?'—':`≈ ${fmt(r.tps)}`,fmt(r.nonReasoningTokens),fmt(r.outputTokens),fmt(r.reasoningTokens),r.quality==='estimate'?'日志估算':labels[r.reason]||'无法计算']:[clock(r.completedAt),r.tps==null?'—':`≈ ${fmt(r.tps)}`,fmt(r.nonReasoningTokens),fmt(r.outputTokens),r.quality==='estimate'?'估算':labels[r.reason]||'无法计算'];
    box(row(v),r.quality==='estimate'?'38;5;152':'38;5;178');
  }
  if(view.details){rule();box('非推理 = 总输出 − 推理，包含正文和工具调用参数。');box('混合／纯工具输出显示计数；日志缺少对应完整生成时段，不计算速度。');box('纯正文速度估算 = 非推理 token / 正文消息秒数，不是实时解码速度。');box(`历史正文时段 ${secs(latest?.durationMs)} · 对应整轮 ${secs(latest?.turn?.durationMs)} · TTFT 为整轮值。`);}
  while(out.length<rows-4)line();
  rule();
  const warning=state.warnings?.[0] || (session?.parseErrors?`有 ${session.parseErrors} 条无法解析的日志，相关样本不计速度。`:'完成后更新 · 不是瞬时速度 · 不读取登录凭据或发起模型调用');
  box(warning,'38;5;245');
  box('← → 会话   A 自动跟随   F 回复类型   D 口径   L 中/EN   R 刷新   Q 退出','38;5;109');
  box(`更新 ${clock(state.updatedAt)}${state.updatedAt && now-state.updatedAt>10000?' · 数据可能过期':''}`,'38;5;240');
  return out.slice(0,rows).join('\n');
}
