import {readFile, rm} from 'node:fs/promises';
import nunjucks from 'nunjucks';

import {publicationsForPublicOutput, validateEditorialCatalog} from './publication-contract.js';

export const nunjucksEnvironment = nunjucks.configure(
  ['institute-src', 'institute-src/_includes'],
  {autoescape: true, noCache: true},
);

const passthrough = [
  '.nojekyll',
  '.well-known',
  'CNAME',
  'favicon.svg',
  'index.html',
  'site-shell.css',
  'weather.html',
  'weather.css',
  'weather.js',
  'weather-core.js',
  'observatory.html',
  'instrument.css',
  'cartographer.html',
  'cartographer.css',
  'cartographer.js',
  'cartographer-view.js',
  'cartographer-events.js',
  'data',
];

export default function (eleventyConfig) {
  eleventyConfig.setLibrary('njk', nunjucksEnvironment);
  eleventyConfig.addFilter('publicPublications', catalog => publicationsForPublicOutput(catalog));
  eleventyConfig.on('eleventy.before', async () => {
    const catalog = JSON.parse(await readFile('institute-src/_data/editorial.json', 'utf8'));
    validateEditorialCatalog(catalog);
    await rm('_site', {recursive: true, force: true});
  });

  for (const path of passthrough) eleventyConfig.addPassthroughCopy(path);
  eleventyConfig.addPassthroughCopy({'institute-src/assets': 'assets'});

  return {
    dir: {
      input: 'institute-src',
      includes: '_includes',
      data: '_data',
      output: '_site',
    },
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
