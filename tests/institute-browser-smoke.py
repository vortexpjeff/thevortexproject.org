#!/usr/bin/env python3
"""Local rendered smoke checks for generated Institute surfaces.

Run against a local server rooted at _site. Requires Playwright in the invoking
Python environment; it is intentionally not part of the production build.
"""

import os
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("VORTEX_SMOKE_BASE", "http://127.0.0.1:8766")
ARTIFACTS = Path(os.environ.get("VORTEX_SMOKE_ARTIFACTS", "artifacts/site-smoke"))
MODE = os.environ.get("VORTEX_SMOKE_MODE", "preview")
PAGES = {
    "institute": ("/institute/", ".masthead h1", ("Institute", "dispatch")),
    "archive": ("/dispatches/", ".masthead h1", ("Dispatch", "archive")),
}
if MODE == "preview":
    PAGES.update({
        "article": ("/dispatches/one-acoustic-pass/", ".article-head h2", ("One acoustic pass", "three listening heads")),
        "release-review": ("/dispatches/frognet-field-probe-release/", ".article-head h2", ("FrogNet", "bounded research contract")),
        "correction-review": ("/dispatches/correction-record-demonstration/", ".article-head h2", ("Correction records", "wording")),
    })


class InstituteBrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        cls.runtime = sync_playwright().start()
        cls.browser = cls.runtime.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.runtime.stop()

    def inspect_page(self, name, path, headline_selector, expected_tokens, width, height):
        page = self.browser.new_page(viewport={"width": width, "height": height})
        errors = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(BASE + path, wait_until="networkidle")
        self.assertIsNotNone(response)
        self.assertEqual(response.status, 200)
        headline = page.locator(headline_selector).inner_text()
        for token in expected_tokens:
            self.assertIn(token, headline)
        state = page.evaluate("""() => ({
          overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          background: getComputedStyle(document.body).backgroundColor,
          robots: document.querySelector('meta[name="robots"]')?.content || '',
          current: document.querySelector('.head-nav [aria-current="page"]')?.textContent || '',
          minNavHeight: Math.min(...[...document.querySelectorAll('.head-nav a,.head-nav span')].map(node => node.getBoundingClientRect().height)),
          editorialState: document.body.dataset.editorialState || ''
        })""")
        self.assertEqual(state["overflow"], 0, name)
        self.assertEqual(state["background"], "rgb(2, 8, 6)", name)
        self.assertEqual(state["robots"], "noindex,nofollow" if MODE == "preview" else "index,follow", name)
        self.assertEqual(state["current"], "Institute", name)
        self.assertGreaterEqual(state["minNavHeight"], 44, name)
        self.assertEqual(state["editorialState"], "fixture" if MODE == "preview" else "public", name)
        self.assertEqual(errors, [], name)
        page.screenshot(path=str(ARTIFACTS / f"{name}-{width}.png"), full_page=True)
        page.close()

    def test_generated_pages_desktop_and_phone(self):
        for name, (path, headline_selector, expected_tokens) in PAGES.items():
            with self.subTest(page=name, viewport="desktop"):
                self.inspect_page(name, path, headline_selector, expected_tokens, 1440, 900)
            with self.subTest(page=name, viewport="phone"):
                self.inspect_page(name, path, headline_selector, expected_tokens, 390, 844)

    @unittest.skipIf(MODE == "production", "preview article is excluded from production")
    def test_article_exposes_scientific_and_correction_boundaries(self):
        page = self.browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(BASE + PAGES["article"][0], wait_until="networkidle")
        result = page.evaluate("""() => ({
          schema: document.querySelector('main[itemscope]')?.getAttribute('itemtype'),
          unknowns: [...document.querySelectorAll('h3')].some(node => node.textContent === 'What remains unknown'),
          corrections: !!document.querySelector('#corrections'),
          sourceRail: !!document.querySelector('.source-rail'),
          editorBoundary: document.body.textContent.includes('Accountable editor: required')
        })""")
        self.assertEqual(result["schema"], "https://schema.org/NewsArticle")
        self.assertTrue(result["unknowns"])
        self.assertTrue(result["corrections"])
        self.assertTrue(result["sourceRail"])
        self.assertTrue(result["editorBoundary"])
        page.close()

    def test_machine_readable_surfaces_resolve(self):
        page = self.browser.new_page()
        for path in ("/feeds/dispatches.xml", "/feeds/dispatches.json", "/api/publications.json"):
            response = page.request.get(BASE + path)
            self.assertEqual(response.status, 200, path)
            self.assertGreater(len(response.body()), 20, path)
        catalog = page.request.get(BASE + "/api/publications.json").json()
        self.assertEqual(catalog["schema_version"], 1)
        self.assertEqual(catalog["publications"], [])
        feed = page.request.get(BASE + "/feeds/dispatches.json").json()
        self.assertEqual(feed["items"], [])
        rss = page.request.get(BASE + "/feeds/dispatches.xml").text()
        self.assertNotIn("<item>", rss)
        page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
