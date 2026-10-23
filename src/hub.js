// -----------------------------------------------------------------------------
// The ntopng hub: one ntopng instance, one state per interface it monitors,
// read on a timer of the container (the interval chosen in the
// configuration). Per read: the interface list, then per interface its data
// (throughput, hosts, flows, alert counters), its engaged alerts (hosts and
// interface), the flow alerts stored since the last read, and its newest
// local hosts (the whole list once an hour).
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every interface, added to Gladys or not.
//
// The 300 states per minute of Gladys: only the devices added are published,
// only what changed (rounded), the values that move at every read at most
// once a minute. Every value is sent again after 6 hours unchanged, before
// the core marks it outdated.
//
// Scene events: a port scan writes thousands of flow alerts. They are grouped
// per read by (type, host), and a group fires at most once an hour; at most
// 20 alert events per read.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ALL_HOSTS, ERROR_KINDS, NEWEST_HOSTS, NtopngClient } from './ntopng/client.js';
import {
  hostKey,
  parseAlert,
  parseHost,
  parseInterfaces,
  parseSnapshot,
  severityRank,
} from './ntopng/model.js';
import { hostOf } from './config.js';
import { buildDevice, deviceIds, featureValues, parseDeviceId } from './devices.js';
import { createIssueLog } from './logs.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  FAMILY_TEXT,
  REPORT_TEXT,
  SEVERITY_TEXT,
  THRESHOLD_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'ntopng-hub' });

export const WIDGET_KEY = 'traffic';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  ALERT: 'alert_raised',
  NEW_HOST: 'new_local_host',
  THRESHOLD: 'throughput_threshold',
});

export const HUB_TIMINGS = {
  // ntopng that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failed reads in a row before an interface counts as unreachable.
  downAfterFailures: 2,
  // The values that move at every read (rates, flows): at most this often.
  noisyEveryMs: 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // A scene action reads ntopng again when the last read is older.
  freshMs: 15_000,
  // The same alert (type and host) fires at most once in this long.
  alertCooldownMs: 3600_000,
  // The whole list of local hosts is read this often (the newest at every read).
  hostsRefreshMs: 3600_000,
  // A local host not seen for this long is new again when it comes back.
  forgetHostAfterMs: 90 * 24 * 3600_000,
  // What an interface not seen for a week left in /data is forgotten.
  forgetAfterMs: 7 * 24 * 3600_000,
  // The alerts the widget and the scene action list.
  recentMs: 24 * 3600_000,
};

// Interfaces read, at most.
export const MAX_INTERFACES = 8;
// Alert events fired per read and interface, at most (the rest is counted).
export const MAX_ALERT_EVENTS = 20;
// New host events per read and interface, at most (a first scan of a big network).
export const MAX_HOST_EVENTS = 10;
// Local hosts remembered per interface, at most.
export const MAX_KNOWN_HOSTS = 5000;
// Alert groups kept per interface for the widget and the scene action.
export const MAX_RECENT = 20;
// Reads in a row above (or below) the threshold before the event.
export const THRESHOLD_READS = 2;
// Back below means below this share of the threshold (no flapping).
export const THRESHOLD_HYSTERESIS = 0.9;

const MAX_STATES_PER_REQUEST = 100;

// Errors worth a quick second read (a blip); a refused token is a
// configuration problem, told by the connection status.
const UNREACHABLE_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.STARTING, 'gone']);

const signature = (config) =>
  JSON.stringify([
    config.url,
    config.token,
    config.username,
    config.password,
    config.allowSelfSigned,
  ]);

