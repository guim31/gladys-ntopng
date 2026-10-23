# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-23

### Added

- One Gladys device per interface ntopng monitors (8 at most): reachable,
  download and upload rates, active hosts, local hosts, active flows, engaged
  alerts, alerted flows and highest severity.
- Scene triggers: a new ntopng alert (filters: interface, severity, alert type,
  host; flow alerts grouped by type and host, once an hour at most), a new
  local host never seen before, and the throughput of an interface above a
  threshold or back below it.
- Scene actions: the state of an interface with a ready-made summary, and the
  recent alerts of one interface or all of them.
- Dashboard widget "ntopng traffic": throughput, hosts, flows and alerts of an
  interface, or the totals of every interface.
- API token or user and password, self-signed certificates, refresh every
  30 seconds to 5 minutes, texts and documentation in English, French, German
  and Spanish.

[Unreleased]: https://github.com/guim31/gladys-ntopng/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-ntopng/releases/tag/v1.0.0
