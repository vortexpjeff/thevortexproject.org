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

    def test_cartographer_visible_controls_meet_desktop_target_size(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 1440, 900)
        try:
            targets = page.evaluate("""(()=>{
              const controls=[...document.querySelectorAll('.date-tools button,.date-tools input,.event-filter')]
                .map(control=>({name:control.getAttribute('aria-label')||control.textContent.trim(),rect:control.getBoundingClientRect().toJSON()}))
                .filter(control=>control.rect.width>0&&control.rect.height>0);
              return {count:controls.length,minWidth:Math.min(...controls.map(control=>control.rect.width)),minHeight:Math.min(...controls.map(control=>control.rect.height)),controls};
            })()""")
            self.assertEqual(targets["count"], 10)
            self.assertGreaterEqual(targets["minWidth"], 44, msg=targets["controls"])
            self.assertGreaterEqual(targets["minHeight"], 44, msg=targets["controls"])
        finally:
            page.close()

    def test_cartographer_is_fixed_geographic_image_and_accessible_ledger_mobile(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            deadline = time.time() + 80
            ready = False
            while time.time() < deadline:
                ready = page.evaluate("document.querySelector('#orbitalImage').complete && document.querySelector('#orbitalImage').naturalWidth>0 && document.querySelector('#eventCount').textContent!=='loading'")
                if ready:
                    break
                time.sleep(0.25)
            self.assertTrue(ready)
            baseline = page.evaluate("""(()=>{
              const frame=document.querySelector('#orbitalFrame').getBoundingClientRect();
              const controls=[...document.querySelectorAll('.date-tools button,.date-tools input,.event-filter')];
              const ledger=[...document.querySelectorAll('.event-ledger-focus')];
              return {
                noBrief:!document.querySelector('.brief'),
                noStationCopy:!document.body.textContent.includes('Surface temperature') && !document.body.textContent.includes('Acoustic events'),
                noOpenLayers:!document.querySelector('.ol-viewport')&&!window.ol,
                frameRole:document.querySelector('#orbitalFrame').getAttribute('role'),
                imageAlt:document.querySelector('#orbitalImage').alt,
                frameWidth:frame.width,frameHeight:frame.height,
                naturalWidth:document.querySelector('#orbitalImage').naturalWidth,
                naturalHeight:document.querySelector('#orbitalImage').naturalHeight,
                source:document.querySelector('#orbitalImage').currentSrc,
                minTargetHeight:Math.min(...controls.map(control=>control.getBoundingClientRect().height)),
                minTargetWidth:Math.min(...controls.map(control=>control.getBoundingClientRect().width)),
                visibleControls:controls.every(control=>{const r=control.getBoundingClientRect();return r.width>0&&r.height>0}),
                ledgerMinHeight:Math.min(...ledger.map(control=>control.getBoundingClientRect().height)),
                markerCount:document.querySelectorAll('.event-marker').length,
                ledgerCount:ledger.length,
                overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)
              };
            })()""")
            self.assertTrue(baseline["noBrief"])
            self.assertTrue(baseline["noStationCopy"])
            self.assertTrue(baseline["noOpenLayers"])
            self.assertIsNone(baseline["frameRole"])
            self.assertIn("NASA corrected-reflectance true-color world image", baseline["imageAlt"])
            self.assertAlmostEqual(baseline["frameWidth"] / baseline["frameHeight"], 360 / 156, delta=0.02)
            self.assertAlmostEqual(baseline["naturalWidth"] / baseline["naturalHeight"], 360 / 156, delta=0.02)
            self.assertIn("gibs.earthdata.nasa.gov/wms/epsg4326", baseline["source"])
            self.assertGreaterEqual(baseline["minTargetHeight"], 44)
            self.assertGreaterEqual(baseline["minTargetWidth"], 44)
            self.assertTrue(baseline["visibleControls"])
            self.assertGreaterEqual(baseline["ledgerMinHeight"], 44)
            self.assertGreater(baseline["markerCount"], 0)
            self.assertLessEqual(baseline["markerCount"], 98)
            self.assertEqual(baseline["ledgerCount"], 36)
            self.assertEqual(baseline["overflow"], 0)
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

    def test_cartographer_events_follow_date_filters_and_survive_provider_outage(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            for provider_attempt in range(3):
                deadline = time.time() + 80
                while time.time() < deadline and page.evaluate("document.querySelector('#eventCount').textContent==='loading'"):
                    time.sleep(0.25)
                if page.evaluate("Number(document.querySelector('.event-filter[data-category=\"wildfires\"] b').textContent)") > 0:
                    break
                if provider_attempt < 2:
                    page.command("Page.reload", {"ignoreCache": True})
            result = page.evaluate("""(()=>({
              date:document.querySelector('#imageDate').value,
              mapped:Number(document.querySelector('#eventCount').textContent.split(' ')[0]),
              records:Number(document.querySelector('#eventCount').textContent.split(' · ')[1].split(' ')[0]),
              quakes:Number(document.querySelector('.event-filter[data-category="earthquake"] b').textContent),
              fires:Number(document.querySelector('.event-filter[data-category="wildfires"] b').textContent),
              categoryTotal:[...document.querySelectorAll('.event-filter b')].reduce((sum,node)=>sum+Number(node.textContent||0),0),
              markers:document.querySelectorAll('.event-marker').length,
              rows:document.querySelectorAll('.event-row').length,
              moreVisible:!document.querySelector('#eventLedgerMore').hidden,
              overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
              ledgerOverflow:Math.max(0,document.querySelector('#eventLedger').scrollWidth-document.querySelector('#eventLedger').clientWidth)
            }))()""")
            self.assertEqual(result["date"], "2026-07-12")
            self.assertGreater(result["quakes"], 0)
            self.assertGreater(result["fires"], 0)
            self.assertEqual(result["records"], result["categoryTotal"])
            self.assertEqual(result["mapped"], result["markers"])
            self.assertLessEqual(result["mapped"], result["records"])
            self.assertEqual(result["rows"], 36)
            self.assertTrue(result["moreVisible"])
            self.assertEqual(result["overflow"], 0)
            self.assertEqual(result["ledgerOverflow"], 0)
            directory = page.evaluate("""(()=>{
              const buttons=[...document.querySelectorAll('.event-ledger-focus')];
              const links=[...document.querySelectorAll('.event-source-link')];
              return {
                items:buttons.length,
                minTarget:Math.min(...buttons.map(button=>button.getBoundingClientRect().height)),
                linksSafe:links.every(link=>link.href.startsWith('https://')),
              };
            })()""")
            self.assertEqual(directory["items"], 36)
            self.assertGreaterEqual(directory["minTarget"], 44)
            self.assertTrue(directory["linksSafe"])
            inspector = page.evaluate("""(()=>{
              const button=document.querySelector('.event-ledger-focus');
              button.focus();
              button.click();
              const panel=document.querySelector('#eventInspector');
              return {
                hidden:panel.hidden,
                title:document.querySelector('#eventInspectorTitle').textContent,
                link:document.querySelector('#eventInspectorLink').href,
                opener:button.dataset.eventId,
              };
            })()""")
            self.assertFalse(inspector["hidden"])
            self.assertTrue(inspector["title"])
            self.assertTrue(inspector["link"].startswith("https://"))
            page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            closed = page.evaluate("""(()=>({
              hidden:document.querySelector('#eventInspector').hidden,
              restored:document.activeElement?.dataset?.eventId||''
            }))()""")
            self.assertTrue(closed["hidden"])
            self.assertEqual(closed["restored"], inspector["opener"])
            page.evaluate("document.querySelector('.event-filter[data-category=\"wildfires\"]').click()")
            filtered = page.evaluate("Number(document.querySelector('#eventCount').textContent.split(' · ')[1].split(' ')[0])")
            self.assertEqual(filtered, result["records"] - result["fires"])
            page.evaluate("document.querySelector('.event-filter[data-category=\"wildfires\"]').click()")
            page.command("Network.emulateNetworkConditions", {
                "offline": False,
                "latency": 1200,
                "downloadThroughput": 1000000,
                "uploadThroughput": 1000000,
            })
            page.evaluate("""(()=>{
              const input=document.querySelector('#imageDate');
              input.value='2026-07-11';
              input.dispatchEvent(new Event('change',{bubbles:true}));
              input.value='2026-07-12';
              input.dispatchEvent(new Event('change',{bubbles:true}));
            })()""")
            time.sleep(2)
            cached = page.evaluate("""(()=>({
              date:document.querySelector('#imageDate').value,
              records:Number(document.querySelector('#eventCount').textContent.split(' · ')[1].split(' ')[0]),
              fires:Number(document.querySelector('.event-filter[data-category="wildfires"] b').textContent)
            }))()""")
            self.assertEqual(cached["date"], "2026-07-12")
            self.assertEqual(cached["records"], result["records"])
            self.assertEqual(cached["fires"], result["fires"])
        finally:
            page.close()

        outage = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            outage.command("Network.setBlockedURLs", {"urls": [
                "*earthquake.usgs.gov*",
                "*eonet.gsfc.nasa.gov*",
            ]})
            outage.command("Page.reload", {"ignoreCache": True})
            deadline = time.time() + 45
            ready = False
            status = ""
            while time.time() < deadline:
                status = outage.evaluate("document.querySelector('#eventStatus').textContent")
                ready = "providers unavailable" in status and outage.evaluate("document.querySelector('#orbitalImage').naturalWidth>0")
                if ready:
                    break
                time.sleep(0.25)
            self.assertTrue(ready, msg=status)
            self.assertGreater(outage.evaluate("document.querySelector('#orbitalImage').naturalWidth"), 0)
            self.assertIn("No qualifying events", status)
        finally:
            outage.close()

    def test_cartographer_reports_complete_gibs_failure_without_hiding_events(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            page.command("Network.setBlockedURLs", {"urls": ["*gibs.earthdata.nasa.gov*"]})
            page.command("Page.reload", {"ignoreCache": True})
            deadline = time.time() + 45
            state = {"title": "", "detail": "", "events": ""}
            while time.time() < deadline:
                state = page.evaluate("""(()=>({
                  title:document.querySelector('#imageState b')?.textContent||'',
                  detail:document.querySelector('#imageState span')?.textContent||'',
                  events:document.querySelector('#eventCount').textContent
                }))()""")
                if state["title"] == "Image unavailable" and state["events"] != "loading":
                    break
                time.sleep(0.25)
            self.assertEqual(state["title"], "Image unavailable")
            self.assertIn("did not return", state["detail"])
            self.assertIn("records", state["events"])
        finally:
            page.close()

    def test_cartographer_blue_marble_fallback_replaces_daily_provenance(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            page.command("Network.setBlockedURLs", {"urls": ["*LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor*"]})
            page.command("Page.reload", {"ignoreCache": True})
            deadline = time.time() + 45
            metadata = {}
            while time.time() < deadline:
                metadata = page.evaluate("""(()=>({
                  state:document.querySelector('#coverageState').textContent,
                  product:document.querySelector('#imageProduct').textContent,
                  provenance:document.querySelector('#imageProvenance').textContent,
                  date:document.querySelector('#imageDateLong').textContent,
                  platform:document.querySelector('#imagePlatform').textContent,
                  instrument:document.querySelector('#imageInstrument').textContent,
                  resolution:document.querySelector('#imageResolution').textContent,
                  source:document.querySelector('#sourceImageLink').href,
                  alt:document.querySelector('#orbitalImage').alt,
                  width:document.querySelector('#orbitalImage').naturalWidth,
                }))()""")
                if metadata.get("state") == "Timeless fallback" and metadata.get("width", 0) > 0:
                    break
                time.sleep(0.25)
            self.assertEqual(metadata["state"], "Timeless fallback")
            self.assertEqual(metadata["product"], "Blue Marble · Next Generation")
            self.assertEqual(metadata["provenance"], "NASA Blue Marble · timeless baseline")
            self.assertEqual(metadata["date"], "Timeless baseline")
            self.assertEqual(metadata["platform"], "NASA composite")
            self.assertEqual(metadata["instrument"], "Blue Marble")
            self.assertEqual(metadata["resolution"], "500 m nominal")
            self.assertIn("LAYERS=BlueMarble_NextGeneration", metadata["source"])
            self.assertIn("timeless world baseline", metadata["alt"])
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
