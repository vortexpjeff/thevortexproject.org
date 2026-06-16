# Vortex Project — Open Source Library

A curated index of open source projects, tools, and knowledge bases for
DIY homesteading, appropriate technology, edge AI, bioacoustics, and
regenerative tech. Maintained by Hermes at Pine Hollow.

Last updated: 2026-06-16

---

## I. HOW TO USE THIS LIBRARY

Each entry has:
- **Name** — the project
- **URL** — where to find it
- **What it is** — one-line description
- **Type** — plans / hardware / software / paper / feed / service
- **Status** — active / maintained / archival

For live sources with RSS feeds, see Section VII (Watchers Config).

---

## II. APPROPRIATE TECHNOLOGY & HOMESTEAD BUILDS

Plans, schematics, and build guides for tools and infrastructure at
homestead scale. The core of the "open source DIY" frame.

### Low-Tech Magazine
- URL: https://solar.lowtechmagazine.com
- Feed: https://solar.lowtechmagazine.com/index.xml (Atom)
- Type: Blog / build guides
- Status: Active
- Description: Solar-powered website publishing guides for solar ovens,
  electric heating elements, handcarts, insulation layers, cooling,
  passive buildings. Every article includes materials, method, and
  measured results. No ads, no tracking, no politics.
- Tags: energy, solar, passive, building, cooking, heating
- Notable articles: How to Build a Solar Powered Electric Oven,
  How to Assemble an Electric Heating Element from Scratch,
  Rediscovering the Handcart, How to Dress and Undress your Home

### Appropedia
- URL: https://www.appropedia.org
- Feed: — (blocked automated access)
- Type: Wiki
- Status: Active
- Description: The sustainability wiki. 4,500+ documented projects
  covering solar cookers, rainwater harvesting, greywater systems,
  composting toilets, rocket stoves, pedal powered generators,
  natural building, water filters, vertical gardens, 3D printing.
  Built over 20 years. Fully CC-BY-SA licensed.
- Tags: water, energy, building, agriculture, sanitation, cooking
- Usage: Manual search via browser when needed. Archive mode.

### Open Source Ecology (OSE)
- URL: https://www.opensourceecology.org
- Feed: https://www.opensourceecology.org/feed/ (RSS)
- Type: Organization / blueprints
- Status: Active
- Description: Global Village Construction Set — 50 open source
  industrial machines that can be built for a fraction of commercial
  cost. Includes tractor, brick press, wind turbine, solar concentrator,
  3D printer, CNC torch table, sawmill, backhoe. Full CAD, BOM, build
  process published. Also runs builder crash courses and a Future
  Builders Academy.
- Tags: industrial, machinery, construction, fabrication, open-hardware

### FarmBot
- URL: https://farm.bot
- Blog: https://farm.bot/blogs
- Feed: — (newsletter)
- Type: Open hardware product
- Status: Active
- Description: Open source CNC farming platform. Genesis v1.8 is a
  precision agriculture robot that seeds, waters, and weeds a garden
  bed autonomously. All CAD files, firmware, and software on GitHub
  at https://github.com/FarmBot. Ships worldwide.
- Tags: agriculture, robotics, CNC, automation, open-hardware

### Gathering for Open Science Hardware (GOSH)
- URL: https://openhardware.science
- Forum: https://forum.openhardware.science
- Type: Community
- Status: Active
- Description: Global community building open source lab equipment —
  centrifuges, microscopes, spectrometers, PCR machines, shakers.
  Manifesto and roadmap published. Annual gatherings.
- Tags: science, lab-equipment, research, open-hardware

### Public Lab
- URL: https://publiclab.org
- Type: Archived wiki
- Status: Archival
- Description: Open source environmental monitoring tools. Balloon
  mapping kits, desktop spectrometry, water quality testing, thermal
  fishing. Archived but content is still accessible and valuable.
- Tags: environmental-monitoring, spectrometry, water, mapping

### Instructables (Technology / Living sections)
- URL: https://www.instructables.com
- Type: Community tutorials
- Status: Active
- Description: Massive library of user-submitted build guides. Quality
  varies. Best filtered by "Workshop," "Living," and "Outside"
  categories. Useful for specific one-off projects (solar dehydrator,
  chicken tractor, greenhouse from windows).
- Tags: DIY, tutorials, (variable quality)

### Permaculture Research Institute
- URL: https://www.permaculturenews.org
- Type: Blog / articles
- Status: Site under maint. (as of June 2026)
- Description: Technical permaculture articles covering swales, food
  forests, water management, soil building, animal systems. Can browse
  via archive.org when live.
- Tags: permaculture, water, soil, food-forest

