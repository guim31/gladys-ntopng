// -----------------------------------------------------------------------------
// The logs the Gladys supervisor keeps: at the info level, only the life
// cycle. A normal reading cycle (reads, states, scene events) writes nothing;
// a failure that repeats at every read writes one line, then one when it heals.
// The SDK logger writes debug/info with console.log, warn/error with
// console.error, at the level of LOG_LEVEL read on every line.
// (Adapted from guim31/gladys-netdata.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN } from './helpers/fakeNtopng.js';
import {
  createClock,
  createDevices,
  createWorld,
  flowAlert,
  hostAlert,
  localHost,
} from './helpers/world.js';

/** The lines written at `LOG_LEVEL=info` from now on, by level. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function started(t) {
  const world = await createWorld({ clock: createClock() });
  t.after(() => world.app.stop());
  return world;
}

test('a normal cycle writes nothing: reads, states, scene events', async (t) => {
  const world = await started(t);
  const lines = captureLogs(t);
  await createDevices(world);
  for (let read = 0; read < 6; read += 1) {
    world.clock.advance(61_000);
    world.ntopng.setRates(0, 10 + read * 7, 2);
    world.ntopng.flowAlerts[0].push(flowAlert(5000 + read, { client: `192.0.2.${100 + read}` }));
    world.ntopng.hosts[0].push(
      localHost({ ip: `192.0.2.${150 + read}`, mac: `02:00:5E:00:01:0${read}` }),
    );
    world.ntopng.hostAlerts[0] = read % 2 ? [hostAlert()] : [];
    await world.hub.pollAll();
  }
  await world.hub.rediscover();
  assert.ok(world.fake.states.length > 10, 'states published');
  assert.ok(world.fake.sceneEvents.length >= 12, 'scene events fired');
  assert.deepEqual(lines, []);
});

test('ntopng down for several reads: one line, then one when it answers again', async (t) => {
  const world = await started(t);
  await createDevices(world);
  const lines = captureLogs(t);
  world.ntopng.failure = 'down';
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    await world.hub.pollAll();
  }
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*ntopng \(192\.0\.2\.2\): ECONNREFUSED/);
  world.ntopng.failure = null;
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*ntopng answers again/);
});

test('Gladys refusing the states for several reads: one line, then one', async (t) => {
  const world = await started(t);
  await createDevices(world);
  const lines = captureLogs(t);
  const publishStates = world.gladys.publishStates.bind(world.gladys);
  let refuse = true;
  t.mock.method(world.gladys, 'publishStates', async (states) => {
    if (refuse) {
      throw new Error('Gladys is away');
    }
    return publishStates(states);
  });
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    world.ntopng.setRates(0, 10 + read, 1); // a value to send at every read
    await world.hub.pollAll();
  }
  assert.ok(world.gladys.publishStates.mock.callCount() >= 5);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*States refused: Gladys is away/);
  refuse = false;
  world.clock.advance(61_000);
  world.ntopng.setRates(0, 50, 1);
  await world.hub.pollAll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /\[INFO\].*States accepted again/);
});

test('no secret in the logs, whatever fails', async (t) => {
  const lines = captureLogs(t);
  process.env.LOG_LEVEL = 'debug';
  const world = await createWorld({
    clock: createClock(),
    config: { url: '192.0.2.2', username: 'admin', password: 'hunter2-secret', language: 'en' },
  });
  t.after(() => world.app.stop());
  world.ntopng.failure = 'html';
  await world.hub.pollAll();
  const all = lines.join('\n');
  assert.ok(lines.length > 0);
  for (const secret of [
    'hunter2-secret',
    TOKEN,
    Buffer.from('admin:hunter2-secret').toString('base64'),
  ]) {
    assert.ok(!all.includes(secret), `"${secret}" in the logs`);
  }
});
