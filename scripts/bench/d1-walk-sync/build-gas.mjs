// THROWAWAY #441: generate a guarded copy; never paste into the production project.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../apps-script/sheet-write.gs', import.meta.url), 'utf8');
const guard = readFileSync(new URL('./test-guard.gs', import.meta.url), 'utf8');
let output = source;
for (const name of ['doGet', 'handleRequest', 'notifyWorker']) {
  const pattern = new RegExp(`function ${name}\\(`, 'g');
  if ((output.match(pattern) || []).length !== 1) throw new Error(`Expected one ${name}`);
  output = output.replace(pattern, `function unusedOriginal_${name}(`);
}
const destination = new URL('./generated-test-only.gs', import.meta.url);
writeFileSync(destination, '// THROWAWAY TEST ONLY — #441\n' + output + '\n' + guard);
console.log(destination.pathname);
