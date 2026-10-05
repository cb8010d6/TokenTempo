import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMetrics } from '../src/metrics.mjs';

const base=Date.UTC(2026,0,1);
const row=(type,payload,ms=10000)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
function setup(){const s=new SessionMetrics('s1');s.ingest(row('event_msg',{type:'task_started',turn_id:'t1',started_at:new Date(base).toISOString()},0));s.ingest(row('turn_context',{model:'synthetic-model'},0));return s;}
function message(s,id='m1',start=1000,end=6000,phase='final_answer'){
  s.ingest(row('response_item',{type:'message',role:'assistant',id,phase},end));
  s.ingest(row('event_msg',{type:'item_completed',turn_id:'t1',item:{type:'AgentMessage',id,phase},started_at_ms:base+start,completed_at_ms:base+end},end));
}
function usage(s,overrides={}){s.ingest(row('token_usage_record',{thread_id:'s1',turn_id:'t1',response_id:'r1',usage:{input_tokens:80000,cached_input_tokens:70000,output_tokens:300,reasoning_output_tokens:100},...overrides},7000));}

test('text-only response divides non-reasoning tokens by its own message duration',()=>{const s=setup();message(s);usage(s);const r=s.records[0];assert.equal(r.tps,40);assert.equal(r.textTokens,200);assert.equal(r.durationMs,5000);});
test('huge input and cached token counts do not inflate output rate',()=>{const s=setup();message(s);usage(s,{usage:{input_tokens:9e12,cached_input_tokens:8e12,total_tokens:9e12+300,output_tokens:300,reasoning_output_tokens:100}});assert.equal(s.records[0].tps,40);});
test('duplicate response usage and legacy token_count do not double count',()=>{const s=setup();message(s);usage(s);usage(s);s.ingest(row('event_msg',{type:'token_count',info:{last_token_usage:{output_tokens:300}}}));assert.equal(s.records.length,1);});
test('tool parameters are never attributed to the visible message',()=>{const s=setup();message(s);s.ingest(row('response_item',{type:'function_call',id:'tool',arguments:'large synthetic call'}));usage(s);assert.equal(s.records[0].tps,null);assert.equal(s.records[0].reason,'mixed');});
test('custom tool calls and unknown model output are rejected',()=>{for(const type of ['custom_tool_call','image_generation_call','unknown_output']){const s=setup();message(s);s.ingest(row('response_item',{type}));usage(s);assert.equal(s.records[0].reason,'mixed');}});
test('multiple text messages cannot borrow the full response usage',()=>{const s=setup();message(s);message(s,'m2');usage(s);assert.equal(s.records[0].tps,null);assert.equal(s.records[0].reason,'multiple');});
test('missing reasoning counter stays unknown instead of assuming zero',()=>{const s=setup();message(s);usage(s,{usage:{output_tokens:200}});assert.equal(s.records[0].reason,'usage');});
test('invalid token counters never yield a plausible-looking rate',()=>{for(const u of [{output_tokens:1,reasoning_output_tokens:2},{output_tokens:-1,reasoning_output_tokens:0},{output_tokens:'200',reasoning_output_tokens:0},{output_tokens:NaN,reasoning_output_tokens:0}]){const s=setup();message(s);usage(s,{usage:u});assert.equal(s.records[0].tps,null);}});
test('missing or zero-duration timing does not become infinity',()=>{const s=setup();message(s,'m1',1000,1000);usage(s);assert.equal(s.records[0].reason,'timing');assert.equal(s.records[0].tps,null);});
test('sub-250ms samples are excluded instead of creating inflated spikes',()=>{const s=setup();message(s,'m1',1000,1100);usage(s);assert.equal(s.records[0].reason,'short');});
test('mismatched message IDs cannot be paired',()=>{const s=setup();message(s);const t=s.cycle.timings.get('m1');s.cycle.timings.clear();s.cycle.timings.set('other',t);usage(s);assert.equal(s.records[0].tps,null);});
test('wrong turn or thread is rejected',()=>{for(const o of [{turn_id:'different'},{thread_id:'different'}]){const s=setup();message(s);usage(s,o);assert.equal(s.records[0].reason,'boundary');}});
test('message ending after usage boundary is rejected',()=>{const s=setup();message(s,'m1',1000,8000);usage(s);assert.equal(s.records[0].reason,'boundary');});
test('task duration and TTFT are attached as turn metrics, not used in text-rate denominator',()=>{const s=setup();message(s);usage(s);s.ingest(row('event_msg',{type:'task_complete',turn_id:'t1',duration_ms:999000,time_to_first_token_ms:5000}));const snap=s.snapshot();assert.equal(snap.records[0].tps,40);assert.deepEqual(snap.records[0].turn,{durationMs:999000,ttftMs:5000});assert.equal(snap.status,'idle');});
test('missing TTFT stays null, actual zero stays zero',()=>{for(const t of [undefined,0]){const s=setup();message(s);usage(s);s.ingest(row('event_msg',{type:'task_complete',turn_id:'t1',time_to_first_token_ms:t}));assert.equal(s.snapshot().records[0].turn.ttftMs,t??null);}});
test('legacy-only final replies are explicitly unavailable',()=>{const s=setup();message(s);s.ingest(row('event_msg',{type:'token_count'}));s.ingest(row('event_msg',{type:'task_complete',turn_id:'t1'}));assert.equal(s.records[0].reason,'legacy');assert.equal(s.records[0].tps,null);});
test('new turn never reuses pending prior-turn message tokens',()=>{const s=setup();message(s);s.ingest(row('event_msg',{type:'task_started',turn_id:'t2'},8000));usage(s,{turn_id:'t2'});assert.equal(s.records.length,1);assert.equal(s.records[0].reason,'legacy');});
test('snapshots never expose text, tool arguments, input tokens, or file paths',()=>{const s=setup();s.ingest(row('response_item',{type:'message',role:'user',content:'PRIVATE_INPUT'}));message(s);usage(s);const json=JSON.stringify(s.snapshot());for(const text of ['PRIVATE_INPUT','input_tokens','content','arguments','cwd'])assert.equal(json.includes(text),false);});
test('phase can come from item completion when absent on raw response item',()=>{const s=setup();message(s);s.cycle.messages.set('m1',{phase:null});usage(s);assert.equal(s.records[0].phase,'final_answer');});
test('idle or incomplete turns never erase the previous completed rate with zero',()=>{const s=setup();message(s);usage(s);s.ingest(row('event_msg',{type:'task_started',turn_id:'t2'},8000));assert.equal(s.records[0].tps,40);assert.equal(s.snapshot(base+9000).status,'active');});
