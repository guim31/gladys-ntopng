// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake ntopng on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers` is set: the
// tests read ntopng with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { deviceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import {
  BASE_URL,
  FakeNtopng,
  TOKEN,
  createNetwork,
  flowAlert,
  hostAlert,
  localHost,
} from './fakeNtopng.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const DEFAULT_TEST_CONFIG = { url: '192.0.2.2', api_token: TOKEN, language: 'en' };

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 23, 18, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {FakeNtopng} [options.ntopng]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  ntopng = new FakeNtopng(),
  config = DEFAULT_TEST_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ntopng-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork({ [BASE_URL]: ntopng });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, ntopng, network, app, hub: app.hub, clock, dataDir };
}

export const interfaceId = (gladys, key = 'eth0') => deviceIds(gladys, key).device;
export const featureId = (gladys, key, feature) => deviceIds(gladys, key).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE_URL, FakeNtopng, TOKEN, flowAlert, hostAlert, localHost };
