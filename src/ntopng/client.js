// -----------------------------------------------------------------------------
// ntopng client: the REST API v2 of ntopng (web server, port 3000 by default),
// as the Community edition serves it (checked against ntopng 7.0):
//
//   /lua/rest/v2/get/ntopng/interfaces.lua          the monitored interfaces
//   /lua/rest/v2/get/interface/data.lua             throughput, hosts, flows
//                                                   and alert counters of one
//   /lua/rest/v2/get/{host,interface}/alert/list.lua?status=engaged
//                                                   the alerts engaged now
//   /lua/rest/v2/get/flow/alert/list.lua?row_id=N;gt
//                                                   the flow alerts stored after
//                                                   row N (SQLite in Community)
//   /lua/rest/v2/get/host/active_list.lua?mode=local
//                                                   the local hosts, newest first
//
// Every answer is `{ rc, rc_str, rsp }`: rc 0 is a success. A request that
// ntopng does not authenticate is NOT an HTTP 401: it is a 302 to the login
// page (or, while the admin password is still "admin", to the page that
// changes it). Read only: nothing here changes ntopng.
//
// Authentication: `Authorization: Token <api token>` (an API token, made in
// ntopng under the user's settings), or HTTP basic with a user and password.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall, ntopng stopped
  STARTING: 'starting', // ntopng answers "We're almost ready" (503) while it starts
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // the token or the password is refused
  NO_CREDENTIALS: 'no_credentials', // ntopng asks for a login and none is configured
  PASSWORD_CHANGE: 'password_change', // the admin password is still the default one
  NOT_GRANTED: 'not_granted', // the user may not read this (e.g. alerts)
  NOT_NTOPNG: 'not_ntopng', // something answers, not the API of ntopng
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class NtopngError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, rc }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'NtopngError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// `rc_str` of an interface ntopng no longer has (restarted with other `-i`).
export const INVALID_INTERFACE = 'INVALID_INTERFACE';
const NOT_GRANTED = new Set(['NOT_GRANTED', 'NOT_GRANTED_ADMIN']);

// Flow alerts read per request, at most: a port scan writes thousands.
export const FLOW_ALERTS_PAGE = 200;
// Local hosts read per request: the newest ones, enough to see the new hosts.
export const NEWEST_HOSTS = 50;
// Local hosts read when the whole list is refreshed (see src/hub.js).
export const ALL_HOSTS = 1000;

