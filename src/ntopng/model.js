// -----------------------------------------------------------------------------
// From the answers of ntopng (src/ntopng/client.js) to plain values: the
// snapshot of an interface, the alerts (engaged or stored), the local hosts.
// Everything ntopng may leave out or change is optional here: a missing
// figure is null, never a crash. Checked against the answers of ntopng 7.0
// Community (test/fixtures/ntopng/).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

// ntopng severities (alert_consts): 1 debug, 2 info, 3 notice, 4 warning,
// 5 error, 6 critical, 7 alert, 8 emergency. The keys are the scene filter
// values: permanent once published.
export const SEVERITIES = Object.freeze([
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'emergency',
]);

/** The severity key of an ntopng severity id. */
export function severityKey(id) {
  const value = Number(id);
  if (!Number.isFinite(value) || value <= 2) {
    return 'info';
  }
  if (value >= 8) {
    return 'emergency';
  }
  return { 3: 'notice', 4: 'warning', 5: 'error', 6: 'critical', 7: 'critical' }[value] ?? 'info';
}

export const severityRank = (key) => SEVERITIES.indexOf(key);

const number = (value) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

/** The device id of an interface: its name, made safe, stable across restarts. */
export function interfaceKey(ifname) {
  const name = String(ifname ?? '');
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (slug && slug === name) {
    return slug;
  }
  // `tcp://127.0.0.1:5556` and `tcp://127.0.0.1:5557` slug alike: a hash tells them apart.
  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  return slug ? `${slug}-${hash}` : hash;
}

/** The interfaces listed by ntopng: `[{ ifid, ifname, name, key }]`. */
export function parseInterfaces(list) {
  const seen = new Set();
  const interfaces = [];
  for (const entry of list ?? []) {
    const ifid = number(entry?.ifid);
    const ifname = typeof entry?.ifname === 'string' ? entry.ifname : '';
    if (ifid === null || !ifname) {
      continue;
    }
    const key = interfaceKey(ifname);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : ifname;
    interfaces.push({ ifid, ifname, name, key });
  }
  return interfaces;
}

/** The highest severity of the alert counters of an interface, 'none' without alert. */
function highestCounter(data) {
  const counted = (prefix) => [
    ['error', number(data[`${prefix}_error`])],
    ['warning', number(data[`${prefix}_warning`])],
    ['notice', number(data[`${prefix}_notice`])],
  ];
  let best = 'none';
  for (const [key, count] of [...counted('engaged_alerts'), ...counted('alerted_flows')]) {
    if (count > 0 && (best === 'none' || severityRank(key) > severityRank(best))) {
      best = key;
    }
  }
  return best;
}

/** What Gladys shows of an interface, from `get/interface/data.lua`. */
export function parseSnapshot(data) {
  const bps = (direction) => number(data?.throughput?.[direction]?.bps);
  const download = bps('download');
  const upload = bps('upload');
  return {
    // Mbit/s, the unit of the Gladys data rate features.
    downloadMbps: download === null ? null : download / 1e6,
    uploadMbps: upload === null ? null : upload / 1e6,
    hosts: number(data?.num_hosts),
    localHosts: number(data?.num_local_hosts),
    flows: number(data?.num_flows),
    devices: number(data?.num_devices),
    engagedAlerts: number(data?.engaged_alerts),
    alertedFlows: number(data?.alerted_flows),
    highestSeverity: data ? highestCounter(data) : 'none',
    uptimeSeconds: number(data?.uptime_sec),
  };
}

const stripHtml = (text) =>
  String(text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const hostOf = (field) => ({
  ip:
    typeof field?.ip === 'string' ? field.ip : typeof field?.value === 'string' ? field.value : '',
  name: stripHtml(field?.label_long ?? field?.name ?? field?.label ?? ''),
});

/**
 * One alert record of ntopng, engaged or stored: who, what, how bad.
 * For a flow, the host is the attacker when ntopng knows it, else the client.
 */
export function parseAlert(record, family) {
  const typeId = number(record?.alert_id?.value ?? record?.msg?.value);
  const type = stripHtml(
    record?.alert_name ?? record?.msg?.name ?? record?.alert_id?.label ?? `#${typeId}`,
  );
  let host = { ip: '', name: '' };
  if (family === 'flow') {
    const client = hostOf(record?.cli_ip ?? record?.flow?.cli_ip);
    const server = hostOf(record?.srv_ip ?? record?.flow?.srv_ip);
    const attacker =
      record?.srv_role?.value === 'attacker' && record?.cli_role?.value !== 'attacker';
    host = attacker ? server : client;
  } else if (family === 'host') {
    host = hostOf(record?.ip);
  }
  const subject = family === 'interface' ? stripHtml(record?.subtype?.value ?? '') : '';
  const description = stripHtml(
    record?.msg?.description ?? record?.description?.descr ?? record?.description ?? '',
  );
  return {
    family,
    typeId,
    type: type || `#${typeId}`,
    severity: severityKey(record?.severity?.value),
    host: host.ip,
    hostName: host.name && host.name !== host.ip ? host.name : '',
    description,
    time: number(record?.tstamp?.value),
    rowId: number(record?.row_id),
    // The identity of an engaged alert across reads (its row id is an index).
    key: `${family}:${typeId}:${host.ip}:${subject}`,
  };
}

const MULTICAST_V4 = /^(22[4-9]|23\d)\./;

/** A local host that is a machine: not a multicast or broadcast address. */
export function parseHost(entry) {
  const ip = typeof entry?.host?.ip === 'string' ? entry.host.ip : '';
  const mac = typeof entry?.host?.mac?.address === 'string' ? entry.host.mac.address : '';
  if (
    !ip ||
    MULTICAST_V4.test(ip) ||
    ip === '255.255.255.255' ||
    /^ff[0-9a-f]{2}:/i.test(ip) ||
    // A group MAC (multicast or broadcast): the low bit of the first byte.
    (mac && parseInt(mac.slice(0, 2), 16) % 2 === 1)
  ) {
    return null;
  }
  const name = stripHtml(entry?.hostname?.name ?? '');
  return {
    ip,
    mac: mac === '00:00:00:00:00:00' ? '' : mac.toUpperCase(),
    name: name && name !== ip ? name : '',
    firstSeen: number(entry?.first_seen),
  };
}

/** The identity of a host: its MAC (stable across IPv6 privacy addresses), else its IP. */
export const hostKey = (host) => host.mac || host.ip;
