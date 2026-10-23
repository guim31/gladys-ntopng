// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `traffic`.
//
// The use case: a glance at the wall tablet tells how busy the network is and
// whether ntopng saw something worth a look.
//
//   - One interface (the one chosen, or the only one): download and upload,
//     active hosts and flows, engaged alerts, then the alerts: engaged first
//     (most severe first), then the flow alerts of the last 24 hours.
//   - Several interfaces and none chosen: the totals, one row per interface,
//     then the alerts.
//
// The figures are sent as values, not bound to device features: the widget
// works before any device is added.
//
// Budget (8 components, 2 texts): one heading, five values, one status list
// of eight rows at most, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { WIDGET_KEY } from './hub.js';
import { severityRank } from './ntopng/model.js';
import { ERROR_TEXT, SEVERITY_TEXT, formatNumber, formatRate, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  noUrl: {
    en: 'ntopng is not configured yet: enter its address in the configuration.',
    fr: "ntopng n'est pas encore configuré : saisissez son adresse dans la configuration.",
    de: 'ntopng ist noch nicht konfiguriert: Gib seine Adresse in der Konfiguration ein.',
    es: 'ntopng aún no está configurado: introduzca su dirección en la configuración.',
  },
  gone: {
    en: 'ntopng no longer monitors this interface.',
    fr: 'ntopng ne surveille plus cette interface.',
    de: 'ntopng überwacht diese Schnittstelle nicht mehr.',
    es: 'ntopng ya no supervisa esta interfaz.',
  },
  waiting: {
    en: 'Waiting for the first answer of ntopng…',
    fr: 'En attente de la première réponse de ntopng…',
    de: 'Warte auf die erste Antwort von ntopng …',
    es: 'Esperando la primera respuesta de ntopng…',
  },
  title: { en: 'ntopng', fr: 'ntopng', de: 'ntopng', es: 'ntopng' },
  download: { en: 'Download', fr: 'Réception', de: 'Empfang', es: 'Recepción' },
  upload: { en: 'Upload', fr: 'Émission', de: 'Senden', es: 'Envío' },
  hosts: { en: 'Hosts', fr: 'Hôtes', de: 'Hosts', es: 'Hosts' },
  flows: { en: 'Flows', fr: 'Flux', de: 'Flows', es: 'Flujos' },
  alerts: { en: 'Alerts', fr: 'Alertes', de: 'Alarme', es: 'Alertas' },
  noAlert: {
    en: 'No alert',
    fr: 'Aucune alerte',
    de: 'Kein Alarm',
    es: 'Ninguna alerta',
  },
  offline: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'ntopng read again.',
    fr: 'ntopng relu.',
    de: 'ntopng neu gelesen.',
    es: 'ntopng leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const SEVERITY_COLOR = {
  info: WIDGET_COLORS.NEUTRAL,
  notice: WIDGET_COLORS.NEUTRAL,
  warning: WIDGET_COLORS.WARNING,
  error: WIDGET_COLORS.DANGER,
  critical: WIDGET_COLORS.DANGER,
  emergency: WIDGET_COLORS.DANGER,
};
const SEVERITY_ICON = {
  info: 'info',
  notice: 'info',
  warning: 'alert-triangle',
  error: 'alert-octagon',
  critical: 'alert-octagon',
  emergency: 'alert-octagon',
};

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

/** A rate tile: Mbit/s with one decimal (two below 10). */
const rateTile = (label, mbps, icon, language) => ({
  type: 'value',
  value: mbps === null ? '–' : Math.round(mbps * (mbps < 10 ? 100 : 10)) / (mbps < 10 ? 100 : 10),
  unit: 'Mbit/s',
  label: t(label, language),
  icon,
  color: WIDGET_COLORS.NEUTRAL,
});

const countTile = (label, value, icon, language, color = WIDGET_COLORS.NEUTRAL) => ({
  type: 'value',
  value: value === null ? '–' : value,
  label: t(label, language),
  icon,
  color,
});

/** The engaged alerts, most severe first, then the flow alerts, newest first. */
function alertRows(views, language, withInterface) {
  const rows = [];
  const prefix = (view) => (withInterface ? `${view.name} · ` : '');
  const engaged = views
    .flatMap((view) => view.engaged.map((alert) => ({ view, alert })))
    .sort((a, b) => severityRank(b.alert.severity) - severityRank(a.alert.severity));
  for (const { view, alert } of engaged) {
    rows.push({
      label: fit(`${prefix(view)}${alert.type}`, 40),
      value: fit(alert.hostName || alert.host || t(SEVERITY_TEXT[alert.severity], language), 40),
      icon: SEVERITY_ICON[alert.severity],
      color: SEVERITY_COLOR[alert.severity],
    });
  }
  const recent = views
    .flatMap((view) => view.recent.map((alert) => ({ view, alert })))
    .sort((a, b) => b.alert.at - a.alert.at);
  for (const { view, alert } of recent) {
    const who = alert.hostName || alert.host;
    rows.push({
      label: fit(`${prefix(view)}${alert.type}`, 40),
      // The count stays visible: a long host name is cut first.
      value: `${who ? `${fit(who, 30)} ` : ''}×${formatNumber(alert.count, language, 0)}`.slice(
        0,
        40,
      ),
      icon: SEVERITY_ICON[alert.severity],
      color: SEVERITY_COLOR[alert.severity],
    });
  }
  return rows;
}

