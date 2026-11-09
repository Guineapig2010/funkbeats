import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

process.env.AIMS_NO_LISTEN = '1';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-should-never-leak';
const mod = await import('../server/index');

let base = '';
beforeAll(async () => { await new Promise<void>((r) => mod.server.listen(0, r)); base = `http://localhost:${(mod.server.address() as AddressInfo).port}`; });
afterAll(() => { mod.server.close(); });

describe('backend', () => {
  it('health reports Claude availability without exposing the key', async () => {
    const r = await fetch(`${base}/api/health`);
    const text = await r.text();
    expect(JSON.parse(text).claude).toBe(true);
    expect(text).not.toContain('sk-ant');
  });
  it('extracts fenced JSON', () => {
    expect(mod.extractJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(mod.extractJson('prefix {"b":2} suffix')).toEqual({ b: 2 });
  });
  it('vocal render explains when no provider is configured', async () => {
    const r = await fetch(`${base}/api/vocals/render`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/No vocal provider/);
  });
  it('rejects oversized bodies', async () => {
    const r = await fetch(`${base}/api/ai/assist`, { method: 'POST', body: 'x'.repeat(3_100_000) });
    expect(r.status).toBe(413);
  });
  it('built frontend bundle contains no API keys', () => {
    if (!existsSync('dist/assets')) return;
    for (const f of readdirSync('dist/assets')) {
      const s = readFileSync(`dist/assets/${f}`, 'utf8');
      expect(s).not.toMatch(/sk-ant-[A-Za-z0-9]/);
      expect(s).not.toContain('sk-ant-test-secret');
    }
  });
});
