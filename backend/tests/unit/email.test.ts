import { describe, expect, it } from 'vitest';
import { escapeHtml, isEmailConfigured } from '../../src/services/emailService.js';

describe('booking email support', () => {
  it('escapes user-provided text before inserting it into HTML', () => {
    expect(escapeHtml(`<script a="b">it's & done</script>`)).toBe('&lt;script a=&quot;b&quot;&gt;it&#39;s &amp; done&lt;/script&gt;');
  });

  it('does not attempt real email delivery in tests', () => {
    expect(isEmailConfigured()).toBe(false);
  });
});
