import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DisabledBedrock, RETRYABLE_CODES, selectBedrockAdapter } from '../src/adapters/bedrock/index.js';
import type { ConverseRequest } from '../src/adapters/bedrock/index.js';
import { INJECTION_TEXT, MockBedrock } from '../src/adapters/bedrock/test-support.js';
import { AssistantTurnSchema, parseModelJson } from '../src/assistant/schemas.js';

const req: ConverseRequest = {
  modelId: 'anthropic.claude-sonnet-5',
  system: 'rules',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  maxTokens: 500,
};
const live = () => new AbortController().signal;
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

describe('adapter selection', () => {
  it('returns a fail-closed adapter with kind mock when ENABLE_REAL_BEDROCK=false', async () => {
    const port = selectBedrockAdapter({ ENABLE_REAL_BEDROCK: false });
    expect(port).toBeInstanceOf(DisabledBedrock);
    expect(port.kind).toBe('mock');
    expect(await port.converse(req, live())).toEqual({ ok: false, code: 'DISABLED', retryable: false });
  });

  it('builds the real adapter (kind real) for ENABLE_REAL_BEDROCK=true without calling AWS', () => {
    const port = selectBedrockAdapter({ ENABLE_REAL_BEDROCK: true, AWS_REGION: 'ap-southeast-1' }, undefined, {
      clientFactory: () => ({ send: () => Promise.reject(new Error('no call expected')) }),
    });
    expect(port.kind).toBe('real');
  });
  it('uses an injected test port', () => {
    const mock = new MockBedrock([{ type: 'text', text: 'x' }]);
    expect(selectBedrockAdapter({ ENABLE_REAL_BEDROCK: false }, mock)).toBe(mock);
  });

  it('production wiring files never import the mock', () => {
    const dir = path.join(srcDir, 'adapters/bedrock');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && n !== 'test-support.ts' && n !== 'mock.ts')) {
      expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/from\s+'[^']*(mock|test-support)\.js'/);
    }
    expect(readFileSync(path.join(srcDir, 'server.ts'), 'utf8')).not.toMatch(/from\s+'[^']*(mock|test-support)\.js'/);
  });
});

describe('MockBedrock scripted responses', () => {
  it('has kind mock and records calls', async () => {
    const m = new MockBedrock([{ type: 'text', text: 'hello' }]);
    expect(m.kind).toBe('mock');
    const r = await m.converse(req, live());
    expect(r).toMatchObject({ ok: true, text: 'hello', modelId: req.modelId });
    expect(m.calls).toHaveLength(1);
  });

  it('plays steps in order and repeats the last', async () => {
    const m = new MockBedrock([{ type: 'timeout' }, { type: 'text', text: 'ok' }]);
    expect(await m.converse(req, live())).toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(await m.converse(req, live())).toMatchObject({ ok: true });
    expect(await m.converse(req, live())).toMatchObject({ ok: true });
  });

  it('malformed JSON fails to parse', async () => {
    const r = await new MockBedrock([{ type: 'malformed_json' }]).converse(req, live());
    expect(r.ok && parseModelJson(r.text)).toBeNull();
  });

  it('injection text is returned as plain text and is not a valid turn', async () => {
    const r = await new MockBedrock([{ type: 'injection' }]).converse(req, live());
    expect(r.ok && r.text).toBe(INJECTION_TEXT);
    expect(AssistantTurnSchema.safeParse(r.ok ? parseModelJson(r.text) : undefined).success).toBe(false);
  });

  it('timeout and throttled are retryable, unsupported image is not', async () => {
    const t = await new MockBedrock([{ type: 'timeout' }]).converse(req, live());
    const th = await new MockBedrock([{ type: 'throttled' }]).converse(req, live());
    const u = await new MockBedrock([{ type: 'unsupported_image' }]).converse(req, live());
    for (const r of [t, th, u]) expect(r.ok).toBe(false);
    expect(t).toMatchObject({ retryable: true });
    expect(th).toMatchObject({ retryable: true });
    expect(u).toMatchObject({ code: 'MODEL_UNSUPPORTED', retryable: false });
    expect([...RETRYABLE_CODES].sort()).toEqual(['THROTTLED', 'TIMEOUT', 'UPSTREAM_5XX']);
  });

  it('an aborted signal yields TIMEOUT', async () => {
    const c = new AbortController();
    c.abort();
    expect(await new MockBedrock([{ type: 'text', text: 'x' }]).converse(req, c.signal)).toMatchObject({
      ok: false,
      code: 'TIMEOUT',
    });
  });
});
