import { describe, expect, it } from 'vitest';
import { RealBedrock, classifyError, type ConverseClient } from '../src/adapters/bedrock/index.js';
import type { ConverseRequest } from '../src/adapters/bedrock/index.js';

const req: ConverseRequest = {
  modelId: 'anthropic.claude-sonnet-5',
  system: 'rules',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', format: 'jpeg', bytes: new Uint8Array([1, 2, 3]) },
      ],
    },
  ],
  maxTokens: 64,
};
const live = () => new AbortController().signal;
const err = (name: string, status?: number) => Object.assign(new Error('x'), { name, $metadata: { httpStatusCode: status } });
const ok = { output: { message: { role: 'assistant', content: [{ text: 'READY' }] } }, usage: { inputTokens: 5, outputTokens: 2 }, stopReason: 'end_turn' };

function make(script: Array<unknown>) {
  const calls: Array<{ input: Record<string, unknown>; hasSignal: boolean }> = [];
  const sleeps: number[] = [];
  let i = 0;
  const client = {
    send: (cmd: { input: Record<string, unknown> }, o: { abortSignal: AbortSignal }) => {
      calls.push({ input: cmd.input, hasSignal: o.abortSignal instanceof AbortSignal });
      const r = script[Math.min(i++, script.length - 1)];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  } as unknown as ConverseClient;
  const port = new RealBedrock({
    region: 'ap-southeast-1',
    clientFactory: () => client,
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
    random: () => 0.5,
  });
  return { port, calls, sleeps };
}

describe('RealBedrock (SDK mocked, no AWS calls)', () => {
  it('sends maxTokens, system and image content, and maps the result', async () => {
    const { port, calls } = make([ok]);
    const r = await port.converse(req, live());
    expect(r).toEqual({ ok: true, text: 'READY', usage: { inputTokens: 5, outputTokens: 2 }, modelId: req.modelId });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.hasSignal).toBe(true);
    expect(calls[0]!.input.inferenceConfig).toEqual({ maxTokens: 64 });
    expect(calls[0]!.input.system).toEqual([{ text: 'rules' }]);
    const content = (calls[0]!.input.messages as Array<{ content: unknown[] }>)[0]!.content;
    expect(content[1]).toEqual({ image: { format: 'jpeg', source: { bytes: new Uint8Array([1, 2, 3]) } } });
  });

  it('retries throttling at most twice with backoff, then fails retryable', async () => {
    const { port, calls, sleeps } = make([err('ThrottlingException', 429)]);
    expect(await port.converse(req, live())).toEqual({ ok: false, code: 'THROTTLED', retryable: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('recovers when a retry succeeds', async () => {
    const { port, calls } = make([err('InternalServerException', 500), ok]);
    expect((await port.converse(req, live())).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['AccessDeniedException', 403, 'ACCESS_DENIED'],
    ['ResourceNotFoundException', 404, 'MODEL_UNSUPPORTED'],
    ['ValidationException', 400, 'INVALID_REQUEST'],
  ])('does not retry %s', async (name, status, code) => {
    const { port, calls } = make([err(name, status)]);
    expect(await port.converse(req, live())).toEqual({ ok: false, code, retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('rejects global./apac. model IDs and invalid maxTokens without calling the client', async () => {
    const { port, calls } = make([ok]);
    expect(await port.converse({ ...req, modelId: 'global.anthropic.claude-sonnet-5' }, live())).toMatchObject({ code: 'MODEL_UNSUPPORTED' });
    expect(await port.converse({ ...req, modelId: 'apac.x' }, live())).toMatchObject({ code: 'MODEL_UNSUPPORTED' });
    expect(await port.converse({ ...req, maxTokens: 0 }, live())).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
  });

  it('returns TIMEOUT without calling when the caller signal is already aborted', async () => {
    const { port, calls } = make([ok]);
    const c = new AbortController();
    c.abort();
    expect(await port.converse(req, c.signal)).toEqual({ ok: false, code: 'TIMEOUT', retryable: false });
    expect(calls).toHaveLength(0);
  });

  it('classifies abort and credential errors', () => {
    expect(classifyError(err('AbortError'))).toBe('TIMEOUT');
    expect(classifyError(err('CredentialsProviderError'))).toBe('ACCESS_DENIED');
    expect(classifyError(err('Boom', 503))).toBe('UPSTREAM_5XX');
  });
});
