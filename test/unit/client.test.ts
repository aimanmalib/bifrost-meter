import { describe, expect, it, vi } from 'vitest';
import { fetchQuota, fetchVersion, isPrivateHost, quotaUrl, redactKey, scrubKey } from '../../src/core/client';
import { fixture } from './fixtures';

const KEY = ['sk', 'bf', 'unit0test0value0abcd1234'].join('-');

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('isPrivateHost', () => {
  it.each([
    'localhost', 'api.localhost', '127.0.0.1', '127.8.9.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.10',
    '169.254.1.1', '100.64.0.1', '[::1]', '::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', 'bifrost-meter-bifrost',
    'gateway.local', 'host.docker.internal', 'box.lan', 'nas.home.arpa',
  ])('%s is private', (h) => expect(isPrivateHost(h)).toBe(true));
  it.each(['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '100.128.0.1', '2001:4860::8888', '::ffff:8.8.8.8', 'localhost.evil.com'])(
    '%s is public',
    (h) => expect(isPrivateHost(h)).toBe(false),
  );
});

describe('quotaUrl', () => {
  it.each([
    ['http://localhost:8080', 'http://localhost:8080/api/governance/virtual-keys/quota'],
    ['http://localhost:8080/', 'http://localhost:8080/api/governance/virtual-keys/quota'],
    ['https://gw.example.com/bifrost/', 'https://gw.example.com/bifrost/api/governance/virtual-keys/quota'],
    ['https://gw.example.com?x=1#y', 'https://gw.example.com/api/governance/virtual-keys/quota'],
  ])('%s', (base, want) => {
    const r = quotaUrl(base);
    expect(r.ok && r.url.href).toBe(want);
  });
  it.each([['not a url'], ['ftp://gw.example.com'], ['https://user:pw@gw.example.com']])('%s is invalid', (base) => {
    expect(quotaUrl(base)).toEqual({ ok: false, result: { kind: 'invalidUrl' } });
  });
  it('refuses plain http to a public host unless allowed', () => {
    expect(quotaUrl('http://gw.example.com')).toEqual({ ok: false, result: { kind: 'insecure', host: 'gw.example.com' } });
    expect(quotaUrl('http://gw.example.com', true).ok).toBe(true);
  });
});

describe('fetchQuota', () => {
  const base = { baseUrl: 'http://localhost:8080', key: KEY };

  it('sends the key in x-bf-vk only and parses a recorded 200', async () => {
    const f = fakeFetch(reply(200, fixture('quota-200-after-traffic').body));
    const r = await fetchQuota({ ...base, fetchImpl: f.impl });
    expect(r.kind).toBe('ok');
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-bf-vk']).toBe(KEY);
    expect(Object.keys(headers).sort()).toEqual(['accept', 'x-bf-vk']);
    expect(f.calls[0]!.init.redirect).toBe('manual');
  });

  it.each([
    ['quota-401-missing-key', 'unauthorized'],
    ['quota-401-unknown-key', 'unauthorized'],
    ['quota-403-expired', 'forbidden'],
  ])('maps recorded %s to %s', async (name, kind) => {
    const fx = fixture(name);
    const r = await fetchQuota({ ...base, fetchImpl: fakeFetch(reply(fx.status, fx.body)).impl });
    expect(r.kind).toBe(kind);
    if (r.kind === 'forbidden') expect(r.expired).toBe(true);
  });

  it.each([
    [404, 'not found', { kind: 'notFound', status: 404 }],
    [500, { error: { message: 'boom' } }, { kind: 'http', status: 500, message: 'boom' }],
    [200, 'not json', { kind: 'schema', field: '(body)' }],
    [200, { virtual_key_name: 'x', is_active: true }, { kind: 'schema', field: 'budgets' }],
    [403, { error: { message: 'Forbidden' } }, { kind: 'forbidden', status: 403, expired: false, message: 'Forbidden' }],
  ])('status %s %j', async (status, b, want) => {
    expect(await fetchQuota({ ...base, fetchImpl: fakeFetch(reply(status, b)).impl })).toEqual(want);
  });

  it('never returns the key inside a server message', async () => {
    const r = await fetchQuota({ ...base, fetchImpl: fakeFetch(reply(500, { error: { message: `bad key ${KEY}` } })).impl });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).toContain('…1234');
  });

  it('follows a same-origin redirect', async () => {
    const f = fakeFetch(reply(307, '', { location: '/v2/api/governance/virtual-keys/quota' }), reply(200, fixture('quota-200-fresh').body));
    expect((await fetchQuota({ ...base, fetchImpl: f.impl })).kind).toBe('ok');
    expect(f.calls[1]!.url).toBe('http://localhost:8080/v2/api/governance/virtual-keys/quota');
  });

  it('refuses a redirect to another host and does not call it', async () => {
    const f = fakeFetch(reply(302, '', { location: 'https://elsewhere.example.com/collect' }));
    expect(await fetchQuota({ ...base, fetchImpl: f.impl })).toEqual({ kind: 'redirect', to: 'https://elsewhere.example.com' });
    expect(f.calls).toHaveLength(1);
  });

  it('stops after too many redirects', async () => {
    const loop = () => reply(302, '', { location: '/again' });
    const r = await fetchQuota({ ...base, fetchImpl: fakeFetch(loop(), loop(), loop(), loop(), loop()).impl });
    expect(r.kind).toBe('redirect');
  });

  it('reports a timeout', async () => {
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch;
    expect(await fetchQuota({ ...base, timeoutMs: 20, fetchImpl: hang })).toEqual({ kind: 'timeout' });
  });

  it('reports a network failure as offline without the key', async () => {
    const r = await fetchQuota({ ...base, fetchImpl: fakeFetch(new TypeError(`connect ECONNREFUSED for ${KEY}`)).impl });
    expect(r.kind).toBe('offline');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('does not call the network without a key or with an unsafe URL', async () => {
    const f = fakeFetch();
    expect(await fetchQuota({ baseUrl: base.baseUrl, key: '  ', fetchImpl: f.impl })).toEqual({ kind: 'noKey' });
    expect((await fetchQuota({ baseUrl: 'http://gw.example.com', key: KEY, fetchImpl: f.impl })).kind).toBe('insecure');
    expect(f.calls).toHaveLength(0);
  });
});

describe('redactKey', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['short', '…'],
    [KEY, '…1234'],
  ])('%s → %s', (k, want) => expect(redactKey(k)).toBe(want));
  it('scrubs every copy', () => expect(scrubKey(`${KEY} and ${KEY}`, KEY)).toBe('…1234 and …1234'));
});

