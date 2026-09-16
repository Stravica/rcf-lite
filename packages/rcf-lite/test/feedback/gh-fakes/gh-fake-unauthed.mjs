// Test fake: gh is installed but not logged in.
export async function ghOnPath() { return { ok: true, value: { present: true } }; }
export async function ghAuthStatus() { return { ok: false, kind: 'auth', message: 'not logged in to github.com', exitCode: 1 }; }
export async function ghLabelList() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
export async function ghRepoView() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
export async function ghIssueSearch() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
export async function ghIssueCreate() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
export async function ghIssueComment() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
export async function ghLabelCreate() { return { ok: false, kind: 'auth', message: 'not logged in' }; }