---

## III. OPEN SOURCE AI / EDGE AI

Models, tools, and research for running AI on local hardware — no
cloud required, no API costs, private.

### Hugging Face Blog
- URL: https://huggingface.co/blog
- Feed: https://huggingface.co/blog/feed.xml
- Type: Blog
- Status: Active
- Description: Technical writeups on open models, deployment, edge
  inference. Covers Distil-Whisper, SmolLM, Gemma, Qwen, Llama,
  small vision models. Practical posts cover quantization, ONNX,
  llama.cpp, TFLite.
- Tags: models, deployment, edge-inference, quantization

### arXiv (relevant categories)
- URL: https://export.arxiv.org/api/query
- Feed: See Section VII
- Type: Papers
- Status: Active
- Description: Preprint server. Key categories for this library:
  cs.AI (AI), cs.CL (NLP), cs.SD (Sound), cs.RO (Robotics),
  cs.CV (Computer Vision), eess.AS (Audio and Speech),
  q-bio.QM (Quantitative Biology).
- Tags: papers, research, open-access

### llama.cpp
- URL: https://github.com/ggml-org/llama.cpp
- Type: Software
- Status: Active
- Description: The standard for running LLMs on consumer hardware.
  CUDA, Metal, Vulkan, CPU backends. Quantization from Q4 to Q8.
  Runs Gemma 4 26B on a 4090 at 127 tok/s. Used daily at Pine
  Hollow. Server mode provides OpenAI-compatible API.
- Tags: inference, llm, local, quantization, cpp

### Whisper / faster-whisper
- URL: https://github.com/SYSTRAN/faster-whisper
- Type: Software
- Status: Active
- Description: Real-time speech-to-text using OpenAI's Whisper models,
  optimized with CTranslate2. Runs on a Pi 4 with tiny.en model at
  ~1.5GB RAM. Powers the HermesPi voice loop.
- Tags: stt, speech, edge, pi, realtime

### BirdNET
- URL: https://github.com/kahst/BirdNET
- Type: Software / model
- Status: Active
- Description: Open source bird sound classifier. 6,522 species.
  TFLite model runs on Pi 4 at ~1W. The backbone of the Pine Hollow
  bioacoustics station. Embedding extraction enables custom classifier
  training on top.
- Tags: bioacoustics, birds, classification, tflite, embedded

### Perch (BirdNET successor / Google)
- URL: https://github.com/google-research/perch
- Type: Model / research
- Status: Active
- Description: Google's embedding model for bird sounds. Replaces
  BirdNET's logit-layer approach with proper embedding extraction.
  Useful for custom classifier training — produces feature vectors
  instead of fixed classes.
- Tags: bioacoustics, embeddings, birds, google-research

### OpenMMLab / MMDetection
- URL: https://github.com/open-mmlab/mmdetection
- Type: Framework
- Status: Active
- Description: Open source object detection toolbox. YOLO, Faster
  R-CNN, RetinaNet implementations. Could be used for farm camera:
  count chickens, track feeder visitors, identify pests. Runs on
  consumer GPU.
- Tags: vision, detection, yolo, pytorch, agriculture

### TensorFlow Lite / TFLite
- URL: https://www.tensorflow.org/lite
- Type: Framework
- Status: Active
- Description: Deploy ML models on microcontrollers, mobile, and
  edge devices. BirdNET runs on TFLite. Supports quantization,
  delegate acceleration (GPU, NPU, XNNPACK). Runs on Pi, ESP32,
  ARM Cortex.
- Tags: edge, deployment, embedded, microcontroller

### Edge Impulse
- URL: https://edgeimpulse.com
- Type: Platform
- Status: Active
- Description: Commercial platform with free tier. End-to-end ML
  for edge devices. Collect data, train model, deploy to
  microcontroller. Good for custom sensor classification (vibration,
  audio, accelerometer). Export to TFLite, Arduino, TensorRT.
- Tags: edge, microcontroller, tinyML, platform

### OpenVINO
- URL: https://github.com/openvinotoolkit/openvino
- Type: Framework
- Status: Active
- Description: Intel's open model optimization toolkit. Converts
  models from PyTorch, TensorFlow, ONNX for efficient CPU inference.
  Runs on Intel hardware (including NUCs — possible future farm
  controller).
- Tags: optimization, inference, intel, cpu

### ONNX Runtime
- URL: https://github.com/microsoft/onnxruntime
- Type: Framework
- Status: Active
- Description: Cross-platform inference engine for ONNX models.
  Runs on Linux, Windows, macOS, ARM. Supports quantization and
  acceleration. Can run Whisper, YOLO, BERT on edge hardware.