export class NtopngHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/ntopng/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.signature = null;
    /** The instance: its last error and read. */
    this.instance = { error: null, readAt: 0, alertsDenied: false };
    /** @type {Map<string, object>} interface states, by key */
    this.interfaces = new Map();
    /** Persisted per interface: { flowRowId, engaged, hosts, hostsReadAt, seenAt }. */
    this.saved = {};
    /** Last event per alert (interface, type, host), for the cooldown. */
    this.cooldowns = new Map();
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.polling = null;
    this.pollingClient = null;
    this.readDenied = false;
    this.savedJson = null;
    this.pendingDown = false;
    this.pollTimer = null;
    this.retryTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = saved?.interfaces && typeof saved.interfaces === 'object' ? saved.interfaces : {};
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const next = config.url ? signature(config) : null;
    if (next !== this.signature) {
      this.signature = next;
      clearTimeout(this.retryTimer);
      // Another address may be another ntopng: its interfaces are read from scratch.
      this.interfaces.clear();
      this.instance = { error: null, readAt: 0, alertsDenied: false };
      this.client = config.url
        ? new NtopngClient({
            url: config.url,
            token: config.token,
            username: config.username,
            password: config.password,
            insecure: config.allowSelfSigned,
            request: this.request,
          })
        : null;
    }
    if (config.thresholdMbps === null) {
      for (const state of this.interfaces.values()) {
        Object.assign(state, { above: false, aboveReads: 0, belowReads: 0 });
      }
    }
    if (languageChanged) {
      this.discovered = null;
    }
    try {
      await this.pollAll({ publish: true });
    } finally {
      // Even after an unexpected error: the timer keeps reading.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.pollAll()
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  // --- Names and identities ----------------------------------------------------

  interfaceId(key) {
    return deviceIds(this.gladys, key).device;
  }

  /** The keys of the interfaces the user added. */
  createdKeys() {
    const keys = new Set();
    for (const device of this.gladys.devices ?? []) {
      const key = parseDeviceId(this.gladys, device.external_id);
      if (key) {
        keys.add(key);
      }
    }
    return keys;
  }

  /** The interface of a device external id, null when unknown. */
  find(externalId) {
    const key = parseDeviceId(this.gladys, externalId);
    return key ? (this.interfaces.get(key) ?? null) : null;
  }

  isOnline(state) {
    return state.error === null && state.snapshot !== null;
  }

  /** Every interface, in the order of ntopng. */
  interfaceList() {
    return [...this.interfaces.values()].sort((a, b) => a.order - b.order);
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    return this.interfaceList()
      .filter((state) => state.snapshot !== null)
      .map((state) =>
        buildDevice(this.gladys, {
          key: state.key,
          name: `ntopng ${state.name}`,
          language: this.config.language,
        }),
      );
  }

  /** Publish the Discovery list when it changed (an interface appeared…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices.map((device) => [device.name, device.features]));
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read ntopng, publish the list again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const state = this.find(device.external_id);
    if (!state) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishInterfaceStates(state, { force: true });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted a device: forget what was sent for it. */
  onDeviceDeleted(device) {
    const id = device?.external_id;
    if (typeof id !== 'string') {
      return;
    }
    this.transports.delete(id);
    for (const map of [this.published, this.publishedAt]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${id}:`)) {
          map.delete(key);
        }
      }
    }
  }

  // --- Reading ntopng ----------------------------------------------------------

  /** Read ntopng. Concurrent calls share the read. */
  pollAll({ publish = false } = {}) {
    if (!this.client) {
      return this.afterChanges(false, { publish });
    }
    // Concurrent calls share the read, unless the configuration changed
    // meanwhile: then a read with the new client follows the old one.
    if (!this.polling || this.pollingClient !== this.client) {
      const client = this.client;
      const previous = this.polling ?? Promise.resolve();
      const run = previous
        .catch(() => {})
        .then(() => this.read(client))
        .then(async (changed) => {
          this.forgetStale();
          await this.afterChanges(changed, { publish });
        })
        .finally(() => {
          if (this.polling === run) {
            this.polling = null;
          }
        });
      this.polling = run;
      this.pollingClient = client;
    }
    return publish ? this.polling.then(() => this.publishDevices({ force: true })) : this.polling;
  }

  /** Read ntopng again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.now() - this.instance.readAt >= this.timings.freshMs) {
      await this.pollAll();
    }
  }

  /**
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  async read(client) {
    let listed;
    try {
      listed = parseInterfaces(await client.interfaces());
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.instanceFailed(client, err);
    }
    if (client !== this.client) {
      return false;
    }
    let changed = this.instance.error !== null || this.instance.readAt === 0;
    this.readDenied = false;
    if (this.instance.error) {
      logger.info('ntopng answers again');
    }
    this.instance.error = null;
    this.instance.readAt = this.now();
    if (listed.length > MAX_INTERFACES) {
      this.issues.fail(
        'interfaces',
        'warn',
        `ntopng monitors ${listed.length} interfaces: the first ${MAX_INTERFACES} are read`,
      );
    }
    const kept = listed.slice(0, MAX_INTERFACES);
    const keys = new Set(kept.map((entry) => entry.key));
    for (const state of this.interfaces.values()) {
      if (!keys.has(state.key)) {
        changed = this.interfaceFailed(state, 'gone') || changed;
      }
    }
    const results = await Promise.all(
      kept.map((entry, order) => this.readInterface(client, entry, order)),
    );
    if (results.some(Boolean)) {
      changed = true;
    }
    // One line when the alerts become unreadable, one when they are back.
    if (this.readDenied !== this.instance.alertsDenied) {
      this.instance.alertsDenied = this.readDenied;
      if (this.readDenied) {
        logger.warn('This ntopng user may not read the alerts: no alert events');
      } else {
        logger.info('The alerts can be read again');
      }
    }
    this.saveIfChanged();
    return changed;
  }

  /** Write /data only when something changed (an SD card wears out). */
  saveIfChanged() {
    const json = JSON.stringify(this.saved);
    if (json !== this.savedJson) {
      this.savedJson = json;
      this.store.save({ interfaces: this.saved });
    }
  }

  interfaceState(entry, order) {
    let state = this.interfaces.get(entry.key);
    if (!state) {
      state = {
        key: entry.key,
        ifid: entry.ifid,
        ifname: entry.ifname,
        name: entry.name,
        order,
        snapshot: null,
        engaged: [],
        recent: [],
        error: null,
        failures: 0,
        down: false,
        readAt: 0,
        above: false,
        aboveReads: 0,
        belowReads: 0,
      };
      this.interfaces.set(entry.key, state);
    }
    Object.assign(state, { ifid: entry.ifid, ifname: entry.ifname, name: entry.name, order });
    return state;
  }

  async readInterface(client, entry, order) {
    const state = this.interfaceState(entry, order);
    const stale = () => client !== this.client || this.interfaces.get(state.key) !== state;
    const saved = (this.saved[state.key] ??= {});
    const now = this.now();
    const refreshHosts = now - (saved.hostsReadAt ?? 0) >= this.timings.hostsRefreshMs;
    let data;
    let engaged;
    let flows;
    let hosts;
    try {
      [data, engaged, flows, hosts] = await Promise.all([
        client.interfaceData(entry.ifid),
        this.optional(client.engagedAlerts(entry.ifid)),
        this.optional(client.flowAlerts(entry.ifid, cursorOf(saved))),
        client.localHosts(entry.ifid, refreshHosts ? ALL_HOSTS : NEWEST_HOSTS),
      ]);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return stale() ? false : this.interfaceFailed(state, err.kind);
    }
    if (stale()) {
      return false;
    }
    if (!data) {
      return this.interfaceFailed(state, 'gone');
    }
    let changed = state.error !== null || state.readAt === 0;
    if (state.error === 'gone') {
      logger.info(`Interface ${state.name} is back`);
    }
    if (state.readAt === 0) {
      // A restart during an excess: "back below" still comes, "above" not twice.
      state.above = saved.above === true;
    }
    state.snapshot = parseSnapshot(data);
    state.error = null;
    state.failures = 0;
    state.down = false;
    state.readAt = now;
    saved.seenAt = day(now);
    await this.checkRestart(client, state, saved, flows);
    if (engaged !== null && (await this.compareEngaged(state, saved, engaged))) {
      changed = true;
    }
    if (flows !== null && (await this.readFlowAlerts(state, saved, flows))) {
      changed = true;
    }
    await this.compareHosts(state, saved, hosts, refreshHosts);
    await this.checkThreshold(state);
    saved.above = state.above;
    await this.publishInterfaceStates(state);
    return changed;
  }

  /**
   * ntopng restarted (its start time moved): its alert database may have been
   * reset (reinstalled, container without volume), and its row ids start
   * again from 1, below the cursor. Read the newest row then, and go back to it.
   */
  async checkRestart(client, state, saved, flows) {
    const uptime = state.snapshot.uptimeSeconds;
    if (uptime === null) {
      return;
    }
    const startedAt = Math.round((this.now() / 1000 - uptime) / 600) * 600;
    const restarted =
      Number.isFinite(saved.startedAt) && Math.abs(startedAt - saved.startedAt) > 600;
    saved.startedAt = Number.isFinite(saved.startedAt) && !restarted ? saved.startedAt : startedAt;
    const cursor = cursorOf(saved);
    if (!restarted || !cursor || flows === null || flows.records.length > 0) {
      return;
    }
    try {
      const newest = await client.flowAlerts(state.ifid, null);
      const top = parseAlert(newest.records[0] ?? {}, 'flow').rowId ?? 0;
      if (top < cursor) {
        logger.info(`${state.name}: the alert database of ntopng starts again`);
        saved.flowRowId = top;
      }
    } catch (err) {
      logger.debug(`${state.name}: newest flow alert unreadable (${err.message})`);
    }
  }

  /** The alert lists need the "alerts" right: without it, the rest still works. */
  async optional(promise) {
    try {
      return await promise;
    } catch (err) {
      if (err.kind !== ERROR_KINDS.NOT_GRANTED) {
        throw err;
      }
      this.readDenied = true;
      return null;
    }
  }

  /**
   * The engaged alerts (hosts and interface): an alert engaged since the last
   * read fires once. The first read of an interface (nothing in /data) only
   * records them.
   */
  async compareEngaged(state, saved, records) {
    const alerts = records.map((record) => parseAlert(record, record.family));
    // Most severe first, for the widget.
    alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const before = Array.isArray(saved.engaged) ? new Set(saved.engaged) : null;
    const keys = alerts.map((alert) => alert.key);
    const changed =
      JSON.stringify(state.engaged.map((alert) => alert.key)) !== JSON.stringify(keys);
    state.engaged = alerts;
    saved.engaged = keys;
    if (before === null) {
      return changed;
    }
    let fired = 0;
    for (const alert of alerts) {
      if (before.has(alert.key) || fired >= MAX_ALERT_EVENTS) {
        continue;
      }
      if (await this.fireAlert(state, alert, 1)) {
        fired += 1;
      }
    }
    return changed;
  }

  /**
   * The flow alerts stored since the last read, grouped by (type, host): one
   * event per group, at most once an hour per group. The first read only
   * records where the alert log stands.
   */
  async readFlowAlerts(state, saved, { records, total }) {
    const alerts = records.map((record) => parseAlert(record, 'flow'));
    const rows = alerts.map((alert) => alert.rowId).filter((id) => id !== null);
    if (records.length > 0 && rows.length === 0) {
      // ClickHouse (Enterprise) has no numeric row id: no cursor, no events.
      this.issues.fail(
        `rowid-${state.key}`,
        'warn',
        `${state.name}: flow alerts without a numeric row id, no flow alert events`,
      );
      return false;
    }
    const first = cursorOf(saved) === null;
    if (rows.length > 0) {
      saved.flowRowId = Math.max(cursorOf(saved) ?? 0, ...rows);
    } else if (first) {
      saved.flowRowId = 0;
    }
    if (first || alerts.length === 0) {
      return false;
    }
    if (total > alerts.length) {
      logger.debug(`${state.name}: ${total} new flow alerts, the newest ${alerts.length} read`);
    }
    const groups = new Map();
    for (const alert of alerts) {
      const key = `${alert.typeId}|${alert.host}`;
      const group = groups.get(key);
      if (group) {
        group.count += 1;
        if (severityRank(alert.severity) > severityRank(group.alert.severity)) {
          group.alert = { ...alert };
        }
      } else {
        groups.set(key, { alert, count: 1 });
      }
    }
    // The most severe groups first, when the budget of events is short.
    const sorted = [...groups.values()].sort(
      (a, b) =>
        severityRank(b.alert.severity) - severityRank(a.alert.severity) || b.count - a.count,
    );
    let fired = 0;
    for (const { alert, count } of sorted) {
      this.remember(state, alert, count);
      if (fired < MAX_ALERT_EVENTS && (await this.fireAlert(state, alert, count))) {
        fired += 1;
      }
    }
    return true;
  }

  /** Keep an alert group for the widget and the scene action (newest first). */
  remember(state, alert, count) {
    const now = this.now();
    const existing = state.recent.find(
      (item) => item.typeId === alert.typeId && item.host === alert.host,
    );
    if (existing) {
      existing.count += count;
      existing.at = now;
      if (severityRank(alert.severity) > severityRank(existing.severity)) {
        existing.severity = alert.severity;
      }
      state.recent = [existing, ...state.recent.filter((item) => item !== existing)];
    } else {
      state.recent.unshift({ ...alert, count, at: now });
    }
    state.recent = state.recent
      .filter((item) => now - item.at < this.timings.recentMs)
      .slice(0, MAX_RECENT);
  }

  /** Fire an alert event, unless the same one fired within the cooldown. */
  async fireAlert(state, alert, count) {
    const key = `${state.key}|${alert.key}`;
    const now = this.now();
    if (now - (this.cooldowns.get(key) ?? -Infinity) < this.timings.alertCooldownMs) {
      return false;
    }
    this.cooldowns.set(key, now);
    const language = this.config.language;
    logger.debug(`${state.name}: alert ${alert.type} (${alert.severity}) ${alert.host}`);
    await this.fireEvent(TRIGGERS.ALERT, {
      interface: this.interfaceId(state.key),
      severity: alert.severity,
      alert_type: alert.type,
      host: alert.host,
      interface_name: state.name,
      severity_label: pick(SEVERITY_TEXT[alert.severity], language),
      origin: pick(FAMILY_TEXT[alert.family], language),
      host_name: alert.hostName,
      description: alert.description.slice(0, 500),
      count,
    });
    return true;
  }

  /**
   * The local hosts: one never seen before fires `new_local_host`. The first
   * read of an interface records them all, silently.
   */
  async compareHosts(state, saved, entries, full) {
    const now = this.now();
    const hosts = entries.map(parseHost).filter(Boolean);
    const known = saved.hosts && typeof saved.hosts === 'object' ? saved.hosts : null;
    const next = known ?? {};
    let fired = 0;
    for (const host of hosts) {
      const key = hostKey(host);
      if (known !== null && !(key in known)) {
        if (fired < MAX_HOST_EVENTS) {
          fired += 1;
          logger.debug(`${state.name}: new local host ${host.ip}`);
          await this.fireEvent(TRIGGERS.NEW_HOST, {
            interface: this.interfaceId(state.key),
            interface_name: state.name,
            ip: host.ip,
            mac: host.mac,
            host_name: host.name,
          });
        }
      }
      // A day is enough to forget a host after months, and spares /data a write per read.
      next[key] = day(now);
    }
    // Forget the hosts not seen for months; keep the most recent ones at most.
    const entriesKept = Object.entries(next)
      .filter(([, seenAt]) => now - seenAt < this.timings.forgetHostAfterMs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KNOWN_HOSTS);
    saved.hosts = Object.fromEntries(entriesKept);
    if (full) {
      saved.hostsReadAt = now;
    }
  }

  /** Total throughput above the threshold for two reads, then back below 90 % of it. */
  async checkThreshold(state) {
    const threshold = this.config.thresholdMbps;
    const { downloadMbps, uploadMbps } = state.snapshot;
    if (threshold === null) {
      state.above = false;
      return;
    }
    if (downloadMbps === null || uploadMbps === null) {
      return;
    }
    const total = downloadMbps + uploadMbps;
    if (!state.above) {
      state.aboveReads = total > threshold ? state.aboveReads + 1 : 0;
      if (state.aboveReads < THRESHOLD_READS) {
        return;
      }
      state.above = true;
      state.aboveReads = 0;
    } else {
      state.belowReads = total < threshold * THRESHOLD_HYSTERESIS ? state.belowReads + 1 : 0;
      if (state.belowReads < THRESHOLD_READS) {
        return;
      }
      state.above = false;
      state.belowReads = 0;
    }
    const status = state.above ? 'above' : 'below';
    const round = (value) => Math.round(value * 100) / 100;
    logger.debug(`${state.name}: throughput ${status} ${threshold} Mbit/s`);
    await this.fireEvent(TRIGGERS.THRESHOLD, {
      interface: this.interfaceId(state.key),
      state: status,
      interface_name: state.name,
      state_label: pick(THRESHOLD_TEXT[status], this.config.language),
      download_mbps: round(downloadMbps),
      upload_mbps: round(uploadMbps),
      total_mbps: round(total),
      threshold_mbps: threshold,
    });
  }

  instanceFailed(client, err) {
    if (client !== this.client) {
      return false;
    }
    const wasError = this.instance.error?.kind;
    this.instance.error = { kind: err.kind, message: err.message };
    this.instance.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`ntopng (${hostOf(this.config.url)}): ${err.message}`);
    } else {
      logger.debug(`ntopng (${hostOf(this.config.url)}): ${err.message}`);
    }
    if (UNREACHABLE_KINDS.has(err.kind) && !wasError) {
      this.scheduleRetry();
    }
    let changed = wasError !== err.kind;
    for (const state of this.interfaces.values()) {
      changed = this.interfaceFailed(state, err.kind) || changed;
    }
    return changed;
  }

  /** An interface not read: offline, and unreachable once it failed twice in a row. */
  interfaceFailed(state, kind) {
    const wasError = state.error;
    state.error = kind;
    state.readAt = this.now();
    if (wasError !== kind && kind === 'gone') {
      logger.warn(`Interface ${state.name}: ${pick(ERROR_TEXT.gone, 'en')}`);
    }
    // Any failure counts: a refused token leaves no fresh value either.
    state.failures += 1;
    if (!state.down && state.failures >= this.timings.downAfterFailures) {
      state.down = true;
      // Published at the end of the read (afterChanges): no await in a loop of states.
      this.pendingDown = true;
      return true;
    }
    return wasError !== kind;
  }

  /** Forget what /data holds for interfaces not seen for a week. */
  forgetStale() {
    let forgotten = false;
    for (const [key, entry] of Object.entries(this.saved)) {
      if (
        !this.interfaces.has(key) &&
        this.now() - (entry?.seenAt ?? 0) > this.timings.forgetAfterMs
      ) {
        delete this.saved[key];
        forgotten = true;
      }
    }
    for (const [key, at] of this.cooldowns) {
      if (this.now() - at >= this.timings.alertCooldownMs) {
        this.cooldowns.delete(key);
      }
    }
    if (forgotten) {
      this.store.save({ interfaces: this.saved });
    }
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  /**
   * The states of an interface the user added: every value once read, only
   * "unreachable" while it is down, nothing before the first read.
   */
  async publishInterfaceStates(state, { force = false } = {}) {
    if (!this.createdKeys().has(state.key)) {
      return;
    }
    let values;
    if (this.isOnline(state)) {
      values = featureValues(this.gladys, {
        key: state.key,
        item: { snapshot: state.snapshot, online: true },
        language: this.config.language,
      });
    } else if (state.down) {
      values = [{ externalId: deviceIds(this.gladys, state.key).feature('online'), value: 0 }];
    } else {
      return;
    }
    await this.sendStates(values, { force });
  }

  /** Keep what must be sent now: changed, not too soon. */
  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const due = [];
    for (const { externalId, value, noisy, text } of values) {
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      const at = this.publishedAt.get(externalId);
      if (!force) {
        if (last === value && at !== undefined && now - at < this.timings.heartbeatMs) {
          continue;
        }
        if (last !== value && noisy && at !== undefined && now - at < this.timings.noisyEveryMs) {
          continue;
        }
      }
      due.push({ externalId, value, text });
    }
    for (let at = 0; at < due.length; at += MAX_STATES_PER_REQUEST) {
      const batch = due.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(
          batch.map(({ externalId, value, text }) =>
            text
              ? { device_feature_external_id: externalId, text: value }
              : { device_feature_external_id: externalId, state: value },
          ),
        );
        for (const { externalId, value } of batch) {
          this.published.set(externalId, value);
          this.publishedAt.set(externalId, now);
        }
        this.issues.ok('states', 'States accepted again');
      } catch (err) {
        this.issues.fail('states', 'warn', `States refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    if (this.pendingDown) {
      this.pendingDown = false;
      for (const state of this.interfaces.values()) {
        if (state.down) {
          await this.publishInterfaceStates(state);
        }
      }
    }
    if (!publish) {
      await this.publishDevices();
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    const created = this.createdKeys();
    const entries = [];
    for (const state of this.interfaces.values()) {
      if (!created.has(state.key) || state.readAt === 0) {
        continue;
      }
      const externalId = this.interfaceId(state.key);
      const transport = this.isOnline(state)
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'Transports accepted again');
    } catch (err) {
      this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config?.url) {
      return {
        connected: false,
        message: this.config?.invalidUrl ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    const { error } = this.instance;
    if (error) {
      const message = {};
      for (const language of Object.keys(CONNECTION_TEXT.noUrl)) {
        message[language] = labelled(
          hostOf(this.config.url),
          pick(ERROR_TEXT[error.kind], language),
          language,
        );
      }
      return { connected: false, message };
    }
    if (this.instance.alertsDenied) {
      return { connected: true, message: ERROR_TEXT[ERROR_KINDS.NOT_GRANTED] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) -------------------------------------

  /** What the widget and the scene actions show of an interface. */
  view(state) {
    const now = this.now();
    return {
      key: state.key,
      name: state.name,
      online: this.isOnline(state),
      error: state.error,
      snapshot: state.snapshot,
      engaged: state.engaged,
      recent: state.recent.filter((item) => now - item.at < this.timings.recentMs),
    };
  }

  /** "Test the connection": read ntopng now, then say what it found. */
  async testConnection() {
    let about = null;
    if (this.client) {
      about = await this.client.about().catch(() => null);
    }
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!this.config?.url || this.instance.error) {
        message[language] = pick(status.message, language);
        continue;
      }
      const views = this.interfaceList().map((state) => this.view(state));
      const parts = [
        text
          .ok([about?.version, about?.edition].filter(Boolean).join(' ') || '')
          .replace(/\s+/g, ' '),
        text.interfaces(views.length),
        text.hosts(views.reduce((sum, view) => sum + (view.snapshot?.hosts ?? 0), 0)),
        text.alerts(views.reduce((sum, view) => sum + view.engaged.length, 0)),
      ];
      const lines = [labelled(hostOf(this.config.url), parts.join(', '), language)];
      if (status.message) {
        lines.push(pick(status.message, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** Throws the reason no scene action can be answered, if any. */
  assertReadable() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.noUrl, this.config?.language));
    }
  }
}

/** Where the flow alert log of an interface stands, null before the first read. */
const DAY_MS = 24 * 3600_000;
const day = (time) => Math.floor(time / DAY_MS) * DAY_MS;

function cursorOf(saved) {
  return Number.isInteger(saved.flowRowId) ? saved.flowRowId : null;
}
