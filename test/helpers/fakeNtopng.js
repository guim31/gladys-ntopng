// -----------------------------------------------------------------------------
// An in-memory ntopng on a fake network, served from the real answers of
// ntopng 7.0 Community (test/fixtures/ntopng/, anonymized). The tests change
// what it answers (an alert engaged, flow alerts stored, a new host, ntopng
// down or starting) and the integration reads it through the very same client.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const TOKEN = 'test-token-not-a-secret';
export const BASE_URL = 'http://192.0.2.2:3000';

export const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ntopng/${name}`, import.meta.url), 'utf8'));

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const redirect = (location) => ({ status: 302, headers: { location }, body: '' });

const ok = (rsp, extra = {}) => ({
  rc: 0,
  rc_str: 'OK',
  rc_str_hr: 'Success',
  ...extra,
  rsp,
});

const FLOW_RECORD = readFixture('flow-alerts-new.json').rsp.records[0];
const ENGAGED_RECORD = readFixture('interface-alerts-engaged.json').rsp.records[0];
const HOST_RECORD = readFixture('hosts-local.json').rsp[0];

/** A flow alert as ntopng stores it, from the real record. */
export function flowAlert(
  rowId,
  { typeId = 101, type = 'Probing Attempt', severity = 5, client = '192.0.2.3' } = {},
) {
  const record = structuredClone(FLOW_RECORD);
  record.row_id = String(rowId);
  record.alert_id = { value: String(typeId), label: type };
  record.alert_name = type;
  record.msg.name = type;
  record.msg.value = typeId;
  record.severity.value = severity;
  record.cli_ip.ip = client;
  record.cli_ip.value = client;
  record.cli_ip.name = client;
  record.cli_ip.label_long = client;
  return record;
}

/** An engaged alert on a host, shaped like the host alert store formats it. */
export function hostAlert({
  typeId = 32,
  type = 'Score Threshold Exceeded',
  severity = 4,
  ip = '192.0.2.4',
  name = 'laptop.lan',
} = {}) {
  const record = structuredClone(ENGAGED_RECORD);
  delete record.subtype;
  record.family = 'host';
  record.alert_id = { value: typeId, label: type };
  record.alert_name = type;
  record.msg = {
    name: type,
    value: typeId,
    description: `Host <a href="#">${ip}</a> score is high`,
  };
  record.severity.value = severity;
  record.ip = { value: ip, label: name, label_long: name, shown_label: name };
  return record;
}

/** A local host as active_list.lua lists it. */
export function localHost({ ip, mac, name = '', firstSeen = 1792779000 }) {
  const host = structuredClone(HOST_RECORD);
  host.host.ip = ip;
  host.host.mac.address = mac;
  host.hostname.name = name;
  host.first_seen = firstSeen;
  return host;
}

export class FakeNtopng {
  /**
   * @param {object} [options]
   * @param {string} [options.token] the API token ntopng accepts
   */
  constructor({ token = TOKEN } = {}) {
    this.token = token;
    this.password = 'not-a-secret-either';
    this.interfaces = readFixture('interfaces.json').rsp;
    this.data = { 0: readFixture('interface-data.json').rsp };
    this.about = readFixture('about.json').rsp;
    this.hostAlerts = { 0: [] };
    this.interfaceAlerts = { 0: readFixture('interface-alerts-engaged.json').rsp.records };
    this.flowAlerts = { 0: readFixture('flow-alerts-new.json').rsp.records };
    this.hosts = { 0: readFixture('hosts-local.json').rsp };
    /** null, 'down', 'starting', 'html', 'proxy', 'password_change' */
    this.failure = null;
    /** Answer NOT_GRANTED to the alert lists (a user without the alerts right). */
    this.alertsDenied = false;
    this.requests = [];
  }

  /** A second monitored interface, a copy of the first one. */
  addInterface(ifid, ifname) {
    this.interfaces.push({ ifid, ifname, name: ifname, is_packet_interface: true });
    this.data[ifid] = { ...structuredClone(this.data[0]), ifid: String(ifid), ifname };
    this.hostAlerts[ifid] = [];
    this.interfaceAlerts[ifid] = [];
    this.flowAlerts[ifid] = [];
    this.hosts[ifid] = [];
  }

  setRates(ifid, downloadMbps, uploadMbps) {
    this.data[ifid].throughput = {
      download: { bps: downloadMbps * 1e6, pps: 1 },
      upload: { bps: uploadMbps * 1e6, pps: 1 },
    };
  }

  authorized(headers) {
    const auth = headers.authorization ?? '';
    if (auth === `Token ${this.token}`) {
      return true;
    }
    const basic = auth.match(/^Basic (.+)$/);
    return Boolean(
      basic && Buffer.from(basic[1], 'base64').toString() === `admin:${this.password}`,
    );
  }

  handle(path, headers) {
    this.requests.push(path);
    if (this.failure === 'down') {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.failure === 'starting') {
      return { status: 503, headers: {}, body: "<html><h1>We're almost ready&hellip;</h1></html>" };
    }
    if (this.failure === 'html') {
      return { status: 200, headers: {}, body: '<html>Router login</html>' };
    }
    if (this.failure === 'proxy') {
      return { status: 502, headers: {}, body: 'Bad gateway' };
    }
    const url = new URL(path, 'http://ntopng');
    const referer = encodeURIComponent(url.pathname);
    if (this.failure === 'password_change') {
      return redirect(`/lua/change_password.lua?referer=${referer}`);
    }
    if (!this.authorized(headers)) {
      return redirect(`http://192.0.2.2:3000/lua/login.lua?referer=${referer}`);
    }
    const ifid = Number(url.searchParams.get('ifid'));
    const known = url.searchParams.has('ifid') && ifid in this.data;
    const invalid = json(200, readFixture('invalid-interface.json'));
    const denied = json(401, { rc: -3, rc_str: 'NOT_GRANTED', rsp: [] });
    switch (url.pathname) {
      case '/lua/rest/v2/get/ntopng/interfaces.lua':
        return json(200, ok(this.interfaces));
      case '/lua/rest/v2/get/ntopng/about.lua':
        return json(200, ok(this.about));
      case '/lua/rest/v2/get/interface/data.lua':
        return known ? json(200, ok(this.data[ifid])) : invalid;
      case '/lua/rest/v2/get/host/alert/list.lua':
      case '/lua/rest/v2/get/interface/alert/list.lua': {
        if (this.alertsDenied) {
          return denied;
        }
        const list = url.pathname.includes('/host/') ? this.hostAlerts : this.interfaceAlerts;
        const records = list[ifid] ?? [];
        return json(200, ok({ records, stats: [] }, { recordsTotal: records.length }));
      }
      case '/lua/rest/v2/get/flow/alert/list.lua': {
        if (this.alertsDenied) {
          return denied;
        }
        const after = Number((url.searchParams.get('row_id') ?? '0;gt').split(';')[0]);
        const length = Number(url.searchParams.get('length') ?? 10);
        const all = (this.flowAlerts[ifid] ?? [])
          .filter((record) => Number(record.row_id) > after)
          .sort((a, b) => Number(b.row_id) - Number(a.row_id));
        return json(
          200,
          ok({ records: all.slice(0, length), stats: {} }, { recordsFiltered: all.length }),
        );
      }
      case '/lua/rest/v2/get/host/active_list.lua': {
        const length = Number(url.searchParams.get('length') ?? 10);
        const hosts = [...(this.hosts[ifid] ?? [])].sort((a, b) => b.first_seen - a.first_seen);
        return json(200, ok(hosts.slice(0, length), { recordsTotal: hosts.length }));
      }
      default:
        return { status: 404, headers: {}, body: '<html>Not found</html>' };
    }
  }
}

/**
 * A fake network: the base URL answered by a FakeNtopng, the rest refused.
 * @param {Record<string, FakeNtopng>} servers
 */
export function createNetwork(servers) {
  return {
    async request(url, { headers = {} } = {}) {
      for (const [base, server] of Object.entries(servers)) {
        if (url.startsWith(`${base}/`)) {
          return server.handle(url.slice(base.length), headers);
        }
      }
      const error = new Error('connect EHOSTUNREACH');
      error.code = 'EHOSTUNREACH';
      throw error;
    },
  };
}
