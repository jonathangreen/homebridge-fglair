const {test, after, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {FglairApi} = require('../dist/fglairApi');
const {HeatpumpAccessory} = require('../dist/platformAccessory');
const {FujitsuPlatformPlugin} = require('../dist/platform');

const realFetch = global.fetch;
const log = {debug() {}, info() {}, error() {}};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fglair-recovery-'));
const tokens = {access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600};
let sequence = 0;

function api(expires = 0, logger = log) {
  const tokenPath = path.join(directory, String(sequence++));
  fs.writeFileSync(tokenPath, JSON.stringify({access: 'old-access', refresh: 'old-refresh', expires}));
  return new FglairApi('test@example.invalid', 'test-password', logger, tokenPath);
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: {async cancel() {}},
    async json() { return body; },
  };
}

afterEach(() => { global.fetch = realFetch; });
after(() => { fs.rmSync(directory, {recursive: true, force: true}); });

for (const status of [401, 403, 422]) {
  test(`rejected refresh (${status}) falls back to login without logging tokens`, async () => {
    const messages = [];
    const client = api(0, {...log, debug: (...args) => messages.push(args)});
    const urls = [];
    global.fetch = async url => {
      urls.push(url);
      return url.includes('refresh_token') ? response(status, {}) : response(200, tokens);
    };
    await client.authenticate();
    assert.equal(client.tokens.access, tokens.access_token);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /sign_in/);
    assert(!JSON.stringify(messages).includes(tokens.access_token));
    assert(!JSON.stringify(messages).includes(tokens.refresh_token));
  });
}

test('parallel requests share one token refresh', async () => {
  const client = api();
  let calls = 0;
  global.fetch = async () => {
    calls++;
    await new Promise(setImmediate);
    return response(200, tokens);
  };
  await Promise.all([client.authenticate(), client.authenticate(), client.authenticate()]);
  assert.equal(calls, 1);
});

test('API 401 refreshes credentials and retries with the new token', async () => {
  const client = api(Date.now() + 3600000);
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    if (url.includes('refresh_token')) return response(200, tokens);
    if (options.headers.Authorization === 'auth_token old-access') return response(401, {});
    return response(200, [{device: {mac: 'ABC', dsn: 'test-device'}}]);
  };
  assert.equal((await client.getDevices()).abc.dsn, 'test-device');
  assert.equal(calls, 3);
});

test('repeated API 401 stops after one authenticated retry', async () => {
  const client = api(Date.now() + 3600000);
  let calls = 0;
  global.fetch = async url => {
    calls++;
    return url.includes('refresh_token') ? response(200, tokens) : response(401, {});
  };
  await assert.rejects(client.getDevices(), /HTTP 401/);
  assert.equal(calls, 3);
});

test('malformed token response does not overwrite saved credentials', async () => {
  const client = api();
  const saved = fs.readFileSync(client.tokenPath, 'utf8');
  global.fetch = async () => response(200, {});
  await assert.rejects(client.authenticate(), /invalid token response/);
  assert.equal(fs.readFileSync(client.tokenPath, 'utf8'), saved);
});

test('refresh outage preserves credentials and permits a later retry', async () => {
  const client = api();
  let calls = 0;
  global.fetch = async () => { calls++; return response(503, {}); };
  await assert.rejects(client.authenticate(), /HTTP 503/);
  assert.equal(calls, 1);
  assert.equal(client.tokens.refresh, 'old-refresh');
  global.fetch = async () => response(200, tokens);
  await client.authenticate();
  assert.equal(client.tokens.access, tokens.access_token);
});

test('invalid device lists and failed HTTP responses reject clearly', async () => {
  const client = api(Date.now() + 3600000);
  global.fetch = async () => response(503, {});
  await assert.rejects(client.getDevices(), /HTTP 503/);
  global.fetch = async () => response(200, {});
  await assert.rejects(client.getDevices(), /invalid device list/);
});

