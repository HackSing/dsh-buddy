# dsh-buddy-about

[中文说明](./README.zh-CN.md)

A dsh Web UI plugin shipped by the [DSH Buddy](../../README.md) desktop shell.
It registers a first-level **About** page in the dsh settings panel and shows
a small version row at the bottom of the dsh sidebar.

This is a community project. It is not an official DeepSeek plugin and is not
affiliated with or endorsed by DeepSeek.

## What it does

- **Settings → About**: shows the DSH Buddy version and the dsh version (when
  the host publishes one), plus **Check for updates** / **Check plugin
  updates** buttons. In this first phase both buttons degrade to
  `window.open()` of the GitHub releases page; the shell-side bridge that
  triggers a real update check is phase 2.
- **Sidebar badge**: a small `DSH Buddy vX.Y.Z` row injected next to the
  shell's settings row, colored with dsh CSS variables so it follows the
  active skin.

## Version sources

- DSH Buddy version: `window.__DSH_BUDDY__.version` (injected by the shell in
  phase 2), falling back to the build-time constant stamped from this
  package's `package.json` version.
- dsh version: `window.__DSH_BOOT__.version`; the current boot-graph wire
  (rc.8) carries no such field, so the row is hidden until the host publishes
  one.

## Development

```sh
npm install --workspaces=false   # standalone install (the repo root uses npm workspaces)
npm run build                    # tsdown -> lib/client.js
```

The build wraps the bundle in the `window.__ModuleLoader__.load({id, factory})`
envelope expected by the dsh client loader, with `react` kept external
(resolved by the loader at runtime — this package declares it as a peer
dependency). Pure logic lives in `src/shared/` and is covered by the repo
suite: `node --test test/dsh-buddy-about.test.mjs` (run from the repo root).

## Layout

```
├── package.json          # dsh.bundle.patch + dsh.client + exports["./client"]
├── cordis.patch.yml      # one-row roster insert
├── tsdown.config.mjs     # ModuleLoader envelope + version stamping
└── src/
    ├── client/           # apply() entry, About section, sidebar injection
    └── shared/           # pure constants and version resolution (tested)
```

See [`docs/dsh-web-ui-plugin-guide.md`](../../docs/dsh-web-ui-plugin-guide.md)
for the plugin contract this package follows.
