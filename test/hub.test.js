// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and the fake
// ntopng served from real answers: discovery, states, alert events and their
// grouping, new hosts, the throughput threshold, failures and credentials,
// the widget and the scene actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  FakeNtopng,
  createClock,
  createDevices,
  createWorld,
  featureId,
  flowAlert,
  hostAlert,
  interfaceId,
  localHost,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (world, feature, key = 'eth0') =>
  world.fake.lastState(featureId(world.gladys, key, feature));

async function started(t, options = {}) {
  const world = await createWorld({ clock: createClock(), ...options });
  t.after(() => world.app.stop());
  return world;
}

const config = (extra = {}) => ({
  url: '192.0.2.2',
  api_token: 'test-token-not-a-secret',
  language: 'en',
  ...extra,
});

test('one device per interface, read with the API token', async (t) => {
  const world = await started(t);
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => [device.name, device.should_poll]),
    [['ntopng eth0', false]],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  const paths = world.ntopng.requests.map((path) => path.split('?')[0]).sort();
  assert.deepEqual(paths, [
    '/lua/rest/v2/get/flow/alert/list.lua',
    '/lua/rest/v2/get/host/active_list.lua',
    '/lua/rest/v2/get/host/alert/list.lua',
    '/lua/rest/v2/get/interface/alert/list.lua',
    '/lua/rest/v2/get/interface/data.lua',
    '/lua/rest/v2/get/ntopng/interfaces.lua',
  ]);
});

test('only the added interfaces receive states, all of them once added', async (t) => {
  const world = await started(t);
  assert.equal(world.fake.states.length, 0);
  await createDevices(world);
  assert.equal(lastState(world, 'online'), 1);
  assert.equal(lastState(world, 'hosts'), 6);
  assert.equal(lastState(world, 'local_hosts'), 6);
  assert.equal(lastState(world, 'flows'), 24);
  assert.equal(lastState(world, 'engaged_alerts'), 1);
  assert.equal(lastState(world, 'alerted_flows'), 22);
  assert.equal(lastState(world, 'highest_severity'), 'Error');
  assert.equal(lastState(world, 'download'), 0);
  // Unchanged values are not sent again; the rates move, but at most once a minute.
  const count = world.fake.states.length;
  world.ntopng.setRates(0, 12.345, 1.5);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count);
  world.clock.advance(61_000);
  await world.hub.pollAll();
  assert.equal(lastState(world, 'download'), 12.35);
  assert.equal(lastState(world, 'upload'), 1.5);
  assert.equal(world.fake.states.length, count + 2);
});

test('the container reads ntopng on its own timer, without onPoll (Gladys 5.2.0)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await started(t, { timers: true });
  const before = world.ntopng.requests.length;
  t.mock.timers.tick(60_000);
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(world.ntopng.requests.length > before, 'read again after 60 s');
});

test('flow alerts: the first read only records where the log stands', async (t) => {
  const world = await started(t);
  assert.equal(events(world, TRIGGERS.ALERT).length, 0);
  assert.equal(world.hub.saved.eth0.flowRowId, 4407);
});

test('flow alerts: a port scan is one event per type and host, once an hour', async (t) => {
  const world = await started(t);
  const flows = world.ntopng.flowAlerts[0];
  for (let row = 4408; row < 4508; row += 1) {
    flows.push(flowAlert(row));
  }
  flows.push(flowAlert(4508, { typeId: 62, type: 'Clear-Text Credentials', severity: 4 }));
  await world.hub.pollAll();
  const fired = events(world, TRIGGERS.ALERT);
  assert.equal(fired.length, 2);
  assert.deepEqual(
    fired.map(({ data }) => [data.alert_type, data.severity, data.host, data.count]),
    [
      ['Probing Attempt', 'error', '192.0.2.3', 100],
      ['Clear-Text Credentials', 'warning', '192.0.2.3', 1],
    ],
  );
  assert.equal(fired[0].data.interface, interfaceId(world.gladys));
  assert.equal(fired[0].data.origin, 'Flow');
  assert.equal(fired[0].data.description, 'TCP probing attempt');
  // The scan goes on: counted for the widget, not announced again within the hour.
  flows.push(flowAlert(4509), flowAlert(4510, { client: '192.0.2.9' }));
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.ALERT).length, 3, 'only the new host fires');
  const recent = world.hub.interfaces.get('eth0').recent;
  assert.equal(recent.find((item) => item.host === '192.0.2.3' && item.typeId === 101).count, 101);
  world.clock.advance(3601_000);
  flows.push(flowAlert(4511));
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.ALERT).length, 4);
});

