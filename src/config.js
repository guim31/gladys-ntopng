// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One ntopng instance, read with an API token (preferred) or a user name and
// password. Every interface it monitors becomes a device.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Port of the ntopng web server (HTTP; HTTPS is usually 3001, typed by the user).
export const DEFAULT_PORT = 3000;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Highest throughput threshold accepted, in Mbit/s (100 Gbit/s).
export const MAX_THRESHOLD_MBPS = 100_000;

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  username: '',
  password: '',
  poll_interval: '60',
  rate_threshold_mbps: '',
  allow_self_signed: false,
  language: 'fr',
};

// What follows the root of the web interface in a URL copied from the browser.
const INTERFACE_PATH = /\/(lua(\/.*)?|index\.html)$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 3000 added), `host:port`, or the URL copied from the
 * browser (`https://ntop.lan:3001/lua/index.lua`). HTTP by default. A path is
 * kept (ntopng behind a reverse proxy sub-path, `--http-prefix`); the pages of
 * the interface are dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme, no default port). */
export const hostOf = (url) =>
  url.replace(/^https?:\/\//, '').replace(new RegExp(`:${DEFAULT_PORT}(?=/|$)`), '');

/** A threshold in Mbit/s, comma or dot decimal; null when empty or unusable. */
export function parseThreshold(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+([.,]\d+)?$/.test(text)) {
    return null;
  }
  const value = Number(text.replace(',', '.'));
  return value > 0 && value <= MAX_THRESHOLD_MBPS ? value : null;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typedUrl = text('url');
  const url = parseUrl(typedUrl);
  // A pasted token often carries a "Token " prefix or a trailing new line.
  const token = text('api_token').replace(/^Token\s+/i, '');
  const username = text('username');
  // A password is kept as typed: spaces may belong to it.
  const password = typeof source.password === 'string' ? source.password : '';
  const interval = String(source.poll_interval ?? '');
  return {
    url,
    invalidUrl: Boolean(typedUrl) && !url,
    token,
    username,
    password,
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval) * 1000,
    thresholdMbps: parseThreshold(source.rate_threshold_mbps),
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
