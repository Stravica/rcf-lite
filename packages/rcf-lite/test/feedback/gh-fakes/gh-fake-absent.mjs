// Test fake: gh is not on PATH. Used by the status test to assert the
// slice-4 probe reports "not installed" without touching the real gh.
export async function ghOnPath() { return { ok: true, value: { present: false } }; }
export async function ghAuthStatus() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghLabelList() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghRepoView() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghIssueSearch() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghIssueCreate() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghIssueComment() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
export async function ghLabelCreate() { return { ok: false, kind: 'notInstalled', message: 'gh not on path' }; }
