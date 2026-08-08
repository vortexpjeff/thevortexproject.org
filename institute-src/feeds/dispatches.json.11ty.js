import {publicationsForPublicOutput} from '../../publication-contract.js';

export default class DispatchJsonFeed {
  data() { return {permalink: 'feeds/dispatches.json', eleventyExcludeFromCollections: true}; }
  render({editorial}) {
    return JSON.stringify({version: 'https://jsonfeed.org/version/1.1', title: 'The Vortex Project Dispatches', home_page_url: 'https://www.thevortexproject.org/dispatches/', feed_url: 'https://www.thevortexproject.org/feeds/dispatches.json', items: publicationsForPublicOutput(editorial).map(item => ({id: `${item.id}:${item.revision}`, url: item.url, title: item.title, summary: item.summary, date_modified: item.date, _vortex: {editorial_state: item.editorial_state, evidence_level: item.evidence_level}}))}, null, 2);
  }
}