- Tags: inference, cross-platform, optimization, onnx

### tinyML / TensorFlow Lite for Microcontrollers
- URL: https://github.com/tensorflow/tflite-micro
- Type: Framework
- Status: Active
- Description: Run ML models on microcontrollers with KB of RAM.
  Keyword spotting, gesture recognition, anomaly detection on
  ESP32, STM32, Arduino. Possible farm sensor anomaly detection.
- Tags: microcontroller, ultra-low-power, embedded, tinyml

### OpenCV
- URL: https://github.com/opencv/opencv
- Type: Library
- Status: Active
- Description: Standard open source computer vision library.
  Camera capture, image processing, simple detection. Works with
  any USB camera. Useful for trail cam, feeder cam, plant health
  from leaf color.
- Tags: vision, camera, image-processing

### MQTT / Eclipse Mosquitto
- URL: https://github.com/eclipse/mosquitto
- Type: Software
- Status: Active
- Description: Lightweight MQTT broker. The standard for IoT sensor
  networks. Publish sensor readings from multiple Pi/ESP32 nodes,
  subscribe from a central dashboard. Runs on a Pi with minimal
  overhead.
- Tags: iot, messaging, sensor-network, lightweight

---

## IV. BIOACOUSTICS & CITIZEN SCIENCE

Tools, databases, and communities for ecological acoustic monitoring.

### BirdNET-Pi
- URL: https://github.com/mcguirepr89/BirdNET-Pi
- Type: Software / appliance
- Status: Active
- Description: Turnkey BirdNET installation for Raspberry Pi.
  Installs as a systemd service, provides web UI, SQLite database
  of detections, clip extraction. The actual stack running at
  Pine Hollow.
- Tags: birds, pi, detection, appliance, 24-7

### Arbimon / RFCx (Rainforest Connection)
- URL: https://arbimon.com
- Type: Platform
- Status: Active
- Description: Cloud platform for bioacoustic analysis. Upload
  recordings, visualize spectrograms, train custom classifiers.
  Used by conservation orgs globally. Free for non-profit research.
- Tags: bioacoustics, cloud, analysis, conservation

### BatDetect
- URL: https://github.com/macaodha/batdetect2
- Type: Model / software
- Status: Active
- Description: Deep learning detector and classifier for bat
  echolocation calls. Works with ultrasound recordings. Could
  extend hollow monitoring to bats with an appropriate microphone.
- Tags: bats, echolocation, ultrasound, detection

### Xeno-Canto
- URL: https://xeno-canto.org
- Type: Database
- Status: Active
- Description: Community-curated database of bird sounds. 500,000+
  recordings across 10,000+ species. CC-licensed recordings usable
  for classifier training. The primary training source for BirdNET.
- Tags: birds, sounds, database, training-data

### Macaulay Library (Cornell Lab)
- URL: https://www.macaulaylibrary.org
- Type: Database
- Status: Active
- Description: The world's largest collection of animal media.
  Video, audio, photos. Used for scientific research and ML training.
- Tags: animals, media, research, training-data

### ecoSound
- URL: https://ecosound.org
- Type: Database
- Status: — (verify)
- Description: Open database of labeled environmental audio for ML.
  Curated by University of São Paulo. Focus on neotropical species.
- Tags: bioacoustics, training-data, open-data, latin-america

### SciPy / librosa
- URL: https://librosa.org
- Type: Library
- Status: Active
- Description: Standard Python library for audio analysis. Used
  everywhere in bioacoustics pipelines: spectrogram generation,
  feature extraction, resampling, filtering. Runs on Pi.
- Tags: audio, analysis, python, spectrogram

---

## V. OPEN SOURCE AGRICULTURE & FARMING TECH

### Open Food Network
- URL: https://openfoodnetwork.org
- Type: Software
- Status: Active
- Description: Open source platform for local food systems. Helps
  farmers manage inventory, sales, distribution. Used by food co-ops
  and CSAs worldwide. Self-hostable.
- Tags: food, distribution, local-food, software

### FarmOS
- URL: https://farmos.org
- Type: Software
- Status: Active
- Description: Open source farm management information system. Track
  plantings, harvests, inputs, livestock. Drupal-based. Self-hostable.
  API for integration with sensors and IoT.
- Tags: farm-management, software, record-keeping

### OpenSprinkler
- URL: https://opensprinkler.com
- Type: Hardware / software
- Status: Active
- Description: Open source irrigation controller. WiFi-enabled, web
  interface, weather-based scheduling. DIY kit or pre-assembled.
  GitHub at https://github.com/OpenSprinkler.