export class NtopngClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.token] API token, '' for none
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    token = '',
    username = '',
    password = '',
    insecure = false,
    request = httpRequest,
    timeoutMs = 15_000,
  }) {
    this.url = url;
    this.token = token;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  hasCredentials() {
    return Boolean(this.token || this.username);
  }

  headers() {
    const headers = { accept: 'application/json' };
    if (this.token) {
      headers.authorization = `Token ${this.token}`;
    } else if (this.username) {
      const pair = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
      headers.authorization = `Basic ${pair}`;
    }
    return headers;
  }

  /** One GET of the REST API: resolves `rsp` (and the whole answer) when rc is 0. */
  async get(path) {
    let response;
    try {
      response = await this.request(`${this.url}/lua/rest/v2/${path}`, {
        headers: this.headers(),
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new NtopngError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      if (err.code === 'ERESPONSETOOLARGE') {
        throw new NtopngError(ERROR_KINDS.HTTP, 'Answer too large');
      }
      throw new NtopngError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    const { status } = response;
    const location = String(response.headers?.location ?? '');
    if (status >= 300 && status < 400) {
      if (location.includes('change_password.lua')) {
        throw new NtopngError(ERROR_KINDS.PASSWORD_CHANGE, 'The admin password must be changed');
      }
      if (location.includes('login.lua')) {
        throw this.hasCredentials()
          ? new NtopngError(ERROR_KINDS.AUTH, 'Credentials refused', { status })
          : new NtopngError(ERROR_KINDS.NO_CREDENTIALS, 'A login is needed', { status });
      }
      throw new NtopngError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    let data = null;
    try {
      data = JSON.parse(response.body);
    } catch {
      // Not JSON: told below from the status.
    }
    const isAnswer = data !== null && typeof data === 'object' && typeof data.rc === 'number';
    // NOT_GRANTED comes as an HTTP 401 with a JSON answer: a user without the
    // right, not a refused password.
    if (!isAnswer && (status === 401 || status === 403)) {
      throw this.hasCredentials()
        ? new NtopngError(ERROR_KINDS.AUTH, `Credentials refused (HTTP ${status})`, { status })
        : new NtopngError(ERROR_KINDS.NO_CREDENTIALS, `A login is needed (HTTP ${status})`, {
            status,
          });
    }
    if (status === 503 && /almost ready|unable to serve/i.test(response.body)) {
      throw new NtopngError(ERROR_KINDS.STARTING, 'ntopng is starting', { status });
    }
    // A reverse proxy in front of a stopped ntopng: silence, like no answer at all.
    if (!isAnswer && (status === 502 || status === 503 || status === 504)) {
      throw new NtopngError(ERROR_KINDS.UNREACHABLE, `No ntopng behind (HTTP ${status})`, {
        status,
      });
    }
    if (!isAnswer) {
      // An HTML page: the web interface of another service, a login portal.
      throw new NtopngError(ERROR_KINDS.NOT_NTOPNG, `No ntopng REST API (HTTP ${status})`, {
        status,
      });
    }
    if (data.rc !== 0) {
      const rc = String(data.rc_str ?? data.rc);
      if (NOT_GRANTED.has(rc)) {
        throw new NtopngError(ERROR_KINDS.NOT_GRANTED, `Not granted (${rc})`, { rc });
      }
      throw new NtopngError(ERROR_KINDS.HTTP, `ntopng refused the request (${rc})`, { rc });
    }
    return data;
  }

  /** The interfaces ntopng monitors: `[{ ifid, ifname, name }]`. */
  async interfaces() {
    const { rsp } = await this.get('get/ntopng/interfaces.lua');
    if (!Array.isArray(rsp)) {
      throw new NtopngError(ERROR_KINDS.NOT_NTOPNG, 'No interface list');
    }
    return rsp;
  }

  /** Throughput, hosts, flows and alert counters of an interface; null when it is gone. */
  async interfaceData(ifid) {
    try {
      const { rsp } = await this.get(`get/interface/data.lua?ifid=${encodeURIComponent(ifid)}`);
      return rsp && typeof rsp === 'object' && !Array.isArray(rsp) ? rsp : null;
    } catch (err) {
      if (err.rc === INVALID_INTERFACE) {
        return null;
      }
      throw err;
    }
  }

  /** The alerts engaged now on the hosts and on the interface itself. */
  async engagedAlerts(ifid) {
    const id = encodeURIComponent(ifid);
    const [hosts, iface] = await Promise.all([
      this.get(`get/host/alert/list.lua?ifid=${id}&status=engaged`),
      this.get(`get/interface/alert/list.lua?ifid=${id}&status=engaged`),
    ]);
    const tag = (family) => (record) => ({ ...record, family: record.family ?? family });
    return [...records(hosts).map(tag('host')), ...records(iface).map(tag('interface'))];
  }

  /**
   * The flow alerts stored after row `after`, newest first (at most a page),
   * with the total count. `after` null: only the newest row (to start from).
   */
  async flowAlerts(ifid, after) {
    const id = encodeURIComponent(ifid);
    const since = after === null ? 0 : after;
    const length = after === null ? 1 : FLOW_ALERTS_PAGE;
    const data = await this.get(
      `get/flow/alert/list.lua?ifid=${id}&status=any&row_id=${since};gt&sort=rowid&order=desc&length=${length}`,
    );
    return { records: records(data), total: Number(data.recordsFiltered) || 0 };
  }

  /** Version and edition of ntopng (`get/ntopng/about.lua`), for the connection test. */
  async about() {
    const { rsp } = await this.get('get/ntopng/about.lua');
    return {
      version: typeof rsp?.version === 'string' ? rsp.version : '',
      edition: typeof rsp?.release === 'string' ? rsp.release : '',
    };
  }

  /** The local hosts, newest first. */
  async localHosts(ifid, length = NEWEST_HOSTS) {
    const { rsp } = await this.get(
      `get/host/active_list.lua?ifid=${encodeURIComponent(ifid)}&mode=local&sort=first_seen&order=desc&length=${length}`,
    );
    return Array.isArray(rsp) ? rsp : [];
  }
}

/** The records of an alert list answer. */
function records(data) {
  const list = data?.rsp?.records;
  return Array.isArray(list) ? list : [];
}
