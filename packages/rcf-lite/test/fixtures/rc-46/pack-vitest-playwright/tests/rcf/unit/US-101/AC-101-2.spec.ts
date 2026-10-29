import { describe, expect, it } from 'vitest';

import { NOTHING_TO_PREVIEW, renderPreviewPage } from '../../../../src/preview-server.ts';

describe('AC-101-2: the preview page shows the slug of a submitted title, or a nothing-to-preview message', () => {
  it('TC-001: a submitted title renders its slug', () => {
    const html = renderPreviewPage('Quarterly Plan, Draft 2');
    expect(html).toContain('<output id="slug">quarterly-plan-draft-2</output>');
    expect(html).not.toContain(NOTHING_TO_PREVIEW);
  });

  it('TC-002: no title, or a title with no letters or digits, renders the nothing-to-preview message', () => {
    for (const title of [null, '', '?!']) {
      const html = renderPreviewPage(title);
      expect(html).toContain(NOTHING_TO_PREVIEW);
      expect(html).not.toContain('<output id="slug">');
    }
  });

  it('TC-003: the submitted title is echoed back escaped', () => {
    const html = renderPreviewPage('<b>"Bold"</b>');
    expect(html).toContain('value="&lt;b&gt;&quot;Bold&quot;&lt;/b&gt;"');
    expect(html).toContain('<output id="slug">b-bold-b</output>');
  });
});
