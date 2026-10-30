// Stop hook：功能分支有變更時，要求目前 HEAD 已通過完整本機檢核，且本次對話跑過 code-review。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}');
if (input.stop_hook_active) process.exit(0);

const cwd = input.cwd || process.cwd();
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let head, ahead, dirty;
try {
  head = git('rev-parse', 'HEAD');
  ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
  dirty = git('status', '--porcelain', '--', '.', ':!.scratch') !== '';
} catch {
  process.exit(0);
}
if (ahead === 0 && !dirty) process.exit(0);

const missing = [];

const isFull = r => {
  const cmds = (r.commands || []).flat().join(' ');
  return cmds.includes('run-node-tests') && cmds.includes('run-browser-tests');
};
const checksDir = join(cwd, '.scratch', 'checks');
const records = existsSync(checksDir)
  ? readdirSync(checksDir).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(readFileSync(join(checksDir, f), 'utf8')); } catch { return null; }
    }).filter(Boolean)
  : [];
const fullPassed = records.some(r => r.result === 'passed' && isFull(r) && r.final?.head === head && r.final?.status === '');
if (!fullPassed) missing.push(`目前 HEAD ${head.slice(0, 7)} 沒有通過的完整檢核（工作樹乾淨時跑 .\\scripts\\check-local.ps1 -Full）`);

let transcript = '';
try { transcript = readFileSync(input.transcript_path, 'utf8'); } catch {}
if (!/"skill"\s*:\s*"[^"]*code-review"/.test(transcript)) missing.push('本次對話還沒跑 code-review 技能（Standards／Spec 兩軸審查）');

if (missing.length === 0) process.exit(0);

console.log(JSON.stringify({
  decision: 'block',
  reason: `交付前還缺：\n- ${missing.join('\n- ')}\n補完再結束。若只是暫停等使用者回覆，說明原因後即可結束。`,
}));
