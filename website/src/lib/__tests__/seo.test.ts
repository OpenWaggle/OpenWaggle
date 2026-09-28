import { describe, expect, it } from 'vitest';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, docsArticleJsonLd, jsonLdScript, softwareApplicationJsonLd } from '../seo';

const MAX_TITLE_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 160;

describe('seo defaults', () => {
  it('keeps the home title and description within search snippet limits', () => {
    expect(DEFAULT_TITLE.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(DEFAULT_DESCRIPTION.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  // The app repository has no LICENSE file (only the npm packages are MIT), so the site must not
  // call the app open source until one is added.
  it('does not claim a licence the repository does not declare', () => {
    expect(JSON.stringify(softwareApplicationJsonLd())).not.toMatch(/open[- ]source|license/i);
    expect(DEFAULT_DESCRIPTION).not.toMatch(/open[- ]source/i);
  });
});

describe('json-ld', () => {
  it('escapes "<" so page content cannot close the script tag', () => {
    const script = jsonLdScript([{ '@type': 'Thing', name: '</script><script>alert(1)</script>' }]);
    expect(script).not.toContain('</script>');
    expect(JSON.parse(script)['@graph'][0].name).toBe('</script><script>alert(1)</script>');
  });

  it('describes docs pages with absolute canonical URLs and ordered breadcrumbs', () => {
    const [article, breadcrumbs] = docsArticleJsonLd({
      title: 'Installation',
      description: 'How to install OpenWaggle.',
      path: '/docs/getting-started/installation/',
      breadcrumbs: [
        { name: 'Docs', path: '/docs/getting-started/first-run/' },
        { name: 'Installation', path: '/docs/getting-started/installation/' },
      ],
    });
    expect(article).toMatchObject({ '@type': 'TechArticle', url: 'https://openwaggle.ai/docs/getting-started/installation/' });
    expect(breadcrumbs).toMatchObject({
      itemListElement: [
        { position: 1, item: 'https://openwaggle.ai/docs/getting-started/first-run/' },
        { position: 2, item: 'https://openwaggle.ai/docs/getting-started/installation/' },
      ],
    });
  });
});