- Tags: irrigation, water, automation, esp8266

### MySensors
- URL: https://mysensors.org
- Type: Framework
- Status: Active
- Description: Open source framework for DIY IoT sensors. Arduino and
  ESP8266/ESP32 based. Soil moisture, temperature, humidity, light,
  water flow sensors. Wireless (NRF24L01, RFM69, LoRa).
- Tags: iot, sensors, arduino, wireless, mesh

### LoRaWAN / The Things Network
- URL: https://www.thethingsnetwork.org
- Type: Network / hardware
- Status: Active
- Description: Long-range, low-power wireless for IoT sensors.
  Range up to 10km line-of-sight. Perfect for farm sensor networks
  across a large property. ESP32 with LoRa modules cost ~$15.
- Tags: iot, long-range, low-power, radio, sensor-network

### Open Source Beehives (archived / alternative)
- URL: https://github.com/opensourcebeehives
- Type: Hardware plans
- Status: Archival
- Description: Open source beehive designs with sensor integration.
  Original project is dormant but plans and GitHub repos still
  accessible. Alternative: monitor hive weight/temperature with
  ESP32 + load cell.
- Tags: bees, pollination, sensors, open-hardware

### Telo EV Truck
- URL: https://telotrucks.com
- Type: Product (closed source but relevant)
- Status: Production (pre-order)
- Description: Compact EV truck the size of a Mini with an 8-foot
  bed. 500+ range. Not open source but represents the direction of
  appropriate-vehicle design. Relevant as a data point in the
  "solarpunk vehicle" conversation.
- Tags: transportation, ev, appropriate-tech

---

## VI. OPEN HARDWARE & MAKER

### KiCad
- URL: https://www.kicad.org
- Type: Software
- Status: Active
- Description: Open source PCB design tool. Full suite — schematic
  capture, PCB layout, 3D viewer, Gerber generation. Industry
  standard for open hardware. Used by all the above hardware projects.
- Tags: pcb, electronics, design-tool

### FreeCAD
- URL: https://www.freecad.org
- Type: Software
- Status: Active
- Description: Open source parametric 3D CAD. Used for mechanical
  design, architectural plans, 3D printing. Can replace Fusion 360
  for most homestead/DIY work.
- Tags: cad, 3d-modeling, mechanical-design

### OpenSCAD
- URL: https://openscad.org
- Type: Software
- Status: Active
- Description: Programmatic 3D CAD. Models are defined by code.
  Ideal for parametric designs (e.g., a bracket generator where you
  change dimensions by editing variables). Excellent for 3D printing.
- Tags: cad, parametric, 3d-printing, scripting

### Prusa / RepRap
- URL: https://www.prusa3d.com (Prusa)
- URL: https://reprap.org (RepRap wiki)
- Type: Hardware
- Status: Active
- Description: Open source 3D printers. RepRap is the origin —
  self-replicating 3D printer. Prusa is the most successful
  commercial descendant, still fully open source. Print custom
  parts for homestead builds: brackets, handles, sensor housings,
  repair parts.
- Tags: 3d-printing, fabrication, prototyping, repair

### Raspberry Pi
- URL: https://www.raspberrypi.com
- Type: Hardware
- Status: Active
- Description: The platform powering BirdNET-Pi, HermesPi, and
  half the open source hardware world. $35-80. Linux. GPIO for
  sensors. Camera interface. Audio via USB or I2S. 5V, ~3W.
- Tags: single-board-computer, gpio, linux, embedded

### ESP32 / ESP8266
- URL: https://www.espressif.com
- Type: Hardware
- Status: Active
- Description: $3-5 microcontroller with WiFi + BLE. The standard
  for IoT sensors. Arduino-compatible. Runs TFLite Micro for edge
  ML. Battery-powered. Can run for months on a 18650 cell.
- Tags: microcontroller, wifi, iot, ultra-low-cost

### Arduino
- URL: https://www.arduino.cc
- Type: Hardware / ecosystem
- Status: Active
- Description: The original open source microcontroller platform.
  Massive ecosystem of shields, libraries, tutorials. Best for
  simple sensor reading, motor control, relay switching. Not as
  powerful as ESP32 but easier to start with.
- Tags: microcontroller, beginner, ecosystem, education

### MNT Reform
- URL: https://mntre.com/reform2.html
- Type: Hardware
- Status: Active
- Description: Open source laptop. Fully repairable, modular, no
  soldered components. ARM or RISC-V mainboard. Designed for right
  to repair and longevity. A statement piece for the open hardware
  movement.
- Tags: laptop, open-hardware, repairable

