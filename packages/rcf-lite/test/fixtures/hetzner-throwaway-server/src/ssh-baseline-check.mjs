// ssh baseline check module. Runs cloud-init status --wait plus six
// baseline ssh checks against a provisioned Hetzner server. Called only
// from the real-account-cloud-init-hardened probe; a mock path is not
// exercised in the fixture (the mocked dry-run probe covers the render
// path, not the runtime ssh path).

import { spawn } from 'node:child_process';

const BASELINE_CHECKS = [
  { id: 'cloudInitFinished', label: 'cloud-init status --wait completes cleanly', cmd: 'sudo cloud-init status --wait' },
  { id: 'sshKeyOnly', label: 'PasswordAuthentication is no', cmd: 'grep -R "^PasswordAuthentication no" /etc/ssh/sshd_config.d/' },
  { id: 'rootDisabled', label: 'PermitRootLogin is no', cmd: 'grep -R "^PermitRootLogin no" /etc/ssh/sshd_config.d/' },
  { id: 'ufwDefaultDeny', label: 'UFW is active default-deny incoming', cmd: 'sudo ufw status verbose | grep -E "Status: active|deny \\(incoming\\)"' },
  { id: 'dockerUserChain', label: 'DOCKER-USER iptables chain is present', cmd: 'sudo iptables -L DOCKER-USER -n' },
  { id: 'fail2banActive', label: 'fail2ban SSH jail is active', cmd: 'sudo systemctl is-active fail2ban && sudo fail2ban-client status sshd' },
  { id: 'unattendedUpgradesActive', label: 'unattended-upgrades service is enabled', cmd: 'systemctl is-enabled unattended-upgrades' },
];

export async function runSshBaselineChecks(server, { sshUser = 'deploy', sshKeyPath = process.env.RCF_LITE_CI_SSH_KEY } = {}) {
  const target = `${sshUser}@${server.primaryIpv4}`;
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
  return { serverId: server.id, primaryIpv4: server.primaryIpv4, checks };
}

function sshExec(target, cmd, keyPath) {
  return new Promise((resolvePromise, reject) => {
    const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10'];
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
