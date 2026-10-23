// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the severity
// feature, scene event variables, scene action outputs and errors. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './ntopng/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of ntopng in the configuration.',
    fr: "Saisissez l'adresse de ntopng dans la configuration.",
    de: 'Gib die Adresse von ntopng in der Konfiguration ein.',
    es: 'Introduzca la dirección de ntopng en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.20 or https://ntop.lan:3001',
    fr: 'Adresse incomprise, ex. 192.168.1.20 ou https://ntop.lan:3001',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20 oder https://ntop.lan:3001',
    es: 'Dirección no válida, p. ej. 192.168.1.20 o https://ntop.lan:3001',
  },
};

// One short explanation per error kind.
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (is ntopng running?)',
    fr: 'ne répond pas (ntopng est-il lancé ?)',
    de: 'antwortet nicht (läuft ntopng?)',
    es: 'no responde (¿se está ejecutando ntopng?)',
  },
  [ERROR_KINDS.STARTING]: {
    en: 'ntopng is starting, a moment please',
    fr: 'ntopng démarre, un instant',
    de: 'ntopng startet, einen Moment',
    es: 'ntopng se está iniciando, un momento',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API token or password refused',
    fr: "jeton d'API ou mot de passe refusé",
    de: 'API-Token oder Passwort abgelehnt',
    es: 'token de API o contraseña rechazados',
  },
  [ERROR_KINDS.NO_CREDENTIALS]: {
    en: 'ntopng asks for a login: enter an API token in the configuration',
    fr: "ntopng demande une connexion : saisissez un jeton d'API dans la configuration",
    de: 'ntopng verlangt eine Anmeldung: Gib ein API-Token in der Konfiguration ein',
    es: 'ntopng pide un inicio de sesión: introduzca un token de API en la configuración',
  },
  [ERROR_KINDS.PASSWORD_CHANGE]: {
    en: 'log in to ntopng once and change the default admin password',
    fr: 'connectez-vous une fois à ntopng et changez le mot de passe admin par défaut',
    de: 'melde dich einmal bei ntopng an und ändere das Standard-Admin-Passwort',
    es: 'inicie sesión una vez en ntopng y cambie la contraseña de admin por defecto',
  },
  [ERROR_KINDS.NOT_GRANTED]: {
    en: 'this ntopng user may not read the alerts',
    fr: "cet utilisateur ntopng n'a pas le droit de lire les alertes",
    de: 'dieser ntopng-Benutzer darf die Alarme nicht lesen',
    es: 'este usuario de ntopng no puede leer las alertas',
  },
  [ERROR_KINDS.NOT_NTOPNG]: {
    en: 'no ntopng at this address',
    fr: 'aucun ntopng à cette adresse',
    de: 'kein ntopng unter dieser Adresse',
    es: 'no hay ningún ntopng en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  gone: {
    en: 'ntopng no longer monitors this interface',
    fr: 'ntopng ne surveille plus cette interface',
    de: 'ntopng überwacht diese Schnittstelle nicht mehr',
    es: 'ntopng ya no supervisa esta interfaz',
  },
};

