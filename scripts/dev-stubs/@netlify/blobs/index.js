// In-memory stand-in for @netlify/blobs, used only by scripts/dev-register.mjs.
// Implements the three calls netlify/functions/decisions.js makes: get, setJSON, list.
const stores = new Map();
function getStore(opts) {
  const name = typeof opts === 'string' ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  return {
    async get(key, o) {
      if (!m.has(key)) return null;
      const raw = m.get(key);
      return o && o.type === 'json' ? JSON.parse(raw) : raw;
    },
    async setJSON(key, value) { m.set(key, JSON.stringify(value)); },
    async set(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
    async list(o) {
      const prefix = (o && o.prefix) || '';
      return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => ({ key: k, etag: '"dev"' })), directories: [] };
    },
  };
}
module.exports = { getStore, getDeployStore: getStore, __stores: stores };
