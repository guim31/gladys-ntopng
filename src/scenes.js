// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the download above 50 Mbit/s?" is already a scene condition on the
// device features. The actions do what a condition cannot: put the state of
// an interface or the alerts ntopng raised in a message ("eth0: download
// 12 Mbit/s, upload 1 Mbit/s, 24 host(s), 1 engaged alert(s)…"). They read
// ntopng again when the last read is older than 15 seconds. An unreachable
// ntopng is an answer, not a failure: `online` false, and the summary says so.
// -----------------------------------------------------------------------------

import { severityRank } from './ntopng/model.js';
import {
  ACTION_TEXT,
  ERROR_TEXT,
  SEVERITY_TEXT,
  SUMMARY_TEXT,
  formatRate,
  labelled,
  pick,
} from './texts.js';

// Alerts listed in a summary, at most (the rest is counted).
export const MAX_LISTED_ALERTS = 10;

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The one-line state of an interface, in the configured language. */
export function summarize(view, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  if (!view.online) {
    return labelled(view.name, pick(ERROR_TEXT[view.error] ?? ERROR_TEXT.gone, language), language);
  }
  const { snapshot } = view;
  const parts = [];
  if (snapshot.downloadMbps !== null) {
    parts.push(`${text.download} ${formatRate(snapshot.downloadMbps, language)}`);
  }
  if (snapshot.uploadMbps !== null) {
    parts.push(`${text.upload} ${formatRate(snapshot.uploadMbps, language)}`);
  }
  if (snapshot.hosts !== null) {
    parts.push(text.hosts(snapshot.hosts));
  }
  if (snapshot.flows !== null) {
    parts.push(text.flows(snapshot.flows));
  }
  parts.push(view.engaged.length ? text.alerts(view.engaged.length) : text.noAlert);
  return labelled(view.name, parts.join(', '), language);
}

/** "Probing Attempt (Error, 192.0.2.3, 684 times)": one alert, in words. */
function alertText(alert, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  const details = [pick(SEVERITY_TEXT[alert.severity], language)];
  if (alert.hostName || alert.host) {
    details.push(alert.hostName || alert.host);
  }
  if (alert.count > 1) {
    details.push(text.times(alert.count));
  }
  return `${alert.type} (${details.join(', ')})`;
}

/** The interface of a scene field, or an error in the configured language. */
function interfaceOf(hub, id) {
  const state = hub.find(id);
  if (!state) {
    throw new Error(pick(ACTION_TEXT.unknownInterface, hub.config.language));
  }
  return state;
}

export const SCENE_ACTIONS = {
  async get_interface_status(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    interfaceOf(hub, fields.interface);
    await hub.refreshIfStale();
    const view = hub.view(interfaceOf(hub, fields.interface));
    const outputs = { name: view.name, online: view.online, summary: summarize(view, language) };
    if (!view.online) {
      return outputs;
    }
    const { snapshot } = view;
    const set = (key, value, digits = 0) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        outputs[key] = round(value, digits);
      }
    };
    set('download_mbps', snapshot.downloadMbps, 2);
    set('upload_mbps', snapshot.uploadMbps, 2);
    set('hosts', snapshot.hosts);
    set('local_hosts', snapshot.localHosts);
    set('flows', snapshot.flows);
    set('engaged_alerts', snapshot.engagedAlerts);
    set('alerted_flows', snapshot.alertedFlows);
    outputs.highest_severity = pick(SEVERITY_TEXT[snapshot.highestSeverity], language);
    return outputs;
  },

  async get_recent_alerts(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
    if (fields.interface) {
      interfaceOf(hub, fields.interface);
    }
    await hub.refreshIfStale();
    const states = fields.interface ? [interfaceOf(hub, fields.interface)] : hub.interfaceList();
    let engaged = 0;
    let count = 0;
    const lines = [];
    for (const state of states) {
      const view = hub.view(state);
      if (!view.online) {
        if (fields.interface) {
          lines.push(summarize(view, language));
        }
        continue;
      }
      const alerts = [
        ...[...view.engaged].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
        ...view.recent,
      ];
      engaged += view.engaged.length;
      count += alerts.length;
      if (alerts.length) {
        const listed = alerts.slice(0, MAX_LISTED_ALERTS).map((a) => alertText(a, language));
        const more = alerts.length - listed.length;
        lines.push(
          labelled(view.name, `${listed.join(', ')}${more > 0 ? `, +${more}` : ''}`, language),
        );
      }
    }
    return {
      count,
      engaged,
      summary: lines.length
        ? lines.join('\n')
        : `${text.noAlert[0].toUpperCase()}${text.noAlert.slice(1)}`,
    };
  },
};
