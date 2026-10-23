// -----------------------------------------------------------------------------
// The configuration and the reading of the real answers of ntopng 7.0
// Community (test/fixtures/ntopng/): addresses, interface ids, snapshot,
// alerts, hosts, severities.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseThreshold, parseUrl } from '../src/config.js';
import {
  interfaceKey,
  parseAlert,
  parseHost,
  parseInterfaces,
  parseSnapshot,
  severityKey,
} from '../src/ntopng/model.js';
import { readFixture } from './helpers/fakeNtopng.js';

test('the address: bare host, host:port, URL copied from the browser', () => {
  assert.equal(parseUrl('192.0.2.2'), 'http://192.0.2.2:3000');
  assert.equal(parseUrl('ntop.lan:3001'), 'http://ntop.lan:3001');
  assert.equal(parseUrl('https://ntop.lan:3001/lua/index.lua'), 'https://ntop.lan:3001');
  assert.equal(parseUrl('https://example.org/ntopng/'), 'https://example.org/ntopng');
  assert.equal(parseUrl('http://admin:pw@192.0.2.2:3000'), null, 'no credentials in the URL');
  assert.equal(parseUrl('ftp://192.0.2.2'), null);
  assert.equal(parseUrl(''), null);
});

test('the configuration: token prefix, threshold with a comma, defaults', () => {
  const config = normalizeConfig({
    url: ' 192.0.2.2 ',
    api_token: 'Token abc123\n',
    rate_threshold_mbps: '12,5',
    poll_interval: '7',
  });
  assert.equal(config.token, 'abc123');
  assert.equal(config.thresholdMbps, 12.5);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ url: 'ftp://x' }).invalidUrl, true);
  assert.equal(parseThreshold(''), null);
  assert.equal(parseThreshold('-3'), null);
  assert.equal(parseThreshold('0'), null);
});

test('interface ids: the name when it is safe, a hashed slug otherwise', () => {
  assert.equal(interfaceKey('eth0'), 'eth0');
  assert.equal(interfaceKey('br-lan'), 'br-lan');
  assert.match(interfaceKey('tcp://127.0.0.1:5556'), /^tcp-127.0.0.1-5556-[0-9a-f]{8}$/);
  assert.notEqual(interfaceKey('tcp://127.0.0.1:5556'), interfaceKey('tcp://127.0.0.1:5557'));
  assert.notEqual(interfaceKey('ETH0'), interfaceKey('eth0'));
  assert.deepEqual(parseInterfaces(readFixture('interfaces.json').rsp), [
    { ifid: 0, ifname: 'eth0', name: 'eth0', key: 'eth0' },
  ]);
});

test('the snapshot of a real interface answer', () => {
  const snapshot = parseSnapshot(readFixture('interface-data.json').rsp);
  assert.deepEqual(snapshot, {
    downloadMbps: 0,
    uploadMbps: 0,
    hosts: 6,
    localHosts: 6,
    flows: 24,
    devices: snapshot.devices,
    engagedAlerts: 1,
    alertedFlows: 22,
    highestSeverity: 'error',
    uptimeSeconds: snapshot.uptimeSeconds,
  });
  assert.equal(parseSnapshot({}).highestSeverity, 'none');
});

test('the alerts of real answers: a flow alert and an engaged interface alert', () => {
  const flow = parseAlert(readFixture('flow-alerts-new.json').rsp.records[0], 'flow');
  assert.deepEqual(
    [flow.type, flow.severity, flow.host, flow.hostName, flow.rowId, flow.description],
    ['Probing Attempt', 'error', '192.0.2.3', 'client.lan', 4407, 'TCP probing attempt'],
  );
  const engaged = parseAlert(
    readFixture('interface-alerts-engaged.json').rsp.records[0],
    'interface',
  );
  assert.equal(engaged.type, 'Dropped Alerts');
  assert.equal(engaged.key, 'interface:4099::eth0');
  assert.match(engaged.description, /^Interface eth0 is dropping alerts\./);
});

test('the local hosts of a real answer, without multicast groups', () => {
  const hosts = readFixture('hosts-local.json').rsp.map(parseHost);
  assert.deepEqual(hosts[0], {
    ip: '192.0.2.4',
    mac: '02:00:5E:00:00:01',
    name: 'laptop.lan',
    firstSeen: 1792778899,
  });
  assert.equal(parseHost({ host: { ip: 'ff02::2', mac: { address: '33:33:00:00:00:02' } } }), null);
  assert.equal(parseHost({ host: { ip: '224.0.0.251', mac: { address: '' } } }), null);
});

test('the severities of ntopng, in keys', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, undefined].map(severityKey), [
    'info',
    'info',
    'notice',
    'warning',
    'error',
    'critical',
    'critical',
    'emergency',
    'info',
  ]);
});
