// Host half: intentionally a no-op.
//
// The cordis loader imports the package main entry (exports["."]) for every
// loader entry — including client-only plugins. A missing main crashes the
// whole dsh boot (ERR_PACKAGE_PATH_NOT_EXPORTED), so this stub exists to
// satisfy the import contract. All UI work happens in the browser half
// (lib/client.js); this plugin registers no host services.
export const name = 'dsh-buddy-about';

export function apply() {}
