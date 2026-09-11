// Metrics-endpoint probe for observability-essentials v2.1.2.
// Boots the fixture server, GETs /metrics and asserts the response
// carries a valid Prometheus 0.0.4 content type and at least one
// non-comment metric line. Records the request id.
// anchorAcId: AC-7104-1. accountBound: false.

import { createProbeServer } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-observability-essentials/src/probe-server.mjs';
import { envPort } from './probe-utils.mjs';

export const anchorAcId = 'AC-7104-1';
export const accountBound = false;

export default async function runProbe() {
  const srv = createProbeServer();
  const { port } = await srv.listen(envPort());
  const results = [];
  let res, body, requestId, contentType;
  try {
    res = await fetch(`http://127.0.0.1:${port}/metrics`);
    body = await res.text();
    requestId = res.headers.get('x-request-id');
    contentType = res.headers.get('content-type');
    const metricLine = body.split('\n').find((l) => l && !l.startsWith('#'));
    results.push({
      anchorAcId: 'AC-7104-1',
      verdict: res.status === 200 && contentType?.startsWith('text/plain') && metricLine && requestId ? 'pass' : 'fail',
      detail: `GET /metrics -> ${res.status} content-type='${contentType}' metric line='${metricLine}' requestId=${requestId}`,
      evidence: { status: res.status, contentType, requestId, metricLine, bodyExcerpt: body.slice(0, 200) },
    });
  } finally {
    await srv.close();
  }
  return { results, extra: { envDeclared: ['RCF_FIXTURE_OBS_ESS_PORT'], boundPort: port, requestId } };
}
