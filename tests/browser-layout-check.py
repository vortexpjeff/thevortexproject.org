#!/usr/bin/env python3
"""Rendered layout checks for the four Vortex public surfaces.

Requires the local site on :8765 and Chrome remote debugging on :9228.
"""

import json
import time
import unittest
import urllib.parse
import urllib.request

import websocket

BASE = "http://127.0.0.1:8765"
DEVTOOLS = "http://127.0.0.1:9228"
PAGES = {
    "field": "/",
    "weather": "/weather.html?lat=35.5951&lon=-82.5515&name=Asheville&admin=North%20Carolina&country=United%20States&cc=US&tz=America%2FNew_York",
    "observatory": "/observatory.html",
    "cartographer": "/cartographer.html",
}


class BrowserPage:
    def __init__(self, path, width, height, mobile=False):
        request = urllib.request.Request(
            DEVTOOLS + "/json/new?" + urllib.parse.quote(BASE + path, safe=":/?=%"),
            method="PUT",
        )
        self.target = json.load(urllib.request.urlopen(request, timeout=10))
        self.ws = websocket.create_connection(self.target["webSocketDebuggerUrl"], timeout=20)
        self.ident = 0
        self.command("Page.enable")
        self.command("Runtime.enable")
        self.command("Network.enable")
        self.command("Network.setCacheDisabled", {"cacheDisabled": True})
        self.command("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": mobile,
        })
        self.command("Page.reload", {"ignoreCache": True})
        deadline = time.time() + 25
        while time.time() < deadline:
            try:
                ready = self.evaluate(
                    "document.readyState==='complete' && !!document.querySelector('.site-head')"
                )
                if ready:
                    return
            except Exception:
                pass
            time.sleep(0.15)
        raise TimeoutError(f"Page did not become ready: {path}")

    def command(self, method, params=None):
        self.ident += 1
        command_id = self.ident
        self.ws.send(json.dumps({"id": command_id, "method": method, "params": params or {}}))
        while True:
            response = json.loads(self.ws.recv())
            if response.get("id") == command_id:
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response.get("result", {})

    def evaluate(self, expression):
        response = self.command("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return response["result"].get("value")

    def close(self):
        self.ws.close()
        urllib.request.urlopen(DEVTOOLS + "/json/close/" + self.target["id"], timeout=10).read()


class VortexLayoutTest(unittest.TestCase):
    def test_shared_shell_and_overflow_desktop(self):
        brand_left = {}
        for name, path in PAGES.items():
            page = BrowserPage(path, 1440, 900)
            try:
                geometry = page.evaluate("""(()=>{
                  const r=e=>e.getBoundingClientRect();
                  return {
                    headerHeight:r(document.querySelector('.site-head')).height,
                    brandLeft:r(document.querySelector('.brand')).left,
                    overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)
                  }
                })()""")
                self.assertAlmostEqual(geometry["headerHeight"], 78, delta=0.1, msg=name)
                self.assertEqual(geometry["overflow"], 0, msg=name)
                brand_left[name] = geometry["brandLeft"]
            finally:
                page.close()
        for name, left in brand_left.items():
            self.assertAlmostEqual(left, brand_left["field"], delta=1, msg=f"{name} shell drift")

    def test_shared_shell_and_overflow_mobile(self):
        for name, path in PAGES.items():
            page = BrowserPage(path, 390, 844, mobile=True)
            try:
                geometry = page.evaluate("""(()=>({
                  headerHeight:document.querySelector('.site-head').getBoundingClientRect().height,
                  overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)
                }))()""")
                self.assertAlmostEqual(geometry["headerHeight"], 68, delta=0.1, msg=name)
                self.assertEqual(geometry["overflow"], 0, msg=name)
            finally:
                page.close()

    def test_primary_help_aligns_to_readout_desktop(self):
        page = BrowserPage(PAGES["observatory"], 1440, 900)
        try:
            deadline = time.time() + 20
            while time.time() < deadline and not page.evaluate("!!document.querySelector('#solar .primary-label .help-trigger')"):
                time.sleep(0.2)
            page.evaluate("document.querySelector('#solar').scrollIntoView({block:'center',behavior:'auto'})")
            page.evaluate("document.querySelector('#solar .primary-label .help-trigger').click()")
            time.sleep(0.3)
            geometry = page.evaluate("""(()=>{
              const panel=document.querySelector('#helpPanel').getBoundingClientRect();
              const readout=document.querySelector('#solar .readout').getBoundingClientRect();
              return {panelRight:panel.right,readoutRight:readout.right,panelLeft:panel.left,panelTop:panel.top,panelBottom:panel.bottom};
            })()""")
            self.assertAlmostEqual(geometry["panelRight"], geometry["readoutRight"], delta=2)
            self.assertGreaterEqual(geometry["panelLeft"], 12)
            self.assertGreaterEqual(geometry["panelTop"], 12)
            self.assertLessEqual(geometry["panelBottom"], 888)
        finally:
            page.close()

    def test_primary_help_remains_bottom_sheet_mobile(self):
        page = BrowserPage(PAGES["observatory"], 390, 844, mobile=True)
        try:
            deadline = time.time() + 20
            while time.time() < deadline and not page.evaluate("!!document.querySelector('#solar .primary-label .help-trigger')"):
                time.sleep(0.2)
            page.evaluate("document.querySelector('#solar .primary-label .help-trigger').click()")
            time.sleep(0.3)
            geometry = page.evaluate("""(()=>{
              const panel=document.querySelector('#helpPanel').getBoundingClientRect();
              return {left:panel.left,right:panel.right,bottom:panel.bottom,width:panel.width};
            })()""")
            self.assertAlmostEqual(geometry["left"], 0, delta=0.1)
            self.assertAlmostEqual(geometry["right"], 390, delta=0.1)
            self.assertAlmostEqual(geometry["bottom"], 844, delta=0.1)
        finally:
            page.close()

    def test_weather_water_observation_and_non_us_coverage(self):
        page = BrowserPage(PAGES["weather"], 390, 844, mobile=True)
        try:
            deadline = time.time() + 45
            ready = False
            while time.time() < deadline:
                ready = page.evaluate(
                    "!document.querySelector('#weatherContent').hidden && !document.querySelector('#waterSection').hidden"
                )
                if ready:
                    break
                time.sleep(0.25)
            self.assertTrue(ready, msg=page.evaluate("document.querySelector('#weatherStatus').textContent"))
            water = page.evaluate("""(()=>({
              link:document.querySelector('.water-station')?.href||'',
              metricCount:document.querySelectorAll('.water-metric').length,
              pathCount:document.querySelectorAll('.water-chart path').length,
              overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)
            }))()""")
            self.assertTrue(water["link"].startswith("https://waterdata.usgs.gov/monitoring-location/USGS-"))
            self.assertGreaterEqual(water["metricCount"], 1)
            self.assertGreaterEqual(water["pathCount"], 1)
            self.assertEqual(water["overflow"], 0)
        finally:
            page.close()

        paris = BrowserPage(
            "/weather.html?lat=48.8566&lon=2.3522&name=Paris&country=France&cc=FR&tz=Europe%2FParis",
            390,
            844,
            mobile=True,
        )
        try:
            deadline = time.time() + 30
            while time.time() < deadline and paris.evaluate("document.querySelector('#weatherContent').hidden"):
                time.sleep(0.25)
            self.assertTrue(paris.evaluate("document.querySelector('#waterSection').hidden"))
        finally:
            paris.close()

    def test_weather_survives_usgs_outage(self):
        page = BrowserPage(PAGES["weather"], 390, 844, mobile=True)
        try:
            page.command("Network.setBlockedURLs", {"urls": ["*waterservices.usgs.gov*"]})
            page.command("Page.reload", {"ignoreCache": True})
            deadline = time.time() + 45
            ready = False
            while time.time() < deadline:
                ready = page.evaluate(
                    "!document.querySelector('#weatherContent').hidden && document.querySelector('#waterContent').textContent.includes('temporarily unavailable')"
                )
                if ready:
                    break
                time.sleep(0.25)
            self.assertTrue(ready, msg=page.evaluate("document.querySelector('#weatherStatus').textContent"))
            self.assertIn("Forecast loaded", page.evaluate("document.querySelector('#weatherStatus').textContent"))
            self.assertFalse(page.evaluate("document.querySelector('#waterSection').hidden"))
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
