// -----------------------------------------------------------------------------
// The Gladys device of an ntopng interface, proposed in the Discovery tab: one
// per interface ntopng monitors. The user adds the ones to follow, nothing is
// created on their behalf.
//
// Identity: the interface name (`eth0`, `br-lan`), made safe (src/ntopng/
// model.js). Not the ifid: ntopng numbers its interfaces in the order of its
// `-i` options, which may change.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). Published with should_poll: false: the
// integration reads ntopng on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { SEVERITY_TEXT, pick } from './texts.js';

export const DEVICE_TYPE = 'interface';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  DOWNLOAD: 'download',
  UPLOAD: 'upload',
  HOSTS: 'hosts',
  LOCAL_HOSTS: 'local_hosts',
  FLOWS: 'flows',
  ENGAGED_ALERTS: 'engaged_alerts',
  ALERTED_FLOWS: 'alerted_flows',
  HIGHEST_SEVERITY: 'highest_severity',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Reachable',
    [K.DOWNLOAD]: 'Download',
    [K.UPLOAD]: 'Upload',
    [K.HOSTS]: 'Active hosts',
    [K.LOCAL_HOSTS]: 'Local hosts',
    [K.FLOWS]: 'Active flows',
    [K.ENGAGED_ALERTS]: 'Engaged alerts',
    [K.ALERTED_FLOWS]: 'Alerted flows',
    [K.HIGHEST_SEVERITY]: 'Highest severity',
  },
  fr: {
    [K.ONLINE]: 'Joignable',
    [K.DOWNLOAD]: 'Réception',
    [K.UPLOAD]: 'Émission',
    [K.HOSTS]: 'Hôtes actifs',
    [K.LOCAL_HOSTS]: 'Hôtes locaux',
    [K.FLOWS]: 'Flux actifs',
    [K.ENGAGED_ALERTS]: 'Alertes en cours',
    [K.ALERTED_FLOWS]: 'Flux en alerte',
    [K.HIGHEST_SEVERITY]: 'Gravité la plus haute',
  },
  de: {
    [K.ONLINE]: 'Erreichbar',
    [K.DOWNLOAD]: 'Empfang',
    [K.UPLOAD]: 'Senden',
    [K.HOSTS]: 'Aktive Hosts',
    [K.LOCAL_HOSTS]: 'Lokale Hosts',
    [K.FLOWS]: 'Aktive Flows',
    [K.ENGAGED_ALERTS]: 'Aktive Alarme',
    [K.ALERTED_FLOWS]: 'Flows mit Alarm',
    [K.HIGHEST_SEVERITY]: 'Höchster Schweregrad',
  },
  es: {
    [K.ONLINE]: 'Accesible',
    [K.DOWNLOAD]: 'Recepción',
    [K.UPLOAD]: 'Envío',
    [K.HOSTS]: 'Hosts activos',
    [K.LOCAL_HOSTS]: 'Hosts locales',
    [K.FLOWS]: 'Flujos activos',
    [K.ENGAGED_ALERTS]: 'Alertas en curso',
    [K.ALERTED_FLOWS]: 'Flujos con alerta',
    [K.HIGHEST_SEVERITY]: 'Gravedad más alta',
  },
};

export const MODEL = 'ntopng';

// Display bounds (the core never applies them on write). Fixed: a bound that
// moves changes the device structure ("Update" in the Discovery tab).
export const BOUNDS = Object.freeze({
  RATE_MAX_MBPS: 100_000,
  HOSTS_MAX: 1_000_000,
  FLOWS_MAX: 10_000_000,
});

/** External ids of the device of an interface. */
export const deviceIds = (gladys, key) => gladys.externalIds(DEVICE_TYPE, key);

/** The interface key of a device external id, null when not ours. */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const key = externalId.slice(prefix.length);
  return /^[a-z0-9._-]{1,60}$/.test(key) ? key : null;
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// Feature shapes. `noisy`: moves at every read, published at most once a
// minute (src/hub.js) to stay far below the 300 states per minute of Gladys.
const rate = () => ({
  definition: {
    category: CATEGORY.DATARATE,
    type: TYPE.DATARATE.RATE,
    unit: UNIT.MEGABITS_PER_SECOND,
    min: 0,
    max: BOUNDS.RATE_MAX_MBPS,
  },
  digits: 2,
  noisy: true,
});
const counter = (max) => ({
  definition: {
    category: CATEGORY.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max,
  },
  digits: 0,
});

/**
 * The features of an interface device. `item` is `{ snapshot, online }`
 * (src/hub.js).
 */
const BLUEPRINT = [
  {
    key: K.ONLINE,
    definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
    digits: 0,
    value: (item) => (item.online ? 1 : 0),
  },
  { key: K.DOWNLOAD, ...rate(), value: (item) => item.snapshot?.downloadMbps },
  { key: K.UPLOAD, ...rate(), value: (item) => item.snapshot?.uploadMbps },
  { key: K.HOSTS, ...counter(BOUNDS.HOSTS_MAX), value: (item) => item.snapshot?.hosts },
  { key: K.LOCAL_HOSTS, ...counter(BOUNDS.HOSTS_MAX), value: (item) => item.snapshot?.localHosts },
  {
    key: K.FLOWS,
    ...counter(BOUNDS.FLOWS_MAX),
    noisy: true,
    value: (item) => item.snapshot?.flows,
  },
  {
    key: K.ENGAGED_ALERTS,
    ...counter(BOUNDS.FLOWS_MAX),
    value: (item) => item.snapshot?.engagedAlerts,
  },
  {
    key: K.ALERTED_FLOWS,
    ...counter(BOUNDS.FLOWS_MAX),
    noisy: true,
    value: (item) => item.snapshot?.alertedFlows,
  },
  {
    key: K.HIGHEST_SEVERITY,
    // min/max are NOT NULL in the core, text included.
    definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
    text: true,
    value: (item, language) =>
      item.snapshot ? pick(SEVERITY_TEXT[item.snapshot.highestSeverity], language) : null,
  },
];

/**
 * The discovery payload of an interface device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.key interface key (src/ntopng/model.js)
 * @param {string} options.name device name
 * @param {string} [options.language] feature names language
 */
export function buildDevice(gladys, { key, name, language = 'en' }) {
  const ids = deviceIds(gladys, key);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    features: BLUEPRINT.map((feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: !feature.text,
    })),
  };
}

/**
 * The value of every feature of an interface (null: nothing to publish).
 * A text feature takes `{ text }` (src/hub.js), never an empty one.
 * @returns {Array<{ externalId: string, value: number|string|null, noisy: boolean, text: boolean }>}
 */
export function featureValues(gladys, { key, item, language = 'en' }) {
  const ids = deviceIds(gladys, key);
  return BLUEPRINT.map((feature) => {
    const raw = feature.value(item, language);
    return {
      externalId: ids.feature(feature.key),
      value: feature.text ? raw || null : round(raw, feature.digits),
      noisy: Boolean(feature.noisy),
      text: Boolean(feature.text),
    };
  });
}
