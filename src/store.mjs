import fs from 'node:fs/promises';
import path from 'node:path';
import { SessionMetrics } from './metrics.mjs';

const MAX_LINE = 8 * 1024 * 1024;

export class LogTail {
  constructor(file) {
    this.file = file;
    this.position = 0;
    this.pending = Buffer.alloc(0);
    this.discardLine = false;
    this.metrics = new SessionMetrics(path.basename(file).replace(/^rollout-/, '').replace(/\.jsonl$/, ''));
  }
  async read() {
    const stat = await fs.stat(this.file);
    if (stat.size < this.position || (this.inode !== undefined && stat.ino !== this.inode)) {
      const fresh = new LogTail(this.file);
      Object.assign(this, fresh);
    }
    this.inode = stat.ino;
    const handle = await fs.open(this.file, 'r');
    try {
      const buffer = Buffer.alloc(256 * 1024);
      while (this.position < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - this.position), this.position);
        if (!bytesRead) break;
        this.position += bytesRead;
        this.feed(buffer.subarray(0, bytesRead));
      }
    } finally { await handle.close(); }
    return true;
  }
  feed(chunk) {
    let data = Buffer.concat([this.pending, chunk]);
    let start = 0;
    for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
      if (!this.discardLine) {
        if (end - start > MAX_LINE) { this.metrics.errors++; this.metrics.cycle.mixed = true; }
        else if (end > start) {
          try { this.metrics.ingest(JSON.parse(data.subarray(start, end).toString('utf8'))); }
          catch { this.metrics.errors++; this.metrics.cycle.mixed = true; }
        }
      }
      this.discardLine = false;
      start = end + 1;
    }
    this.pending = Buffer.from(data.subarray(start));
    if (this.pending.length > MAX_LINE) {
      this.pending = Buffer.alloc(0);
      this.discardLine = true;
      this.metrics.errors++;
      this.metrics.cycle.mixed = true;
    }
  }
}

async function discover(root, depth = 0) {
  if (depth > 5) return [];
  let list;
  try { list = await fs.readdir(root, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const files = [];
  for (const entry of list) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await discover(full, depth + 1));
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      try { const s = await fs.stat(full); files.push({ file: full, modified: s.mtimeMs, size: s.size }); }
      catch { /* File may be archived while enumerating. */ }
    }
  }
  return files;
}

export class MonitorStore {
  constructor(root, { limit = 24, file = null, includeInternal = false } = {}) {
    this.root = root;
    this.limit = limit;
    this.file = file;
    this.includeInternal = includeInternal || Boolean(file);
    this.sourceCache = new Map();
    this.tails = new Map();
    this.lastDiscovery = 0;
    this.state = { sessions: [], scanning: true, warnings: [], updatedAt: null };
  }
  async refresh() {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.lastDiscovery || Date.now() - this.lastDiscovery > 10000) {
        const found = this.file ? [{ file: this.file }] : await discover(path.join(this.root, 'sessions'));
        found.sort((a, b) => b.modified - a.modified);
        this.files = [];
        for(const entry of found){
          if(!this.includeInternal && await this.isInternal(entry))continue;
          this.files.push(entry);
          if(this.files.length>=this.limit)break;
        }
        this.discovered = found.length;
        this.lastDiscovery = Date.now();
        const keep = new Set(this.files.map(f => f.file));
        for (const name of this.tails.keys()) if (!keep.has(name)) this.tails.delete(name);
      }
      const warnings = [];
      const sessions = [];
      for (const entry of this.files) {
        let tail = this.tails.get(entry.file);
        if (!tail) { tail = new LogTail(entry.file); this.tails.set(entry.file, tail); }
        try {
          await tail.read();
          const snapshot=tail.metrics.snapshot();
          if(this.includeInternal || snapshot.model!=='codex-auto-review')sessions.push(snapshot);
        } catch { warnings.push('部分日志暂时无法读取，稍后自动重试。'); }
      }
      if (this.discovered > this.limit && this.files.length === this.limit) warnings.push(`当前读取最近修改的 ${this.limit} 个会话，未扫描更早的会话内容。`);
      if (!sessions.length) warnings.push('尚未找到可读取的本地会话。云端会话或未落盘的记录不在统计范围内。');
      this.state = { sessions: sessions.sort((a, b) => (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0)),
        scanning: false, warnings: [...new Set(warnings)], updatedAt: Date.now() };
    } catch {
      this.state = { ...this.state, scanning: false, warnings: ['日志目录暂时无法读取；请检查 --codex-home 设置。'] };
    } finally { this.running = false; }
  }

  async isInternal(entry){
    if(this.sourceCache.has(entry.file))return this.sourceCache.get(entry.file);
    let handle;
    try{
      handle=await fs.open(entry.file,'r');
      const buffer=Buffer.alloc(1024*1024);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
      const end=buffer.subarray(0,bytesRead).indexOf(10);
      if(end<0)return false;
      const row=JSON.parse(buffer.subarray(0,end).toString('utf8'));
      const internal=row.type==='session_meta' && Boolean(row.payload?.source?.subagent);
      this.sourceCache.set(entry.file,internal);
      return internal;
    }catch{return false;}finally{await handle?.close();}
  }
}