test('requests use a 15 second deadline and propagate timeout failures', async () => {
  const client = api(Date.now() + 3600000);
  const originalTimeout = AbortSignal.timeout;
  let deadline;
  AbortSignal.timeout = ms => { deadline = ms; return new AbortController().signal; };
  global.fetch = async (url, options) => {
    assert(options.signal instanceof AbortSignal);
    throw new Error('request timed out');
  };
  try {
    await assert.rejects(client.getDevices(), /request timed out/);
    assert.equal(deadline, 15000);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test('poll failure is contained, backs off, then recovers', async () => {
  const accessory = Object.create(HeatpumpAccessory.prototype);
  let calls = 0;
  let errors = 0;
  accessory.platform = {log: {error() { errors++; }}};
  accessory.updateLoop = async () => { if (++calls === 1) throw new Error('offline'); };
  await accessory.mainUpdateLoop();
  assert.equal(accessory.updating, false);
  assert(accessory.retryAfter > Date.now());
  await accessory.mainUpdateLoop();
  assert.equal(calls, 1);
  accessory.retryAfter = 0;
  await accessory.mainUpdateLoop();
  assert.equal(calls, 2);
  assert.equal(errors, 1);
});

test('slow updates do not overlap', async () => {
  const accessory = Object.create(HeatpumpAccessory.prototype);
  let calls = 0;
  let finish;
  accessory.updateLoop = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = accessory.mainUpdateLoop();
  await accessory.mainUpdateLoop();
  assert.equal(calls, 1);
  finish();
  await pending;
  assert.equal(accessory.updating, false);
});

test('failed property synchronization retries on the first poll after backoff', async () => {
  const accessory = Object.create(HeatpumpAccessory.prototype);
  accessory.main_loop_counter = 29;
  accessory.local_state = {getInitialized() { return {}; }};
  accessory.remote_state = {setProperties(properties) { assert.deepEqual(properties, []); }};
  let calls = 0;
  accessory.platform = {log, DeviceApi: {
    async getDeviceProperties() {
      if (++calls === 1) throw new Error('offline');
      return [];
    },
  }};
  await accessory.mainUpdateLoop();
  assert.equal(calls, 1);
  accessory.retryAfter = 0;
  await accessory.mainUpdateLoop();
  assert.equal(calls, 2);
});

test('failed writes retain pending commands without replacing newer input', async () => {
  const accessory = Object.create(HeatpumpAccessory.prototype);
  accessory.main_loop_counter = 0;
  accessory.dsn = 'test-device';
  const property = {
    pending: true,
    raw: 3,
    get value() { return this.raw; },
    set value(value) { this.raw = value; this.pending = true; },
    initialized() { return this.pending; },
    reset() { this.pending = false; },
  };
  accessory.local_state = {
    operation: property,
    getInitialized() { return property.pending ? {operation: property.value} : {}; },
  };
  accessory.platform = {log, DeviceApi: {async setDeviceProperties() { throw new Error('offline'); }}};
  await assert.rejects(accessory.updateLoop(), /offline/);
  assert.equal(property.pending, true);
  assert.equal(property.value, 3);
  accessory.platform.DeviceApi.setDeviceProperties = async () => {
    property.value = 7;
    throw new Error('offline');
  };
  await assert.rejects(accessory.updateLoop(), /offline/);
  assert.equal(property.value, 7);
});

for (const stage of ['devices', 'properties']) {
  test(`discovery retries after ${stage} fails`, async () => {
    const platform = Object.create(FujitsuPlatformPlugin.prototype);
    platform.config = {name: 'Test', username: 'test', password: 'test', mac: 'abc'};
    platform.api = {hap: {uuid: {generate() { return 'test-uuid'; }}}};
    platform.accessories = [];
    platform.log = log;
    platform.DeviceApi = {
      async getDevices() {
        if (stage === 'devices') throw new Error('offline');
        return {abc: {dsn: 'test-device'}};
      },
      async getDeviceProperties() { throw new Error('offline'); },
    };
    const originalTimeout = global.setTimeout;
    let retry;
    let delay;
    global.setTimeout = (fn, ms) => { retry = fn; delay = ms; };
    try {
      await platform.discoverDevices();
      assert.equal(delay, 30000);
      assert.equal(typeof retry, 'function');
    } finally {
      global.setTimeout = originalTimeout;
    }
  });
}