### Framework Laptop
- URL: https://frame.work
- Type: Hardware
- Status: Active
- Description: Modular, repairable laptop. Expansion cards for
  ports. All CAD files published. Right to repair in practice.
  Not fully open (EC firmware is proprietary) but best-in-class
  for repairability.
- Tags: laptop, modular, repairable, right-to-repair

---

## VII. WATCHERS CONFIG — LIVE RSS FEEDS

These feeds can be polled by `watch_rss.py` from the watchers skill.
Set up as cron jobs. First run records baseline, subsequent runs
only surface new items.

### Confirmed Working Feeds

```yaml
# Homestead / DIY / Appropriate Tech
lowtechmag:
  url: https://solar.lowtechmagazine.com/index.xml
  type: Atom

hackaday:
  url: https://hackaday.com/blog/feed/
  type: RSS
  note: Broader signal — filter for energy/science/arduino tags

ose:
  url: https://www.opensourceecology.org/feed/
  type: RSS

resilience:
  url: https://www.resilience.org/feed/
  type: RSS
  note: Broader — filter for energy/technology/environment categories

# Open Source AI / ML
arxiv_ai:
  url: http://export.arxiv.org/rss/cs.AI
  type: RSS (redirects to HTTPS)

arxiv_sd:
  url: http://export.arxiv.org/rss/cs.SD
  type: RSS
  note: Sound — relevant for bioacoustics

arxiv_cl:
  url: http://export.arxiv.org/rss/cs.CL
  type: RSS
  note: NLP — relevant for edge LLM work

arxiv_ro:
  url: http://export.arxiv.org/rss/cs.RO
  type: RSS
  note: Robotics — relevant for farm automation

huggingface:
  url: https://huggingface.co/blog/feed.xml
  type: RSS
```

### Feeds to Check Manually (blocked or intermittent)

```yaml
appropedia:
  url: https://www.appropedia.org/w/index.php?title=Special:RecentChanges&feed=rss
  status: 403 (blocked)
  workaround: Browse manually

opensource_com:
  url: https://opensource.com/tags/agriculture/feed
  status: TBD
```

### GitHub Watchers (via watch_github.py)

```yaml
# Repos to watch for releases / commits / issues
birdnet:
  repo: kahst/BirdNET
  scope: releases

birdnet_pi:
  repo: mcguirepr89/BirdNET-Pi
  scope: releases

perch:
  repo: google-research/perch
  scope: releases

farmbot:
  repo: FarmBot/Farmbot-Web-App
  scope: releases

llamacpp:
  repo: ggml-org/llama.cpp
  scope: releases

faster_whisper:
  repo: SYSTRAN/faster-whisper
  scope: releases

mosquitto:
  repo: eclipse/mosquitto
  scope: releases
```

---

## VIII. SKILL REFERENCE — OUR OWN PIPELINE

These are Pine Hollow's own builds — documented in existing Hermes skills.

| Skill | What it covers |
|-------|---------------|
| homestead | Full property reference, BirdNET-Pi ops, network, SSH |
| pine-hollow-archive | Bioacoustics factory pipeline |
| birdnet-custom-classifier | Train custom classifiers on BirdNET logits |
| vortex-website | Site deployment, DNS, GitHub Pages |
| hermespi-vortex-voice | Pi voice loop with STT + TTS |
| watchers | RSS/API/GitHub polling with watermark dedup |
| research | arXiv search, knowledge base, RSS monitoring |
| continuous-awareness | Persistent agent awareness across sessions |
| insectnet | Custom insect classifier sidecar |
| holographic-memory-system | Memory & identity persistence |

---

## IX. TAGS INDEX

agriculture, arduino, audio, bats, bioacoustics, birds, building,
cad, camera, cnc, conservation, cooking, database, deployment,
detection, diy, edge, education, electronics, embedded, energy,
environmental-monitoring, esp8266, esp32, fabrication, farm-management,
food, food-forest, gpio, hardware, heating, industrial, inference,
iot, irrigation, lab-equipment, lightweight, linux, llm, local,
local-food, long-distance, low-power, machinery, mapping, mesh,
microcontroller, models, open-data, open-hardware, open-access,
optimization, parametric, pcb, permaculture, pi, pollination,
python, quantization, radio, realtime, record-keeping, repair,
repairable, research, robotics, sensors, sensor-network, single-board,
software, solar, spectrometry, speech, stt, tinyml, tflite,
training-data, transportation, tutorials, ultra-low-cost,
ultra-low-power, ultrasound, vision, water, wireless

---

*Maintained by Hermes at the Vortex Project, Pine Hollow, Sevierville TN.*
*Gift economy — use freely, share freely, contribute if you build something.*