// The severity of an alert, in words (feature, scene variable, widget rows).
// `none`: only the feature, when nothing is raised.
export const SEVERITY_TEXT = {
  none: { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguna' },
  info: { en: 'Info', fr: 'Info', de: 'Info', es: 'Info' },
  notice: { en: 'Notice', fr: 'Avis', de: 'Hinweis', es: 'Aviso' },
  warning: { en: 'Warning', fr: 'Avertissement', de: 'Warnung', es: 'Advertencia' },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  critical: { en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítica' },
  emergency: { en: 'Emergency', fr: 'Urgence', de: 'Notfall', es: 'Emergencia' },
};

// What raised an alert (scene variable).
export const FAMILY_TEXT = {
  flow: { en: 'Flow', fr: 'Flux', de: 'Flow', es: 'Flujo' },
  host: { en: 'Host', fr: 'Hôte', de: 'Host', es: 'Host' },
  interface: { en: 'Interface', fr: 'Interface', de: 'Schnittstelle', es: 'Interfaz' },
};

// The state of the throughput against the threshold (scene filter values).
export const THRESHOLD_TEXT = {
  above: {
    en: 'Above the threshold',
    fr: 'Au-dessus du seuil',
    de: 'Über dem Schwellwert',
    es: 'Por encima del umbral',
  },
  below: {
    en: 'Back below',
    fr: 'Revenu en dessous',
    de: 'Wieder darunter',
    es: 'De nuevo por debajo',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version) => `ntopng ${version} answers`,
    interfaces: (count) => `${count} interface(s)`,
    hosts: (count) => `${count} active host(s)`,
    alerts: (count) => `${count} engaged alert(s)`,
  },
  fr: {
    ok: (version) => `ntopng ${version} répond`,
    interfaces: (count) => `${count} interface(s)`,
    hosts: (count) => `${count} hôte(s) actif(s)`,
    alerts: (count) => `${count} alerte(s) en cours`,
  },
  de: {
    ok: (version) => `ntopng ${version} antwortet`,
    interfaces: (count) => `${count} Schnittstelle(n)`,
    hosts: (count) => `${count} aktive(r) Host(s)`,
    alerts: (count) => `${count} aktive(r) Alarm(e)`,
  },
  es: {
    ok: (version) => `ntopng ${version} responde`,
    interfaces: (count) => `${count} interfaz(ces)`,
    hosts: (count) => `${count} host(s) activo(s)`,
    alerts: (count) => `${count} alerta(s) en curso`,
  },
};

// The `summary` outputs of the scene actions, ready for a message.
export const SUMMARY_TEXT = {
  en: {
    download: 'download',
    upload: 'upload',
    hosts: (count) => `${count} host(s)`,
    flows: (count) => `${count} flow(s)`,
    alerts: (count) => `${count} engaged alert(s)`,
    noAlert: 'no alert',
    times: (count) => `${count} times`,
  },
  fr: {
    download: 'réception',
    upload: 'émission',
    hosts: (count) => `${count} hôte(s)`,
    flows: (count) => `${count} flux`,
    alerts: (count) => `${count} alerte(s) en cours`,
    noAlert: 'aucune alerte',
    times: (count) => `${count} fois`,
  },
  de: {
    download: 'Empfang',
    upload: 'Senden',
    hosts: (count) => `${count} Host(s)`,
    flows: (count) => `${count} Flow(s)`,
    alerts: (count) => `${count} aktive(r) Alarm(e)`,
    noAlert: 'kein Alarm',
    times: (count) => `${count}-mal`,
  },
  es: {
    download: 'recepción',
    upload: 'envío',
    hosts: (count) => `${count} host(s)`,
    flows: (count) => `${count} flujo(s)`,
    alerts: (count) => `${count} alerta(s) en curso`,
    noAlert: 'ninguna alerta',
    times: (count) => `${count} veces`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  noUrl: {
    en: 'ntopng is not configured.',
    fr: "ntopng n'est pas configuré.",
    de: 'ntopng ist nicht konfiguriert.',
    es: 'ntopng no está configurado.',
  },
  unknownInterface: {
    en: 'This device is not an interface monitored by ntopng.',
    fr: "Cet appareil n'est pas une interface surveillée par ntopng.",
    de: 'Dieses Gerät ist keine von ntopng überwachte Schnittstelle.',
    es: 'Este dispositivo no es una interfaz supervisada por ntopng.',
  },
};

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A number written the way the language writes it (decimal comma in fr, de, es). */
export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** A data rate, "12,4 Mbit/s", "850 kbit/s" below 1 Mbit/s. */
export function formatRate(mbps, language) {
  if (mbps < 1) {
    return `${formatNumber(mbps * 1000, language, 0)} kbit/s`;
  }
  return `${formatNumber(mbps, language, mbps >= 100 ? 0 : 1)} Mbit/s`;
}