test('flow alerts: a restart neither repeats nor misses an alert', async (t) => {
  const first = await started(t);
  const { dataDir, ntopng } = first;
  await first.app.stop();
  ntopng.flowAlerts[0].push(flowAlert(4600));
  const second = await started(t, { dataDir, ntopng });
  assert.equal(events(second, TRIGGERS.ALERT).length, 1);
  await second.app.stop();
  const third = await started(t, { dataDir, ntopng });
  assert.equal(events(third, TRIGGERS.ALERT).length, 0);
});

test('engaged alerts: a host alert fires once, while it stays engaged', async (t) => {
  const world = await started(t);
  world.ntopng.hostAlerts[0].push(hostAlert());
  await world.hub.pollAll();
  await world.hub.pollAll();
  const fired = events(world, TRIGGERS.ALERT);
  assert.equal(fired.length, 1);
  assert.deepEqual(
    [fired[0].data.alert_type, fired[0].data.severity, fired[0].data.host, fired[0].data.host_name],
    ['Score Threshold Exceeded', 'warning', '192.0.2.4', 'laptop.lan'],
  );
  assert.equal(fired[0].data.description, 'Host 192.0.2.4 score is high');
  assert.equal(fired[0].data.origin, 'Host');
  // The interface alert of the fixtures was there at the first read: not announced.
  assert.ok(!fired.some(({ data }) => data.alert_type === 'Dropped Alerts'));
});

test('new local host: announced once, known by its MAC across IP changes', async (t) => {
  const world = await started(t);
  const hosts = world.ntopng.hosts[0];
  hosts.push(localHost({ ip: '192.0.2.50', mac: '02:00:5e:00:00:50', name: 'phone.lan' }));
  await world.hub.pollAll();
  await world.hub.pollAll();
  const fired = events(world, TRIGGERS.NEW_HOST);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    interface: interfaceId(world.gladys),
    interface_name: 'eth0',
    ip: '192.0.2.50',
    mac: '02:00:5E:00:00:50',
    host_name: 'phone.lan',
  });
  // The same phone, another address; a multicast group: nothing.
  hosts.push(localHost({ ip: '192.0.2.51', mac: '02:00:5E:00:00:50', firstSeen: 1792779100 }));
  hosts.push(localHost({ ip: '239.255.255.250', mac: '01:00:5E:7F:FF:FA', firstSeen: 1792779200 }));
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.NEW_HOST).length, 1);
  // Remembered after a restart.
  await world.app.stop();
  const again = await started(t, { dataDir: world.dataDir, ntopng: world.ntopng });
  assert.equal(events(again, TRIGGERS.NEW_HOST).length, 0);
});

test('throughput threshold: above for two reads, then back below 90 % of it', async (t) => {
  const world = await started(t, { config: config({ rate_threshold_mbps: '10,5' }) });
  const states = () => events(world, TRIGGERS.THRESHOLD).map(({ data }) => data.state);
  world.ntopng.setRates(0, 9, 2);
  await world.hub.pollAll();
  assert.deepEqual(states(), []);
  await world.hub.pollAll();
  assert.deepEqual(states(), ['above']);
  const [event] = events(world, TRIGGERS.THRESHOLD);
  assert.deepEqual(
    [event.data.total_mbps, event.data.threshold_mbps, event.data.state_label],
    [11, 10.5, 'Above the threshold'],
  );
  world.ntopng.setRates(0, 8, 1.8); // 9.8: under the threshold, not under 90 % of it
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.deepEqual(states(), ['above']);
  world.ntopng.setRates(0, 5, 1);
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.deepEqual(states(), ['above', 'below']);
});

