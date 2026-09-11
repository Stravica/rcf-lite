// ssh baseline check module (v1.0.1). Polls ssh readiness before firing
// (H-1 defect (6): v1.0.0 spawned ssh before cloud-init finished, so
// every check timed out on connection refused / operation timed out).
// Then waits for cloud-init to finish (`cloud-init status --wait`,
// exit-code ignored) so subsequent baseline checks see the settled
// system state. Then runs the six baseline ssh checks against the
// provisioned Hetzner server. The deploy user now carries NOPASSWD
// sudo via the cloud-init sudoers.d fragment (H-1 defect (7)), so the
// sudoed baseline commands no longer block on a tty prompt.
//
// The six baseline verdicts each check for the observable side effect
// of one hardening block per spec 5.1 (PasswordAuthentication no in
// sshd_config.d, PermitRootLogin no in sshd_config.d, UFW active
// default-deny incoming, DOCKER-USER iptables chain present,
// fail2ban SSH jail active, unattended-upgrades service enabled).
// Called only from the real-account-cloud-init-hardened probe.

import { spawn } from 'node:child_process';

const BASELINE_CHECKS = [
  { id: 'sshKeyOnly', label: 'PasswordAuthentication is no', cmd: 'grep -R "^PasswordAuthentication no" /etc/ssh/sshd_config.d/' },
  { id: 'rootDisabled', label: 'PermitRootLogin is no', cmd: 'grep -R "^PermitRootLogin no" /etc/ssh/sshd_config.d/' },
  { id: 'ufwDefaultDeny', label: 'UFW is active default-deny incoming', cmd: 'sudo ufw status verbose | grep -E "Status: active|deny \\(incoming\\)"' },
  { id: 'dockerUserChain', label: 'DOCKER-USER iptables chain is present', cmd: 'sudo iptables -L DOCKER-USER -n' },
  { id: 'fail2banActive', label: 'fail2ban SSH jail is active', cmd: 'sudo test -f /etc/fail2ban/jail.d/sshd.conf && sudo systemctl is-active fail2ban' },
  { id: 'unattendedUpgradesActive', label: 'unattended-upgrades service is enabled', cmd: 'systemctl is-enabled unattended-upgrades' },
];

const SSH_READY_ATTEMPT_TIMEOUT_S = 5;
const SSH_READY_WALL_CLOCK_MS = 6 * 60 * 1000;
const CLOUD_INIT_WAIT_ATTEMPT_S = 300;

export async function waitForSshReady(target, sshKeyPath) {
  const start = Date.now();
  let attempts = 0;
  let lastErr = null;
  while (Date.now() - start < SSH_READY_WALL_CLOCK_MS) {
    attempts += 1;
    const { code, stderr } = await sshExec(target, 'true', sshKeyPath, SSH_READY_ATTEMPT_TIMEOUT_S).catch((err) => ({ code: -1, stderr: err.message }));
    if (code === 0) return { ready: true, attempts, waitedMs: Date.now() - start };
    lastErr = stderr;
    await sleep(3000);
  }
  return { ready: false, attempts, waitedMs: Date.now() - start, lastError: lastErr };
}

// Wait for cloud-init to reach terminal state (done, error, disabled).
// Exit code is captured for diagnostics but not scored; the six
// baseline checks that follow are the actual verdicts.
export async function waitForCloudInit(target, sshKeyPath) {
  const started = Date.now();
  const { code, stderr } = await sshExec(target, 'sudo cloud-init status --wait', sshKeyPath, CLOUD_INIT_WAIT_ATTEMPT_S).catch((err) => ({ code: -1, stderr: err.message }));
  return { code, stderr: (stderr || '').trim().slice(0, 500), waitedMs: Date.now() - started };
}

export async function runSshBaselineChecks(server, { sshUser = 'deploy', sshKeyPath = process.env.RCF_LITE_CI_SSH_KEY } = {}) {
  const target = `${sshUser}@${server.primaryIpv4}`;
  const readiness = await waitForSshReady(target, sshKeyPath);
  if (!readiness.ready) {
    return {
      serverId: server.id,
      primaryIpv4: server.primaryIpv4,
      readiness,
      cloudInit: null,
      checks: [{
        id: 'sshReadiness',
        label: 'ssh readiness poll (bounded 6 minutes)',
        verdict: 'fail',
        detail: `ssh true never returned code 0 across ${readiness.attempts} attempts in ${readiness.waitedMs}ms; last stderr: ${(readiness.lastError || '').slice(0, 200)}`,
      }],
    };
  }
  const cloudInit = await waitForCloudInit(target, sshKeyPath);
  const checks = [];
  for (const c of BASELINE_CHECKS) {
    try {
      const { code, stdout, stderr } = await sshExec(target, c.cmd, sshKeyPath);
      if (code === 0) {
        checks.push({ id: c.id, label: c.label, verdict: 'pass', detail: `stdout: ${stdout.trim().slice(0, 200)}` });
      } else {
        checks.push({ id: c.id, label: c.label, verdict: 'fail', detail: `exit ${code}; stderr: ${stderr.trim().slice(0, 200)}` });
      }
    } catch (err) {
      checks.push({ id: c.id, label: c.label, verdict: 'fail', detail: `ssh threw: ${err.message}` });
    }
  }
  // Diagnostic: on any failure, fetch cloud-init.log tail plus
  // dpkg -l fail2ban to see what really landed.
  const anyFail = checks.some((c) => c.verdict === 'fail');
  let diagnostics = null;
  if (anyFail) {
    const clsAll = await sshExec(target, 'sudo cloud-init status --long', sshKeyPath).catch((err) => ({ code: -1, stderr: err.message }));
    const cllog = await sshExec(target, 'sudo tail -n 100 /var/log/cloud-init-output.log', sshKeyPath).catch((err) => ({ code: -1, stderr: err.message }));
    const dpkg = await sshExec(target, 'dpkg -l fail2ban unattended-upgrades ufw iptables-persistent 2>/dev/null || echo dpkg-failed', sshKeyPath).catch((err) => ({ code: -1, stderr: err.message }));
    diagnostics = {
      cloudInitStatusLong: (clsAll.stdout || clsAll.stderr || '').slice(-2000),
      cloudInitOutputTail: (cllog.stdout || cllog.stderr || '').slice(-3000),
      dpkg: (dpkg.stdout || dpkg.stderr || '').slice(-1000),
    };
  }
  return { serverId: server.id, primaryIpv4: server.primaryIpv4, readiness, cloudInit, checks, diagnostics };
}

export function sshExec(target, cmd, keyPath, connectTimeoutSeconds = 10) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'LogLevel=ERROR',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    ];
    if (keyPath) args.push('-i', keyPath);
    args.push(target, cmd);
    const p = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
