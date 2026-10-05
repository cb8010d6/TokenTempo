import test from 'node:test';
import assert from 'node:assert/strict';
import { render, width, fit, selectView, safe, defaultLanguage } from '../src/tui.mjs';
import { parseArgs } from '../src/cli.mjs';
import { demoState } from '../src/demo.mjs';

test('terminal rows stay within available dimensions including Chinese text',()=>{for(const [columns,rows] of [[116,36],[80,25],[50,18],[140,45]]){const output=render(demoState(),{details:true},{columns,rows,color:false});const lines=output.split('\n');assert.ok(lines.length<=rows);for(const l of lines)assert.ok(width(l)<=columns,`${width(l)} > ${columns}`);}});
test('latest sample retains numeric TPS, never K/s input throughput',()=>{const state=demoState();assert.equal(selectView(state).latest.tps,37.2);const output=render(state,{}, {color:false});assert.match(output,/37\.2 tokens\/s/);assert.doesNotMatch(output,/K\/s/);});
test('terminal controls are stripped from log-sourced fields',()=>{assert.ok(!safe('\x1b]52;injected\x07').includes('\x1b'));assert.equal(width(fit('中A',4)),4);});
test('invalid CLI arguments fail before scanning files',()=>{for(const args of [['--limit','0'],['--interval','1'],['--file'],['--unknown']])assert.throws(()=>parseArgs(args));assert.equal(parseArgs(['--demo']).demo,true);});
test('phase filtering hides tool-mixed commentary by default',()=>{const state=demoState();state.sessions[0].records.push({id:'c',phase:'commentary',tps:1000,quality:'estimate',completedAt:Date.now()});assert.equal(selectView(state).latest.tps,37.2);assert.equal(selectView(state,null,'all').latest.tps,1000);});
test('English compatibility view contains ASCII only, including charts and warnings',()=>{for(const details of [false,true]){const state=demoState();state.warnings=['部分日志超过限制'];const output=render(state,{language:'en',details},{color:false});assert.match(output,/ESTIMATED TEXT RATE/);assert.doesNotMatch(output,/[^\x20-\x7e\n]/);}});
test('English empty and small-window views also stay ASCII',()=>{const state={sessions:[],warnings:[],scanning:true};for(const [columns,rows] of [[80,30],[50,18]])assert.doesNotMatch(render(state,{language:'en'},{color:false,columns,rows}),/[^\x20-\x7e\n]/);});
test('legacy Windows gets ASCII while modern terminals keep Chinese; CLI override is explicit',()=>{assert.equal(defaultLanguage('win32',{}),'en');assert.equal(defaultLanguage('win32',{WT_SESSION:'test'}),'zh');assert.equal(defaultLanguage('win32',{TERM_PROGRAM:'vscode'}),'zh');assert.equal(defaultLanguage('linux',{}),'zh');assert.equal(parseArgs(['--lang','zh']).lang,'zh');assert.throws(()=>parseArgs(['--lang','unknown']));});
