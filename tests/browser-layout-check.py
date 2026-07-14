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
              const controls=[...document.querySelectorAll('.toolbar button,.toolbar input,.ol-zoom button,.ol-attribution button')]
                .map(control=>({name:control.getAttribute('aria-label')||control.textContent.trim(),rect:control.getBoundingClientRect().toJSON()}))
                .filter(control=>control.rect.width>0&&control.rect.height>0);
              return {count:controls.length,minWidth:Math.min(...controls.map(control=>control.rect.width)),minHeight:Math.min(...controls.map(control=>control.rect.height)),controls};
            })()""")
            self.assertGreaterEqual(targets["count"], 11)
            self.assertGreaterEqual(targets["minWidth"], 44, msg=targets["controls"])
            self.assertGreaterEqual(targets["minHeight"], 44, msg=targets["controls"])
        finally:
            page.close()

    def test_cartographer_is_map_first_and_details_sheet_is_accessible_mobile(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            baseline = page.evaluate("""(()=>{
              const map=document.querySelector('.map-shell').getBoundingClientRect();
              const workspace=document.querySelector('.workspace').getBoundingClientRect();
              const controls=[...document.querySelectorAll('.toolbar button,.toolbar input,.ol-zoom button')];
              return {
                noBrief:!document.querySelector('.brief'),
                noStationCopy:!document.body.textContent.includes('Surface temperature') && !document.body.textContent.includes('Acoustic events'),
                mapWidth:map.width,mapHeight:map.height,workspaceWidth:workspace.width,workspaceHeight:workspace.height,
                panelHidden:document.querySelector('#mapPanel').getAttribute('aria-hidden'),
                panelInert:document.querySelector('#mapPanel').inert,
                minTargetHeight:Math.min(...controls.map(control=>control.getBoundingClientRect().height)),
                minTargetWidth:Math.min(...controls.map(control=>control.getBoundingClientRect().width)),
                visibleControls:controls.every(control=>{const r=control.getBoundingClientRect();return r.width>0&&r.height>0}),
                overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)
              };
            })()""")
            self.assertTrue(baseline["noBrief"])
            self.assertTrue(baseline["noStationCopy"])
            self.assertAlmostEqual(baseline["mapWidth"], baseline["workspaceWidth"], delta=0.1)
            self.assertAlmostEqual(baseline["mapHeight"], baseline["workspaceHeight"], delta=0.1)
            self.assertEqual(baseline["panelHidden"], "true")
            self.assertTrue(baseline["panelInert"])
            self.assertGreaterEqual(baseline["minTargetHeight"], 44)
            self.assertGreaterEqual(baseline["minTargetWidth"], 44)
            self.assertTrue(baseline["visibleControls"])
            self.assertEqual(baseline["overflow"], 0)

            page.evaluate("document.querySelector('#panelToggle').click()")
            time.sleep(0.3)
            opened = page.evaluate("""(()=>{
              const panel=document.querySelector('#mapPanel').getBoundingClientRect();
              return {hidden:document.querySelector('#mapPanel').getAttribute('aria-hidden'),inert:document.querySelector('#mapPanel').inert,left:panel.left,right:panel.right,bottom:panel.bottom,focus:document.activeElement?.id};
            })()""")
            self.assertEqual(opened["hidden"], "false")
            self.assertFalse(opened["inert"])
            self.assertAlmostEqual(opened["left"], 0, delta=0.1)
            self.assertAlmostEqual(opened["right"], 390, delta=0.1)
            self.assertAlmostEqual(opened["bottom"], 844, delta=0.1)
            self.assertEqual(opened["focus"], "panelClose")
            page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            self.assertEqual(page.evaluate("document.activeElement?.id"), "panelToggle")
            self.assertEqual(page.evaluate("document.querySelector('#mapPanel').getAttribute('aria-hidden')"), "true")
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
            deadline = time.time() + 80
            while time.time() < deadline and page.evaluate("document.querySelector('#eventCount').textContent==='loading'"):
                time.sleep(0.25)
            result = page.evaluate("""(()=>({
              date:document.querySelector('#imageDate').value,
              count:Number(document.querySelector('#eventCount').textContent.split(' ')[0]),
              quakes:Number(document.querySelector('.event-filter[data-category="earthquake"] b').textContent),
              fires:Number(document.querySelector('.event-filter[data-category="wildfires"] b').textContent),
              categoryTotal:[...document.querySelectorAll('.event-filter b')].reduce((sum,node)=>sum+Number(node.textContent||0),0),
              fallback:!document.querySelector('#mapFallback').hidden,
              overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
              panelOverflow:Math.max(0,document.querySelector('#mapPanel').scrollWidth-document.querySelector('#mapPanel').clientWidth)
            }))()""")
            self.assertEqual(result["date"], "2026-07-12")
            self.assertGreater(result["quakes"], 0)
            self.assertGreater(result["fires"], 0)
            self.assertEqual(result["count"], result["categoryTotal"])
            self.assertFalse(result["fallback"])
            self.assertEqual(result["overflow"], 0)
            self.assertEqual(result["panelOverflow"], 0)
            directory = page.evaluate("""(()=>{
              document.querySelector('#panelToggle').click();
              const details=document.querySelector('#eventDirectory');
              if(!details)return null;
              details.open=true;
              const buttons=[...details.querySelectorAll('.event-list-focus')];
              const links=[...details.querySelectorAll('.event-list-link')];
              return {
                items:details.querySelectorAll('li').length,
                minTarget:Math.min(...buttons.map(button=>button.getBoundingClientRect().height)),
                linksSafe:links.every(link=>link.href.startsWith('https://')),
              };
            })()""")
            self.assertIsNotNone(directory)
            self.assertEqual(directory["items"], result["count"])
            self.assertGreaterEqual(directory["minTarget"], 44)
            self.assertTrue(directory["linksSafe"])
            popup = page.evaluate("""(()=>{
              const button=document.querySelector('.event-list-focus');
              button.click();
              const dialog=document.querySelector('#eventPopup');
              return {
                role:dialog.getAttribute('role'),
                labelledby:dialog.getAttribute('aria-labelledby'),
                hidden:dialog.hidden,
                focus:document.activeElement?.id,
                opener:button.dataset.eventId,
              };
            })()""")
            self.assertEqual(popup["role"], "dialog")
            self.assertEqual(popup["labelledby"], "eventPopupTitle")
            self.assertFalse(popup["hidden"])
            self.assertEqual(popup["focus"], "eventPopupClose")
            page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
            closed = page.evaluate("""(()=>({
              hidden:document.querySelector('#eventPopup').hidden,
              restored:document.activeElement?.dataset?.eventId||''
            }))()""")
            self.assertTrue(closed["hidden"])
            self.assertEqual(closed["restored"], popup["opener"])
            page.evaluate("document.querySelector('.event-filter[data-category=\"wildfires\"]').click()")
            filtered = page.evaluate("Number(document.querySelector('#eventCount').textContent.split(' ')[0])")
            self.assertEqual(filtered, result["count"] - result["fires"])
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
              count:Number(document.querySelector('#eventCount').textContent.split(' ')[0]),
              fires:Number(document.querySelector('.event-filter[data-category="wildfires"] b').textContent)
            }))()""")
            self.assertEqual(cached["date"], "2026-07-12")
            self.assertEqual(cached["count"], result["count"])
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
                ready = "providers unavailable" in status
                if ready:
                    break
                time.sleep(0.25)
            self.assertTrue(ready, msg=status)
            self.assertFalse(outage.evaluate("!document.querySelector('#mapFallback').hidden"))
            self.assertIn("No qualifying events", status)
        finally:
            outage.close()

    def test_cartographer_does_not_report_blank_fallback_tiles_as_imagery(self):
        page = BrowserPage("/cartographer.html?date=2026-07-12", 390, 844, mobile=True)
        try:
            page.command("Network.setBlockedURLs", {"urls": ["*gibs.earthdata.nasa.gov*"]})
            page.command("Page.reload", {"ignoreCache": True})
            deadline = time.time() + 45
            state = {"title": "", "detail": "", "mapFallback": False}
            while time.time() < deadline:
                state = page.evaluate("""(()=>({
                  title:document.querySelector('#imageState b')?.textContent||'',
                  detail:document.querySelector('#imageState span')?.textContent||'',
                  mapFallback:!document.querySelector('#mapFallback').hidden
                }))()""")
                if state["title"] in ("No imagery in this view", "Imagery ready"):
                    break
                time.sleep(0.25)
            self.assertEqual(state["title"], "No imagery in this view")
            self.assertIn("outside coverage", state["detail"])
            self.assertFalse(state["mapFallback"])
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
