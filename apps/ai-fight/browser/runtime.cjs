// Compatibility adapter for the original CommonJS engines. This is not a security
// sandbox. The opaque iframe, its CSP, and the disposable Worker are the boundary.
function createEngineLoader(sources) {
  const cache = new Map();
  const encoder = new TextEncoder();
  const Buffer = { byteLength: value => encoder.encode(String(value)).length };
  const process = { hrtime: { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) } };
  const normalize = value => {
    const parts = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  const path = {
    join: (...parts) => normalize(parts.join('/')),
    resolve: (...parts) => normalize(parts.join('/')),
    dirname: file => file.split('/').slice(0, -1).join('/'),
    basename: file => file.split('/').pop(),
  };
  const fs = {
    readFileSync(file) {
      const text = sources[normalize(file)];
      if (typeof text !== 'string') throw new Error('Bundled file not found');
      return text;
    },
    statSync(file) {
      const key = normalize(file);
      if (!Object.hasOwn(sources, key)) throw new Error('Bundled file not found');
      return { size: Buffer.byteLength(sources[key]), mtimeMs: 0, isFile: () => true };
    },
    existsSync: file => Object.hasOwn(sources, normalize(file)),
    readdirSync(dir) {
      const prefix = normalize(dir) + '/';
      return [...new Set(Object.keys(sources).filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length).split('/')[0]))];
    },
  };
  const vm = {
    createContext(sandbox) {
      const scopedMath = Object.create(null);
      Object.defineProperties(scopedMath, Object.getOwnPropertyDescriptors(Math));
      const context = Object.assign(sandbox, { Math: scopedMath });
      context.globalThis = context;
      return context;
    },
    Script: class {
      constructor(source) {
        this.source = String(source);
        new Function(this.source); // Syntax check only; submitted source runs later in this Worker.
      }
      runInContext(context) {
        const expression = /^\s*\(function\b/.test(this.source);
        const code = expression ? `return ${this.source.trim()}` : this.source + '\n' +
          'if(typeof brain === "function") globalThis.brain=brain;' +
          'if(typeof command === "function") globalThis.command=command;' +
          'if(typeof decide === "function") globalThis.decide=decide;';
        return new Function('context', `with(context){ return (function(){${code}\n}).call(context); }`)(context);
      }
    },
  };
  function load(name, parent = '') {
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (name === 'vm') return vm;
    let key = normalize(name.startsWith('.') ? path.join(path.dirname(parent), name) : name);
    if (!Object.hasOwn(sources, key)) key += '.js';
    if (!Object.hasOwn(sources, key)) throw new Error(`Module unavailable: ${name}`);
    if (cache.has(key)) return cache.get(key).exports;
    const module = { exports: {} };
    cache.set(key, module);
    if (key.endsWith('.json')) module.exports = JSON.parse(sources[key]);
    else new Function('require', 'module', 'exports', '__dirname', 'Buffer', 'process', sources[key])(
      name => load(name, key), module, module.exports, path.dirname(key), Buffer, process);
    return module.exports;
  }
  return load;
}
