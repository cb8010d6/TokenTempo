import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LogTail, MonitorStore } from '../src/store.mjs';

test('split JSON and UTF-8 survive appends; incomplete final line waits',()=>{
  const tail=new LogTail('synthetic.jsonl');const record=Buffer.from(JSON.stringify({type:'turn_context',payload:{model:'测试模型'}})+'\n');
  for(const byte of record.subarray(0,-1))tail.feed(Buffer.from([byte]));
  assert.equal(tail.metrics.model,'未知模型');tail.feed(record.subarray(-1));assert.equal(tail.metrics.model,'测试模型');assert.equal(tail.metrics.errors,0);
});
test('malformed line invalidates current cycle and later lines still parse',()=>{
  const tail=new LogTail('synthetic.jsonl');tail.feed(Buffer.from('not-json\n'+JSON.stringify({type:'turn_context',payload:{model:'recovered'}})+'\n'));assert.equal(tail.metrics.errors,1);assert.equal(tail.metrics.cycle.mixed,true);assert.equal(tail.metrics.model,'recovered');
});
test('file append is incremental and truncation resets parser state',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tokentempo-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'rollout-synthetic.jsonl');
  await fs.writeFile(file,JSON.stringify({type:'turn_context',payload:{model:'a-long-initial-model-name'}})+'\n');const tail=new LogTail(file);await tail.read();const p=tail.position;await tail.read();assert.equal(tail.position,p);
  await fs.appendFile(file,JSON.stringify({type:'turn_context',payload:{model:'appended'}})+'\n');await tail.read();assert.equal(tail.metrics.model,'appended');
  await fs.writeFile(file,JSON.stringify({type:'turn_context',payload:{model:'new'}})+'\n');await tail.read();assert.equal(tail.metrics.model,'new');
});
test('missing source is a clear empty state, not fabricated samples',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tokentempo-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new MonitorStore(dir);await store.refresh();assert.equal(store.state.sessions.length,0);assert.equal(store.state.scanning,false);assert.ok(store.state.warnings.length);});
test('internal sessions are filtered before applying the recent-session limit',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tokentempo-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'sessions'));
  for(const [name,source,age] of [['user','cli',10],['guardian',{subagent:{other:'guardian'}},1]]){const file=path.join(dir,'sessions',`rollout-${name}.jsonl`);await fs.writeFile(file,JSON.stringify({type:'session_meta',payload:{id:name,source}})+'\n');await fs.utimes(file,new Date(Date.now()-age*1000),new Date(Date.now()-age*1000));}
  const store=new MonitorStore(dir,{limit:1});await store.refresh();assert.equal(store.state.sessions[0].id,'user');
  const all=new MonitorStore(dir,{limit:1,includeInternal:true});await all.refresh();assert.equal(all.state.sessions[0].id,'guardian');
});
