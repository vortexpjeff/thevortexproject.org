import {publicationsForPublicOutput} from '../../publication-contract.js';

export default class PublicationCatalog {
  data() { return {permalink: 'api/publications.json', eleventyExcludeFromCollections: true}; }
  render({editorial}) {
    return JSON.stringify({...editorial, publications: publicationsForPublicOutput(editorial)}, null, 2);
  }
}