describe('fetchVersion', () => {
  it('reads the measured string answer, keeps a path prefix and sends no key', async () => {
    const f = fakeFetch(reply(200, JSON.stringify('v2.5.1')));
    expect(await fetchVersion('http://localhost:8080/gw/', false, f.impl)).toBe('v2.5.1');
    expect(f.calls[0]?.url).toBe('http://localhost:8080/gw/api/version');
    expect(JSON.stringify(f.calls[0]?.init.headers)).not.toMatch(/x-bf-vk|authorization/i);
    expect(f.calls[0]?.init.redirect).toBe('manual');
  });
  it('accepts an object with a version field', async () => {
    expect(await fetchVersion('http://localhost:8080', false, fakeFetch(reply(200, { version: '2.6.0-rc1' })).impl)).toBe('2.6.0-rc1');
  });
  it.each([
    ['not found', reply(404, JSON.stringify('v2.5.1'))],
    ['redirect', reply(302, '', { location: 'https://elsewhere.example.com' })],
    ['html', reply(200, '<html>hi</html>')],
    ['markup in a string', reply(200, JSON.stringify('<b>v1</b>'))],
    ['network error', new Error('ECONNREFUSED')],
  ])('gives undefined for %s', async (_n, r) => {
    expect(await fetchVersion('http://localhost:8080', false, fakeFetch(r).impl)).toBeUndefined();
  });
  it('makes no call for a refused URL', async () => {
    const f = fakeFetch();
    expect(await fetchVersion('http://gw.example.com', false, f.impl)).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });
});
