import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const db = new DatabaseSync('spike.db');
db.exec('PRAGMA journal_mode=WAL'); db.exec('PRAGMA busy_timeout=5000');
const kids = [1,2].map(w => spawn(process.execPath, ['spike.mjs','writer','.',w,400], {stdio:'ignore'}));
let snaps=0, bad=0, firstErr=null;
const ins = db.prepare('INSERT INTO items (id,seq,payload) VALUES (?,?,?)');
let k=0;
while (kids.some(c=>!c.killed) && snaps < 40) {
  try {
    const buf = Buffer.from(db.serialize('main'));
    const out = `snap-${snaps}.db`; writeFileSync(out, buf);
    const chk = new DatabaseSync(out, {readOnly:true});
    const r = chk.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = chk.prepare('SELECT COUNT(*) c FROM items').get().c;
    chk.close();
    snaps++;
    if (r !== 'ok') { bad++; firstErr = `snap${snaps} integrity=${r} rows=${n}`; }
  } catch (e) { if (!firstErr) firstErr = 'serialize threw: ' + e.message; break; }
  for (let i=0;i<20;i++) try { ins.run(`self-${k++}`, k, 'z'.repeat(60)); } catch {}
  await new Promise(r=>setTimeout(r,15));
}
kids.forEach(c=>c.kill());
console.log(JSON.stringify({快照数:snaps, 完整性失败:bad, 首个异常:firstErr, 结论: bad===0 ? '并发写下 serialize 未出现撕裂快照' : 'serialize 不安全'}));