test('ntopng down: unreachable after two reads, back when it answers', async (t) => {
  const world = await started(t);
  await createDevices(world);
  world.ntopng.failure = 'down';
  await world.hub.pollAll();
  assert.equal(lastState(world, 'online'), 1, 'one failure is a blip');
  await world.hub.pollAll();
  assert.equal(lastState(world, 'online'), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /192\.0\.2\.2: does not answer/);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.ntopng.failure = null;
  await world.hub.pollAll();
  assert.equal(lastState(world, 'online'), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

for (const [label, change, expected] of [
  ['a wrong token', (world) => (world.ntopng.token = 'another'), /API token or password refused/],
  [
    'the default admin password',
    (world) => (world.ntopng.failure = 'password_change'),
    /change the default admin password/,
  ],
  ['ntopng starting', (world) => (world.ntopng.failure = 'starting'), /ntopng is starting/],
  ['another web page', (world) => (world.ntopng.failure = 'html'), /no ntopng at this address/],
  ['a proxy without ntopng', (world) => (world.ntopng.failure = 'proxy'), /does not answer/],
]) {
  test(`the connection status tells ${label}`, async (t) => {
    const world = await started(t);
    change(world);
    await world.hub.pollAll();
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, expected);
  });
}

test('no credentials: ntopng asks for a login', async (t) => {
  const world = await started(t, { config: { url: '192.0.2.2', language: 'fr' } });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /saisissez un jeton d'API/);
});

test('a user and password work as well as a token', async (t) => {
  const ntopng = new FakeNtopng();
  const world = await started(t, {
    ntopng,
    config: {
      url: 'http://192.0.2.2:3000/lua/index.lua',
      username: 'admin',
      password: ntopng.password,
    },
  });
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.discoveredDevices.length, 1);
});

test('a user without the alerts right: values still come, the status says why', async (t) => {
  const ntopng = new FakeNtopng();
  ntopng.alertsDenied = true;
  const world = await started(t, { ntopng });
  await createDevices(world);
  assert.equal(lastState(world, 'hosts'), 6);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.match(world.fake.connectionStatus.message.en, /may not read the alerts/);
});

test('an invalid address is told, nothing is read', async (t) => {
  const world = await started(t, { config: { url: 'ftp://nope', language: 'en' } });
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /Address not understood/);
  assert.equal(world.ntopng.requests.length, 0);
});

test('an interface ntopng no longer monitors goes offline', async (t) => {
  const world = await started(t);
  await createDevices(world);
  world.ntopng.interfaces = [];
  await world.hub.pollAll();
  await world.hub.pollAll();
  assert.equal(lastState(world, 'online'), 0);
});

// --- Widget --------------------------------------------------------------------

function checkBudget(content) {
  const components = content.components;
  assert.ok(components.length <= 8, `${components.length} components`);
  assert.ok(components.filter((c) => c.type === 'text').length <= 2, 'two texts at most');
  const status = components.find((c) => c.type === 'status');
  if (status) {
    assert.ok(status.items.length <= 8);
    for (const item of status.items) {
      assert.ok(String(item.value).length <= 40 && item.label.length <= 40, item.label);
    }
  }
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
}

test('widget: one interface, its figures and its alerts', async (t) => {
  const world = await started(t);
  world.ntopng.setRates(0, 12.345, 1.5);
  world.ntopng.hostAlerts[0].push(hostAlert({ severity: 6 }));
  world.ntopng.flowAlerts[0].push(flowAlert(4700));
  await world.hub.pollAll();
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const { components } = ack.data.content;
  checkBudget(ack.data.content);
  assert.equal(components[0].text, 'eth0');
  assert.deepEqual(
    components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['Réception', 12.3],
      ['Émission', 1.5],
      ['Hôtes', 6],
      ['Flux', 24],
      ['Alertes', 2],
    ],
  );
  const rows = components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Score Threshold Exceeded', 'Dropped Alerts', 'Probing Attempt'],
  );
  assert.equal(rows[2].value, '192.0.2.3 ×1');
  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { settings: {} });
  assert.equal(refreshed.success, true, refreshed.error);
});

test('widget: several interfaces, the totals and one row each', async (t) => {
  const ntopng = new FakeNtopng();
  ntopng.addInterface(1, 'eth1');
  const world = await started(t, { ntopng });
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(ack.success, true, ack.error);
  checkBudget(ack.data.content);
  const rows = ack.data.content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.slice(0, 2).map((row) => row.label),
    ['eth0', 'eth1'],
  );
  const one = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { interface: interfaceId(world.gladys, 'eth1') },
    language: 'en',
  });
  assert.equal(one.data.content.components[0].text, 'eth1');
});