/** The status list, cut at MAX_ROWS with an "Others +n" row. */
function statusList(rows, language) {
  const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
  if (rows.length > shown.length) {
    shown.push({
      label: t(TEXT.more, language),
      value: `+${rows.length - shown.length}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return { type: 'status', items: shown };
}

const noAlertRow = (language) => ({
  label: t(TEXT.alerts, language),
  value: t(TEXT.noAlert, language),
  icon: 'check-circle',
  color: WIDGET_COLORS.SUCCESS,
});

const alertColor = (views) => {
  const worst = Math.max(
    -1,
    ...views.flatMap((view) => view.engaged.map((alert) => severityRank(alert.severity))),
  );
  return worst >= severityRank('error')
    ? WIDGET_COLORS.DANGER
    : worst >= severityRank('warning')
      ? WIDGET_COLORS.WARNING
      : worst >= 0
        ? WIDGET_COLORS.NEUTRAL
        : WIDGET_COLORS.SUCCESS;
};

/** One interface: its figures and its alerts. */
function single(view, language) {
  const { snapshot } = view;
  const rows = alertRows([view], language, false);
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'heading', text: fit(view.name, 40) },
      rateTile(TEXT.download, snapshot.downloadMbps, 'arrow-down', language),
      rateTile(TEXT.upload, snapshot.uploadMbps, 'arrow-up', language),
      countTile(TEXT.hosts, snapshot.hosts, 'monitor', language),
      countTile(TEXT.flows, snapshot.flows, 'shuffle', language),
      countTile(TEXT.alerts, view.engaged.length, 'bell', language, alertColor([view])),
      statusList(rows.length ? rows : [noAlertRow(language)], language),
      refreshButton(language),
    ],
  };
}

/** Several interfaces: the totals, one row each, then the alerts. */
function overview(views, language) {
  const online = views.filter((view) => view.online);
  const sum = (pickValue) =>
    online.reduce((total, view) => total + (pickValue(view.snapshot) ?? 0), 0);
  const rows = views.map((view) => {
    if (!view.online) {
      return {
        label: fit(view.name, 40),
        value: t(TEXT.offline, language),
        icon: 'x-circle',
        color: WIDGET_COLORS.DANGER,
      };
    }
    const { snapshot } = view;
    const figures = [
      `↓ ${formatRate(snapshot.downloadMbps ?? 0, language)}`,
      `↑ ${formatRate(snapshot.uploadMbps ?? 0, language)}`,
    ];
    if (view.engaged.length) {
      figures.push(`⚠ ${view.engaged.length}`);
    }
    return {
      label: fit(view.name, 40),
      value: fit(figures.join(' · '), 40),
      icon: 'activity',
      color: alertColor([view]),
    };
  });
  const alerts = alertRows(online, language, true);
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'heading', text: t(TEXT.title, language) },
      rateTile(
        TEXT.download,
        sum((s) => s.downloadMbps),
        'arrow-down',
        language,
      ),
      rateTile(
        TEXT.upload,
        sum((s) => s.uploadMbps),
        'arrow-up',
        language,
      ),
      countTile(
        TEXT.hosts,
        sum((s) => s.hosts),
        'monitor',
        language,
      ),
      countTile(
        TEXT.flows,
        sum((s) => s.flows),
        'shuffle',
        language,
      ),
      countTile(
        TEXT.alerts,
        online.reduce((total, view) => total + view.engaged.length, 0),
        'bell',
        language,
        alertColor(online),
      ),
      statusList([...rows, ...(alerts.length ? alerts : [noAlertRow(language)])], language),
      refreshButton(language),
    ],
  };
}

/** ntopng refuses or does not answer: say why. */
function failure(heading, text, language) {
  return {
    ttl_seconds: 30,
    components: [
      { type: 'text', variant: 'heading', text: fit(heading, 40) },
      { type: 'text', variant: 'body', text: text.slice(0, 200) },
      refreshButton(language),
    ],
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.noUrl, language);
  }
  const chosen = typeof settings?.interface === 'string' ? settings.interface : '';
  const { error } = hub.instance;
  if (error) {
    return failure(
      t(TEXT.title, language),
      labelled(hostOf(hub.config.url), t(ERROR_TEXT[error.kind], language), language),
      language,
    );
  }
  if (hub.instance.readAt === 0) {
    return message(TEXT.waiting, language, 30);
  }
  let views;
  if (chosen) {
    const state = hub.find(chosen);
    if (!state) {
      return message(TEXT.gone, language);
    }
    views = [hub.view(state)];
  } else {
    views = hub.interfaceList().map((state) => hub.view(state));
  }
  if (views.length === 0) {
    return message(TEXT.waiting, language, 30);
  }
  if (views.length > 1) {
    return overview(views, language);
  }
  const [view] = views;
  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    const reason = ERROR_TEXT[view.error] ?? ERROR_TEXT.gone;
    return failure(view.name, labelled(view.name, t(reason, language), language), language);
  }
  return single(view, language);
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll();
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
