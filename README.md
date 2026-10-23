# ntopng for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings [ntopng](https://www.ntop.org/products/traffic-analysis/ntop/), the
network traffic monitor, into Gladys: one device per monitored interface, the
ntopng alerts and new local hosts as scene triggers, and a dashboard widget.
Local only, and the free **Community** edition is enough.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **One device per interface** ntopng monitors (8 at most): reachable,
  download and upload rates, active hosts, local hosts, active flows, engaged
  alerts, alerted flows, highest severity.
- **Scene triggers**: a new ntopng alert (filters: interface, severity, alert
  type, host; variables: type, severity, host, description, occurrences), a
  local host never seen before (IP, MAC, name), and the throughput of an
  interface above a threshold or back below it.
- **Scene actions**: the state of an interface (every figure, and a ready-made
  summary to send); the recent alerts of one interface or of all of them.
- **Dashboard widget**: throughput, hosts, flows and alerts of an interface,
  or the totals and one row per interface.
- API token (recommended) or user and password, self-signed certificates,
  refresh every 30 seconds to 5 minutes, texts in English, French, German and
  Spanish.

For the presence of the devices of your network, see
[gladys-netalertx](https://github.com/guim31/gladys-netalertx): ntopng only
sees the hosts whose traffic crosses the interface it monitors.

## Requirements

- Gladys Assistant 5.1.0 or later.
- ntopng 6 or 7 (Community, Pro or Enterprise), reachable from the Gladys
  machine (port 3000 by default), with the default `admin` password changed.
- An ntopng user allowed to read the alerts, preferably with an API token.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-ntopng`.
2. In the **Configuration** tab, enter the address of ntopng and an API token,
   then **Test the connection**.
3. Add the interfaces from the **Discover** tab.

## How it works

At each refresh (1 minute by default): `get/ntopng/interfaces.lua`, then per
interface `get/interface/data.lua` (throughput, hosts, flows, alert counters),
the engaged host and interface alerts (`get/{host,interface}/alert/list.lua?status=engaged`),
the flow alerts stored since the last one read (`get/flow/alert/list.lua?row_id=<last>;gt`,
200 at most per read), and the 50 newest local hosts (`get/host/active_list.lua?mode=local`,
the whole list once an hour). Everything goes through the REST API v2 of
ntopng; the Community edition has all of it.

Interfaces are identified by their name (`eth0`), not by their ntopng index.
Only the devices added to Gladys receive states, only when a value changes
(rates and flows at most once a minute), with a heartbeat every 6 hours. Where
the alert log stands, the engaged alerts and the hosts already seen are kept
under `/data`, so a restart neither misses nor repeats an event. A port scan
writes one flow alert per probe: they are grouped per read by type and host,
and the same alert fires at most once an hour.

## Checked on a real ntopng, and what was not

Tested against a real ntopng 7.0.261022 Community (official `ntop/ntopng`
image, `--community`) in Docker, monitoring its own container on a test
network: web traffic, port scans (`nmap`) and new hosts made by other test
containers. The answers are kept, anonymized, in `test/fixtures/ntopng/`. The
image of the integration was run in the Gladys sandbox constraints (read-only,
no capability, 256 MB; about 80 MB used during the test, 19 MB idle) against
it: devices, states, alert, new host and threshold events, scene actions,
widget, wrong token, missing credentials, unreachable address.

Not checked: a real home network or mirror port, ntopng 6.x, the Pro and
Enterprise editions (ClickHouse alert store), an engaged host alert (none was
raised in the test network: the shape comes from the ntopng source), HTTPS,
a non-admin user, and an actual Gladys instance. Developed without a real
installation: feedback welcome in the
[issues](https://github.com/guim31/gladys-ntopng/issues).

## Limitations

- One ntopng instance, 8 interfaces at most.
- Engaged host and interface alerts and flow alerts are read; network, system
  and SNMP alerts are not. Flow alert events need the SQLite alert store
  (Community, Pro); with ClickHouse they are off.
- No history import; the features of the paid editions are not read.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory ntopng (`test/helpers/fakeNtopng.js`) serving the real answers
of `test/fixtures/ntopng/`. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [ntopng](https://github.com/ntop/ntopng) by ntop (GPL-3.0): the REST API read
  here. No code reused.
- The architecture and the conformity tests follow
  [gladys-netdata](https://github.com/guim31/gladys-netdata) and
  [gladys-wled](https://github.com/guim31/gladys-wled).
- The cover shows the ntopng logo from the
  [ntopng repository](https://github.com/ntop/ntopng) (`doc/src/img/logo.png`); it
  belongs to ntop.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by ntop.

## License

Apache-2.0