test('widget: says why when ntopng refuses', async (t) => {
  const world = await started(t, { config: config({ api_token: 'wrong' }) });
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(ack.data.content.components[1].text, /API-Token oder Passwort abgelehnt/);
});

// --- Scene actions and connection test -------------------------------------------

test('scene action: the state of an interface, with a summary', async (t) => {
  const world = await started(t, { config: config({ language: 'fr' }) });
  world.ntopng.setRates(0, 12.345, 0.5);
  world.clock.advance(20_000);
  const ack = await world.fake.sceneAction('get_interface_status', {
    interface: interfaceId(world.gladys),
  });
  assert.equal(ack.success, true, ack.error);
  const { outputs } = ack.data;
  assert.equal(outputs.download_mbps, 12.35);
  assert.equal(outputs.highest_severity, 'Erreur');
  assert.equal(
    outputs.summary,
    'eth0 : réception 12,3 Mbit/s, émission 500 kbit/s, 6 hôte(s), 24 flux, 1 alerte(s) en cours',
  );
});

test('scene action: the recent alerts, on every interface', async (t) => {
  const world = await started(t);
  world.ntopng.flowAlerts[0].push(flowAlert(4700), flowAlert(4701));
  world.clock.advance(20_000);
  const ack = await world.fake.sceneAction('get_recent_alerts', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    count: 2,
    engaged: 1,
    summary: 'eth0: Dropped Alerts (Error), Probing Attempt (Error, 192.0.2.3, 2 times)',
  });
});

test('scene action: an unknown interface is an error in the chosen language', async (t) => {
  const world = await started(t, { config: config({ language: 'es' }) });
  const ack = await world.fake.sceneAction('get_interface_status', { interface: 'nope' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /no es una interfaz supervisada por ntopng/);
});

test('"Test the connection" says what ntopng holds', async (t) => {
  const world = await started(t);
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    '192.0.2.2: ntopng 7.0.261022 Community answers, 1 interface(s), 6 active host(s), 1 engaged alert(s)',
  );
});

// --- Found by the review ---------------------------------------------------------

test('a new address during a read: the new ntopng is read at once', async (t) => {
  const world = await started(t);
  const reading = world.hub.pollAll();
  const other = world.hub.reconfigure({ ...world.hub.config, token: 'wrong' });
  await Promise.all([reading, other]);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /refused/);
});

test('ntopng reinstalled: the alert cursor follows its new database', async (t) => {
  const world = await started(t);
  assert.equal(world.hub.saved.eth0.flowRowId, 4407);
  // ntopng restarts with an empty database: uptime back to a few seconds, row ids from 1.
  world.ntopng.data[0].uptime_sec = 5;
  world.ntopng.flowAlerts[0] = [flowAlert(1)];
  world.clock.advance(3600_000);
  await world.hub.pollAll();
  assert.equal(world.hub.saved.eth0.flowRowId, 1);
  world.ntopng.flowAlerts[0].push(flowAlert(2));
  await world.hub.pollAll();
  assert.equal(events(world, TRIGGERS.ALERT).length, 1);
});

test('throughput threshold: a restart during an excess does not repeat "above"', async (t) => {
  const first = await started(t, { config: config({ rate_threshold_mbps: '10' }) });
  first.ntopng.setRates(0, 20, 0);
  await first.hub.pollAll();
  await first.hub.pollAll();
  assert.equal(events(first, TRIGGERS.THRESHOLD).length, 1);
  await first.app.stop();
  const second = await started(t, {
    config: config({ rate_threshold_mbps: '10' }),
    dataDir: first.dataDir,
    ntopng: first.ntopng,
  });
  await second.hub.pollAll();
  assert.deepEqual(events(second, TRIGGERS.THRESHOLD), []);
  second.ntopng.setRates(0, 1, 0);
  await second.hub.pollAll();
  await second.hub.pollAll();
  assert.deepEqual(
    events(second, TRIGGERS.THRESHOLD).map(({ data }) => data.state),
    ['below'],
  );
});
