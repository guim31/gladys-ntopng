# ntopng

[ntopng](https://www.ntop.org/products/traffic-analysis/ntop/) watches the
traffic of a network interface (a mirror port, the LAN side of a router, a home
server) and tells who talks to whom, how much, and what looks suspicious. This
integration brings it into Gladys: one device per interface ntopng monitors,
with its download and upload rates, its active hosts and flows, and its alerts.
Scenes can react to a new ntopng alert, to a local host never seen before, or
to the throughput going above a threshold, and a dashboard widget shows the
traffic and the alerts at a glance. Everything stays on your local network.

Tested against a real ntopng 7.0 Community (Docker), with traffic and a port
scan between test containers. Not yet on a real home network: feedback welcome
on [the issues](https://github.com/guim31/gladys-ntopng/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- ntopng 6 or 7 (the free **Community** edition is enough), reachable from the
  Gladys machine (port 3000 by default).
- An ntopng user allowed to read the alerts (an administrator, or a user with
  the "alerts" capability), and preferably its API token.

The integration only reads: it never changes anything in ntopng.

## Getting started

### 1. Get an API token

Open ntopng in a browser (`http://<machine>:3000`). On a fresh installation,
ntopng first asks to change the default `admin` password: do it, the API stays
closed until then. Then open the user menu (top right) → your user name → the token tab →
**Generate**, and copy the token.

### 2. Configure the integration

In Gladys, **Integrations → ntopng → Configuration**:

- **ntopng address**: `192.168.1.20`, `ntop.lan`, or the address shown in your
  browser, such as `https://ntop.lan:3001` (port 3000 when none is given).
- **API token**: the token of step 1. Without a token, fill in **User (without token)** and **Password (without token)**.
- **Refresh interval**: 1 minute by default (30 seconds to 5 minutes).
- **Throughput threshold (Mbit/s)**: only for the trigger "Throughput above the
  threshold"; leave it empty otherwise.
- **Accept self-signed certificates**: only for an `https://` address, since
  the certificate ntopng ships with is self-signed.
- **Language of the names**: the language of the feature names and of the scene
  texts.

Then click **Test the connection**: it says the version of ntopng, the
interfaces, the active hosts and the engaged alerts.

### 3. Add the interfaces

In the **Discover** tab, add the interfaces you want to follow. Only the added
interfaces receive values; the scene triggers work for every interface.

## The devices

One device per interface, named `ntopng <interface>`:

| Feature          | What it shows                                             |
| ---------------- | --------------------------------------------------------- |
| Reachable        | ntopng answers and still monitors the interface           |
| Download         | traffic received, in Mbit/s                               |
| Upload           | traffic sent, in Mbit/s                                   |
| Active hosts     | hosts seen on the interface right now                     |
| Local hosts      | those of them in your local networks                      |
| Active flows     | connections followed right now                            |
| Engaged alerts   | alerts ntopng holds open on hosts or on the interface     |
| Alerted flows    | active flows with an alert (a port scan raises thousands) |
| Highest severity | the worst of them: None, Notice, Warning or Error         |

Rates and flows are sent at most once a minute; the other values when they
change.

## Dashboard

The **ntopng traffic** widget shows, for one interface (the one chosen in its
settings, or the only one), the download, the upload, the hosts, the flows and
the engaged alerts, then the list of alerts: the engaged ones first, most
severe first, then the flow alerts of the last 24 hours with their count. With
several interfaces and none chosen, it shows the totals and one row per
interface. The **Refresh** button reads ntopng again.

## Scenes

### Triggers

- **New ntopng alert**: ntopng raises an alert on a host, a flow or an
  interface. Filters: interface, severity, alert type (the English name ntopng
  shows, such as `Probing Attempt`), host IP address. Variables: interface,
  alert type, severity, raised on, host IP address and name, description,
  occurrences. A port scan writes one flow alert per probe: they are grouped by
  type and host, and the same alert fires once an hour at most.
- **New local host**: ntopng sees a local host never seen before, by its MAC
  address (else its IP address). Variables: interface, IP address, MAC address,
  host name. The hosts known when the integration starts are not announced.
- **Throughput above the threshold**: download plus upload of an interface
  goes above the threshold of the configuration for two reads in a row, or back
  below 90 % of it. Filter: the change. Variables: download, upload, total and
  threshold in Mbit/s.

To follow the presence of your devices, [NetAlertX](https://github.com/guim31/gladys-netalertx)
does it better (scans, presence per device); ntopng only sees the hosts that
send traffic through the interface it monitors.

### Actions

- **State of an ntopng interface**: reads an interface for the next actions:
  download, upload, hosts, flows, alerts, highest severity, and a ready-made
  summary such as `eth0: download 12.3 Mbit/s, upload 1.5 Mbit/s, 24 host(s),
310 flow(s), no alert`.
- **Recent ntopng alerts**: the engaged alerts and the flow alerts of the last
  24 hours, on one interface or all of them, with their count and a summary.

### Scene ideas

- **New ntopng alert**, severity **Error** → send the message
  `{{triggerEvent.data.alert_type}} on {{triggerEvent.data.host}} ({{triggerEvent.data.count}} times)`.
- **New local host** → send `New device: {{triggerEvent.data.host_name}} {{triggerEvent.data.ip}} {{triggerEvent.data.mac}}`.
- **Throughput above the threshold** at night → pause the backups, and resume
  them on "Back below".
- Every evening at 21:00 → **Recent ntopng alerts** → if the count is above 0,
  send the summary.

## Troubleshooting

- **"does not answer"**: check the address and the port in a browser; a
  firewall may block port 3000.
- **"log in to ntopng once and change the default admin password"**: ntopng
  sends every request to the password page until the `admin` password is
  changed.
- **"API token or password refused"**: generate a new token, or check the user
  and password.
- **"this ntopng user may not read the alerts"**: the values still come, but no
  alert event: give the user the alerts capability, or use an administrator.
- **"the address redirects"**: ntopng only serves HTTPS: enter the
  `https://` address (port 3001 by default).
- **ntopng raises "Clear-Text Credentials" for Gladys**: with a user and
  password over HTTP, ntopng sees the password pass in clear on the network
  it watches. Use an API token, or HTTPS.
- **ntopng in Docker shows almost nothing**: it monitors its own container;
  start it with `--network host` (on the machine that sees the traffic) or on a
  mirror port.
- More details with the `LOG_LEVEL=debug` environment variable on the
  integration.

## Limits

- One ntopng instance, 8 interfaces at most.
- Engaged alerts (hosts, interface) and flow alerts are read; the other alert
  families of ntopng (networks, system, SNMP of the Enterprise edition) are not.
- Flow alert events need the SQLite alert store of the Community and Pro
  editions; with ClickHouse (Enterprise), the flow alert events are off.
- Built for the Community edition: the features of the paid editions (traffic
  policies, SNMP, nProbe) are not read.
- The integration reads the current values at every refresh: it does not
  import the history of ntopng.
- Not affiliated with ntop.
