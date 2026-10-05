import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { MonitorStore } from './store.mjs';
import { demoState } from './demo.mjs';
import { render, selectView } from './tui.mjs';

export function parseArgs(args) {
  const options={codexHome:process.env.CODEX_HOME || path.join(os.homedir(),'.codex'),limit:24,interval:1500};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(['--help','-h','--demo','--once','--json'].includes(a))options[a==='-h'?'help':a.slice(2)]=true;
    else if(['--codex-home','--file','--limit','--interval','--session'].includes(a)){
      const v=args[++i];if(!v||v.startsWith('--'))throw new Error(`${a} requires a value`);
      if(a==='--limit'||a==='--interval')options[a.slice(2)]=Number(v);
      else options[a==='--codex-home'?'codexHome':a.slice(2)]=a==='--session'?v:path.resolve(v);
    }else throw new Error(`Unknown option: ${a}`);
  }
  if(!Number.isInteger(options.limit)||options.limit<1||options.limit>100)throw new Error('--limit must be 1..100');
  if(!Number.isInteger(options.interval)||options.interval<500||options.interval>60000)throw new Error('--interval must be 500..60000');
  return options;
}

export async function main(args=process.argv.slice(2)){
  const options=parseArgs(args);
  if(options.help){console.log('TokenTempo 0.1.0 — local reply-speed estimates\n\nnode src/cli.mjs [--demo] [--once | --json] [--codex-home DIR] [--file JSONL]\n                [--session ID] [--limit 24] [--interval 1500]\n\nArrow keys: switch session | A: automatic | F: final/all replies | D: details | R: refresh | Q: quit\nNo API key, browser, proxy or model calls. Missing timing stays unavailable.');return;}
  const store=options.demo?{state:demoState(),refresh:async()=>{}}:new MonitorStore(options.codexHome,{limit:options.limit,file:options.file});
  const view={selectedId:options.session??null,phase:'final_answer',details:false};
  if(options.once||options.json){await store.refresh();if(options.json)console.log(JSON.stringify({app:'TokenTempo',version:'0.1.0',...store.state},null,2));else console.log(render(store.state,view,{color:false}));return;}
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Interactive mode requires a terminal. Double-click Start-TokenTempo.cmd, or use --once / --json.');
  let stopped=false,painting=false,timer;
  const draw=()=>{if(stopped)return;const c=Math.max(1,(process.stdout.columns||116)-1),r=Math.max(1,(process.stdout.rows||36)-1);process.stdout.write('\x1b[H'+render(store.state,view,{columns:c,rows:r})+'\x1b[J');};
  const refresh=async()=>{if(painting||stopped)return;painting=true;try{await store.refresh();draw();}finally{painting=false;}};
  const cleanup=()=>{if(stopped)return;stopped=true;clearInterval(timer);process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('keypress',onKey);process.stdout.off('resize',draw);process.off('SIGINT',cleanup);process.off('SIGTERM',cleanup);process.stdout.write('\x1b[?25h\x1b[?1049l');};
  const onKey=(_str,key={})=>{
    if(key.name==='q'||key.name==='escape'||key.ctrl&&key.name==='c')return cleanup();
    if(key.name==='a')view.selectedId=null;
    if(key.name==='f')view.phase=view.phase==='all'?'final_answer':'all';
    if(key.name==='d')view.details=!view.details;
    if(key.name==='r'){store.lastDiscovery=0;void refresh();}
    if(['right','left','tab'].includes(key.name)&&store.state.sessions.length){
      const list=store.state.sessions;let index=list.findIndex(s=>s.id===selectView(store.state,view.selectedId).session?.id);index=(index+(key.name==='left'?-1:1)+list.length)%list.length;view.selectedId=list[index].id;
    }
    draw();
  };
  readline.emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  process.stdin.on('keypress',onKey);process.stdout.on('resize',draw);process.on('SIGINT',cleanup);process.on('SIGTERM',cleanup);
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J');draw();
  try{await refresh();if(!stopped)timer=setInterval(()=>void refresh(),options.interval);}catch(e){cleanup();throw e;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(`TokenTempo: ${e.message}`);process.exitCode=1;});
