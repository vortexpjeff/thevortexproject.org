import {publicationsForPublicOutput} from '../../publication-contract.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const link = source => `<li><a href="${escape(source.url)}" rel="noopener">${escape(source.title || source.url)}</a><small>${escape(source.kind)} · retrieved ${escape(source.retrieved_at)}</small></li>`;

export default class PublicationPage {
  data() {
    return {
      pagination: {
        data: 'editorial.publications',
        size: 1,
        alias: 'publication',
        before(records) {
          const admitted = process.env.VORTEX_BUILD_MODE === 'production' ? publicationsForPublicOutput({publications: records}) : records;
          return admitted.filter(record => record.slug !== 'one-acoustic-pass');
        },
      },
      layout: 'base.njk',
      eleventyComputed: {
        permalink: data => `dispatches/${data.publication.slug}/index.html`,
        title: data => `${data.publication.title} · The Vortex Project`,
        description: data => data.publication.summary,
        canonicalPath: data => `/dispatches/${data.publication.slug}/`,
      },
    };
  }

  render({publication}) {
    const sections = (publication.sections || []).map(section => `<h3>${escape(section.heading)}</h3><p>${escape(section.body)}</p>`).join('');
    const sources = (publication.sources || []).map(link).join('');
    const corrections = (publication.corrections || []).map(item => `<li><b>${escape(item.corrected_at)}</b> ${escape(item.summary)} <small>revision ${escape(item.revision)}</small></li>`).join('') || '<li>No corrections.</li>';
    return `<main class="article" itemscope itemtype="https://schema.org/NewsArticle"><header class="article-head"><p class="eyebrow">${escape(publication.stream)} · ${escape(publication.content_type)}</p><h2 itemprop="headline">${escape(publication.title)}</h2><p class="deck" itemprop="description">${escape(publication.summary)}</p><div class="article-meta"><span>${escape(publication.editorial_state)} · revision ${escape(publication.revision)}</span><span>Related: ${escape(publication.related_program)}</span><span>Editor: ${escape(publication.accountable_editor || 'required before release')}</span><span>AI assistance disclosed</span></div></header><div class="article-layout"><div class="article-body" itemprop="articleBody">${sections}<section id="corrections"><h3>Correction history</h3><ol>${corrections}</ol></section></div><aside class="source-rail"><div class="source-row"><small>Editorial state</small><b>${escape(publication.editorial_state)}</b></div><div class="source-row"><small>Evidence level</small><b>${escape(publication.evidence_level)}</b></div><div class="source-row"><small>Privacy</small><b>${escape(publication.privacy_state)}</b></div><div class="source-row"><small>Rights</small><b>${escape(publication.rights_state)}</b></div><div class="source-row"><small>Sources</small><ul>${sources || '<li>None admitted.</li>'}</ul></div></aside></div></main>`;
  }
}
