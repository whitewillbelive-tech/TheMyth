import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export const collections = ['entities', 'relations', 'groups', 'memberships', 'states', 'documents', 'chapters', 'versions'];

// Real SQLite SQL/constraints and file persistence; only the D1 transport is mocked.
export class TestD1 {
  constructor(path) { this.path = path; this.db = new DatabaseSync(path); }
  prepare(sql) {
    const owner = this;
    return {
      sql, values: [],
      bind(...values) { return { ...this, values }; },
      async all() { return owner.execute(this); },
      async run() { return owner.execute(this); },
      async first(column) { const row = owner.execute(this).results[0]; return column ? row?.[column] ?? null : row ?? null; },
      async raw() { return owner.execute(this).results.map(row => Object.values(row)); },
    };
  }
  execute(query) {
    const stmt = this.db.prepare(query.sql);
    if (stmt.columns().length) return { success: true, results: stmt.all(...query.values), meta: { changes: 0 } };
    const result = stmt.run(...query.values);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async batch(queries) {
    if (this.beforeBatch) await this.beforeBatch(queries);
    this.db.exec('BEGIN IMMEDIATE');
    try { const results = queries.map(query => this.execute(query)); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1, duration: 0 }; }
  withSession() { return this; }
  close() { this.db.close(); }
}

export function initialize(db) {
  const migrations = new URL('../drizzle/', import.meta.url);
  if (existsSync(migrations)) {
    const sql = readdirSync(migrations).filter(file => file.endsWith('.sql')).sort();
    if (sql.length) { for (const file of sql) db.db.exec(readFileSync(new URL(file, migrations), 'utf8')); return; }
  }
  for (const table of collections) db.db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, record TEXT NOT NULL CHECK(json_valid(record)));`);
  db.db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
}

export class Fixture {
  constructor(handler, directory = null) {
    this.handler = handler;
    this.directory = directory ?? mkdtempSync(join(tmpdir(), 'myth-d1-test-'));
    this.dbPath = join(this.directory, 'test.sqlite3');
    const existing = existsSync(this.dbPath);
    this.DB = new TestD1(this.dbPath);
    if (!existing) initialize(this.DB);
    this.objects = new Map();
    this.env = { DB: this.DB, BUCKET: {
      put: async (key, value) => { this.objects.set(key, value); return { key }; },
      get: async key => this.objects.has(key) ? { text: async () => this.objects.get(key) } : null,
    } };
  }
  async response(method, path, payload, headers = {}) {
    const opts = { method, headers: { 'oai-authenticated-user-id': 'test-owner', ...headers } };
    if (payload !== undefined) { opts.body = JSON.stringify(payload); opts.headers['content-type'] = 'application/json'; }
    return this.handler(new Request('https://myth.test' + path, opts), this.env);
  }
  async req(method, path, payload, headers) {
    const response = await this.response(method, path, payload, headers);
    const text = await response.text();
    assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  }
  async error(method, path, payload, status = null, headers) {
    const response = await this.response(method, path, payload, headers);
    const text = await response.text();
    if (status) assert.equal(response.status, status, text);
    else assert.ok(response.status >= 400, text);
    return text;
  }
  create(collection, fields) { return this.req('POST', '/api/' + collection, fields); }
  entity(kind, name, data = {}) { return this.create('entities', { kind, name: '[TEST] ' + name, data }); }
  relation(source, target, type, fields = {}) { return this.create('relations', { source_id: source.id, target_id: target.id, type, ...fields }); }
  state() { return this.req('GET', '/api/state'); }
  async record(collection, id) { const result = (await this.state())[collection].find(row => row.id === id); assert.ok(result, `${collection}/${id} is missing`); return result; }
  async backup() { return this.req('GET', '/api/backup'); }
  async update(collection, record, fields) { return this.req('PATCH', `/api/${collection}/${record.id}`, fields); }
  async replace(backup) { return this.req('POST', '/api/backup/restore', { backup, mode: 'replace', confirm: 'REPLACE' }); }
  reopen() { this.DB.close(); this.DB = new TestD1(this.dbPath); this.env.DB = this.DB; }
  close() { this.DB.close(); rmSync(this.directory, { recursive: true, force: true }); }
}
