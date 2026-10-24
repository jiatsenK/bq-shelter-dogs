import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function loadFrontendModule(file, globals = {}) {
  const context = vm.createContext(globals);
  const modules = new Map();
  async function load(url) {
    const key = url.href;
    if (!modules.has(key)) modules.set(key, readFile(url, 'utf8').then(source => new vm.SourceTextModule(source, { context, identifier: key })));
    return modules.get(key);
  }
  const entry = await load(new URL('../public/js/' + file, import.meta.url));
  await entry.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
  await entry.evaluate();
  return entry.namespace;
}
