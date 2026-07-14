#!/usr/bin/env python3
"""Rendered GBIF context checks for the Observatory Acoustic layer."""

import importlib.util
import pathlib
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("layout", ROOT / "tests" / "browser-layout-check.py")
assert spec is not None and spec.loader is not None
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)
BrowserPage = layout.BrowserPage


class ObservatoryGbifTest(unittest.TestCase):
    def test_taxonomy_and_broad_month_context_render_on_desktop_and_mobile(self):
        for width, height, mobile in ((1440, 900, False), (390, 844, True)):
            with self.subTest(width=width):
                page = BrowserPage("/observatory.html", width, height, mobile=mobile)
                try:
                    deadline = time.time() + 35
                    while time.time() < deadline and not page.evaluate(
                        "document.querySelectorAll('.species-context').length>0"
                    ):
                        time.sleep(0.25)
                    page.evaluate("document.querySelector('.species-context summary').focus()")
                    accessibility = page.command("Accessibility.getFullAXTree").get("nodes", [])
                    disclosures = [
                        node for node in accessibility
                        if node.get("role", {}).get("value") == "DisclosureTriangle"
                        and "GBIF" in node.get("name", {}).get("value", "")
                    ]
                    self.assertGreaterEqual(len(disclosures), 1)
                    result = page.evaluate("""(()=>{
                      const details=document.querySelector('.species-context');
                      if(!details)return null;
                      details.open=true;
                      const summary=details.querySelector('summary').getBoundingClientRect();
                      return {
                        open:details.open,
                        focusTag:document.activeElement?.tagName,
                        contexts:document.querySelectorAll('.species-context').length,
                        bars:details.querySelectorAll('.gbif-month').length,
                        taxonomyLinks:document.querySelectorAll('.species-name a[href^="https://www.gbif.org/species/"]').length,
                        summaryHeight:summary.height,
                        caveat:details.querySelector('.gbif-note').textContent,
                        overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
                        source:document.querySelector('#acoustic .layer-source').textContent
                      };
                    })()""")
                    self.assertIsNotNone(result)
                    self.assertTrue(result["open"])
                    self.assertEqual(result["focusTag"], "SUMMARY")
                    self.assertGreaterEqual(result["contexts"], 1)
                    self.assertEqual(result["bars"], 12)
                    self.assertGreaterEqual(result["taxonomyLinks"], 1)
                    self.assertGreaterEqual(result["summaryHeight"], 44)
                    self.assertIn("not abundance", result["caveat"])
                    self.assertIn("migration timing", result["caveat"])
                    self.assertIn("a local sighting", result["caveat"])
                    self.assertIn("GBIF context", result["source"])
                    self.assertEqual(result["overflow"], 0)
                finally:
                    page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
