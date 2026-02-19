const scenarioFileCandidates = {
  Archipelagos: ["demand_Archipelagos.csv", "Demand_Archipelagos.csv", "Demand_Archipelagos.xlsx"],
  Surge: ["demand_Surge.csv", "Demand_Surge.csv", "Demand_Surge.xlsx"],
  Horizon: ["demand_Horizon.csv", "Demand_Horizon.csv", "Demand_Horizon.xlsx", "Demand_Horzion.csv", "Demand_Horzion.xlsx"],
};

const transportFileCandidates = ["transport_rev.csv", "Transport_rev.csv", "transport.csv"];

const hubCoordinates = {
  Algonquin: [42.3601, -71.0589],
  Appalachia: [39.9526, -79.9959],
  Chicago: [41.8781, -87.6298],
  NBPL: [41.2565, -95.9345],
  Opal: [41.4216, -110.8688],
  Socal: [34.0522, -118.2437],
  TGP: [36.1627, -86.7816],
  "Transco Z5": [28.5383, -81.3792],
  Waha: [31.6504, -103.2502],
  Henry: [29.948, -93.789],
  LNG: [30.2266, -93.2174],
  AECO: [51.0447, -114.0719],
  Mexico: [25.6866, -100.3161],
};

const scenarioColors = {
  Archipelagos: "#2563eb",
  Surge: "#ea580c",
  Horizon: "#7c3aed",
};

const chartTitle = document.getElementById("chart-title");
const chartSubtitle = document.getElementById("chart-subtitle");
const dataStatus = document.getElementById("data-status");
const scenarioSelect = document.getElementById("scenario-select");
const startYearSelect = document.getElementById("start-year");
const endYearSelect = document.getElementById("end-year");
const filePicker = document.getElementById("file-picker");
const reloadFilesBtn = document.getElementById("reload-files");

const demandMap = L.map("map-demand", { zoomControl: true }).setView([37.5, -96], 4);
const transportMap = L.map("map-transport", { zoomControl: true }).setView([37.5, -96], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(demandMap);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(transportMap);

const demandChart = new Chart(document.getElementById("demand-chart"), {
  type: "line",
  data: { labels: [], datasets: [] },
  options: {
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    scales: { y: { beginAtZero: true, stacked: false } },
    plugins: { legend: { display: true } },
  },
});

const state = {
  dates: [],
  dateObjects: [],
  scenarios: {},
  hubs: [],
  selectedHubs: [],
  lastView: { type: "none", hub: null },
};

let demandMarkerLayer = null;
let transportLayerGroup = null;
let transportLoaded = false;
let selectedFilesByScenario = { Archipelagos: [], Surge: [], Horizon: [] };
let selectedTransportFile = null;

function normalizeScenarioName(raw) {
  return raw === "Horzion" ? "Horizon" : raw;
}

function inferScenarioFromName(name) {
  const n = name.toLowerCase();
  if (n.includes("arch")) return "Archipelagos";
  if (n.includes("surge")) return "Surge";
  if (n.includes("horizon") || n.includes("horzion")) return "Horizon";
  return null;
}

function parseDateCell(value) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  const str = String(value ?? "").trim();
  if (!str) return null;
  const date = new Date(str);
  if (!Number.isNaN(date.getTime())) return date;
  const mdY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdY) return new Date(Number(mdY[3]), Number(mdY[1]) - 1, Number(mdY[2]));
  return null;
}

function cleanDateForCentury(rawDate, rowIndex) {
  const d = new Date(rawDate.getTime());
  if (rowIndex >= 350 && d.getFullYear() < 2000) d.setFullYear(d.getFullYear() + 100);
  return d;
}

function formatIsoDate(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function getViewMode() {
  return document.querySelector('input[name="view-mode"]:checked').value;
}

function initYearSelectors() {
  const years = Array.from({ length: 51 }, (_, idx) => 2000 + idx);
  startYearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  endYearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  startYearSelect.value = "2000";
  endYearSelect.value = "2050";
}

function normalizeYearRange() {
  const start = Number(startYearSelect.value);
  const end = Number(endYearSelect.value);
  if (start > end) endYearSelect.value = String(start);
}

function applyYearWindow(labels, datasets) {
  normalizeYearRange();
  const startYear = Number(startYearSelect.value);
  const endYear = Number(endYearSelect.value);

  const idx = state.dateObjects
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.getFullYear() >= startYear && x.d.getFullYear() <= endYear)
    .map((x) => x.i);

  return {
    filteredLabels: idx.map((i) => labels[i]),
    filteredDatasets: datasets.map((set) => ({ ...set, data: idx.map((i) => set.data[i] ?? 0) })),
  };
}

function updateChart(title, subtitle, labels, datasets, stacked = false) {
  const { filteredLabels, filteredDatasets } = applyYearWindow(labels, datasets);
  chartTitle.textContent = title;
  chartSubtitle.textContent = subtitle;
  demandChart.data.labels = filteredLabels;
  demandChart.data.datasets = filteredDatasets;
  demandChart.options.scales.y.stacked = stacked;
  demandChart.update();
}

function showHubAllScenarios(hub) {
  const datasets = Object.keys(scenarioFileCandidates).map((scenario) => ({
    label: scenario,
    data: state.scenarios[scenario]?.[hub] || [],
    borderColor: scenarioColors[scenario],
    backgroundColor: scenarioColors[scenario],
    fill: false,
    pointRadius: 0,
    tension: 0.2,
    borderWidth: 2,
  }));

  state.lastView = { type: "hub", hub };
  updateChart(`Demand for ${hub}`, "Line chart of all scenarios for selected hub.", state.dates, datasets, false);
}

function showPolygonSpecificScenario(hubs, scenario) {
  const datasets = hubs.map((hub) => ({
    label: hub,
    data: state.scenarios[scenario]?.[hub] || [],
    borderColor: "#16a34a",
    backgroundColor: "rgba(22,163,74,0.35)",
    fill: true,
    stack: "hubs",
    pointRadius: 0,
    tension: 0.2,
    borderWidth: 1,
  }));

  state.lastView = { type: "polygon", hub: null };
  updateChart(`${scenario}: ${hubs.length} selected hub(s)`, "Stacked area by selected hubs for chosen scenario.", state.dates, datasets, true);
}

function detectDateColumn(rows) {
  const maxCols = Math.max(...rows.slice(0, 30).map((r) => r.length));
  let best = 1;
  let bestScore = -1;
  for (let c = 0; c < maxCols; c += 1) {
    let score = 0;
    for (let r = 1; r < Math.min(rows.length, 80); r += 1) {
      if (parseDateCell(rows[r][c])) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function parseWorkbookRows(rows, scenario) {
  const dateCol = detectDateColumn(rows);
  const headers = rows[0] || [];
  const skipHubColumns = new Set(["month", "gas_month"]);
  const hubColumns = headers
    .map((value, col) => ({ value: String(value ?? "").trim(), col }))
    .filter((entry) => entry.col !== dateCol && entry.value.length > 0 && !skipHubColumns.has(entry.value.toLowerCase()));

  const localDates = [];
  const localDateObjects = [];
  state.scenarios[scenario] = {};
  hubColumns.forEach((h) => {
    state.scenarios[scenario][h.value] = [];
  });

  for (let r = 1; r < rows.length; r += 1) {
    const rawDate = parseDateCell(rows[r][dateCol]);
    if (!rawDate) continue;
    const cleaned = cleanDateForCentury(rawDate, r + 1);
    const year = cleaned.getFullYear();
    if (year < 2000 || year > 2050) continue;

    localDateObjects.push(cleaned);
    localDates.push(formatIsoDate(cleaned));
    hubColumns.forEach((h) => {
      const value = Number(rows[r][h.col] ?? 0);
      state.scenarios[scenario][h.value].push(Number.isFinite(value) ? value : 0);
    });
  }

  if (state.dateObjects.length === 0) {
    state.dateObjects = localDateObjects;
    state.dates = localDates;
    state.hubs = hubColumns.map((h) => h.value);
  }
}

async function discoverDemandFiles() {
  const discovered = { Archipelagos: [], Surge: [], Horizon: [] };
  if (window.location.protocol === "file:") return discovered;

  try {
    const response = await fetch("./");
    if (!response.ok) return discovered;
    const html = await response.text();
    const hrefMatches = [...html.matchAll(/href=\"([^\"]+)\"/g)].map((m) => decodeURIComponent(m[1]));

    hrefMatches.forEach((href) => {
      const baseName = href.split("/").pop();
      if (!baseName || !baseName.toLowerCase().startsWith("demand")) return;
      if (!/\.(xlsx|xls|csv)$/i.test(baseName)) return;
      const scenario = inferScenarioFromName(baseName);
      if (scenario) discovered[scenario].push(baseName);
    });
  } catch {
    // ignore
  }

  return discovered;
}

async function discoverTransportFileName() {
  if (window.location.protocol === "file:") return null;
  try {
    const response = await fetch("./");
    if (!response.ok) return null;
    const html = await response.text();
    const hrefMatches = [...html.matchAll(/href=\"([^\"]+)\"/g)].map((m) => decodeURIComponent(m[1]));

    const found = hrefMatches.find((h) => h.toLowerCase().includes("transport_rev") && h.toLowerCase().endsWith(".csv"));
    if (found) return found.split("/").pop();

    for (const candidate of transportFileCandidates) {
      if (hrefMatches.includes(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function buildScenarioCandidates(discoveredByScenario) {
  const merged = {};
  Object.keys(scenarioFileCandidates).forEach((scenario) => {
    const set = new Set([
      ...(selectedFilesByScenario[scenario] || []),
      ...(discoveredByScenario[scenario] || []),
      ...scenarioFileCandidates[scenario],
    ]);
    merged[scenario] = [...set];
  });
  return merged;
}

async function readRowsFromSource(source) {
  if (typeof source === "string") {
    const response = await fetch(`./${encodeURIComponent(source)}`);
    if (!response.ok) throw new Error(`Could not fetch ${source}`);
    const text = await response.text();
    if (source.toLowerCase().endsWith(".csv")) {
      const workbook = XLSX.read(text, { type: "string" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    }
    const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  }

  const isCsv = source.name.toLowerCase().endsWith(".csv");
  if (isCsv) {
    const workbook = XLSX.read(await source.text(), { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  }

  const workbook = XLSX.read(await source.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
}

async function loadWorkbookForScenario(scenario, candidateMap) {
  const candidates = candidateMap[scenario] || [];
  for (const source of candidates) {
    try {
      const rows = await readRowsFromSource(source);
      parseWorkbookRows(rows, scenario);
      return typeof source === "string" ? source : source.name;
    } catch {
      // continue
    }
  }
  throw new Error(`No readable workbook found for ${scenario}`);
}

function fallbackData() {
  state.hubs = Object.keys(hubCoordinates);
  state.dateObjects = Array.from({ length: 51 }, (_, i) => new Date(Date.UTC(2000 + i, 0, 1)));
  state.dates = state.dateObjects.map(formatIsoDate);

  Object.keys(scenarioFileCandidates).forEach((scenario, sIdx) => {
    state.scenarios[scenario] = {};
    state.hubs.forEach((hub, hIdx) => {
      state.scenarios[scenario][hub] = state.dates.map((_, i) =>
        Math.round(120 + hIdx * 18 + sIdx * 30 + 35 * Math.sin((i / 10) * Math.PI)),
      );
    });
  });
}

function rebuildDemandMarkers() {
  if (demandMarkerLayer) demandMap.removeLayer(demandMarkerLayer);
  demandMarkerLayer = L.layerGroup().addTo(demandMap);

  state.hubs.forEach((hub) => {
    const coord = hubCoordinates[hub] || [37 + Math.random() * 8, -100 + Math.random() * 20];
    const marker = L.circleMarker(coord, {
      radius: 6,
      color: "#1d4ed8",
      fillColor: "#60a5fa",
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(demandMarkerLayer);

    marker.hubName = hub;
    marker.bindTooltip(hub);
    marker.on("click", () => {
      if (getViewMode() === "hub-all-scenarios") showHubAllScenarios(hub);
      else showPolygonSpecificScenario([hub], normalizeScenarioName(scenarioSelect.value));
    });
  });
}

function redrawCurrentView() {
  if (state.lastView.type === "hub" && state.lastView.hub) {
    showHubAllScenarios(state.lastView.hub);
    return;
  }
  if (state.selectedHubs.length && getViewMode() === "polygon-specific-scenario") {
    showPolygonSpecificScenario(state.selectedHubs, normalizeScenarioName(scenarioSelect.value));
    return;
  }
  updateChart("Click a hub to view all scenarios", "Or draw a polygon to view stacked selected hubs for one scenario.", state.dates, [], false);
}

function setupDemandPolygonSelection() {
  const drawnItems = new L.FeatureGroup();
  demandMap.addLayer(drawnItems);
  demandMap.addControl(
    new L.Control.Draw({
      draw: { polygon: { allowIntersection: false }, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false },
      edit: { featureGroup: drawnItems, remove: true, edit: false },
    }),
  );

  demandMap.on(L.Draw.Event.CREATED, (event) => {
    drawnItems.clearLayers();
    drawnItems.addLayer(event.layer);
    const polygon = event.layer.toGeoJSON();
    const selected = [];

    demandMap.eachLayer((layer) => {
      if (layer.hubName) {
        const ll = layer.getLatLng();
        const point = turf.point([ll.lng, ll.lat]);
        if (turf.booleanPointInPolygon(point, polygon)) selected.push(layer.hubName);
      }
    });

    state.selectedHubs = selected;
    showPolygonSpecificScenario(selected, normalizeScenarioName(scenarioSelect.value));
  });

  demandMap.on(L.Draw.Event.DELETED, () => {
    state.selectedHubs = [];
    redrawCurrentView();
  });
}

function resetStateForReload() {
  state.dates = [];
  state.dateObjects = [];
  state.scenarios = {};
  state.hubs = [];
  state.selectedHubs = [];
  state.lastView = { type: "none", hub: null };
}

function captureSelectedFiles() {
  selectedFilesByScenario = { Archipelagos: [], Surge: [], Horizon: [] };
  selectedTransportFile = null;

  [...(filePicker.files || [])].forEach((file) => {
    const scenario = inferScenarioFromName(file.name);
    if (scenario) selectedFilesByScenario[scenario].push(file);
    if (file.name.toLowerCase().includes("transport_rev") && file.name.toLowerCase().endsWith(".csv")) {
      selectedTransportFile = file;
    }
  });
}

function normalizedHeaderName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(header, aliases) {
  const normalizedAliases = aliases.map((a) => a.toLowerCase());
  return header.findIndex((h) => normalizedAliases.includes(h));
}

function parseTransportRows(rows) {
  const header = (rows[0] || []).map((h) => normalizedHeaderName(h));

  const fromIdx = findHeaderIndex(header, ["from", "origin", "source", "fromhub", "hubfrom", "start", "nodefrom"]);
  const toIdx = findHeaderIndex(header, ["to", "destination", "sink", "tohub", "hubto", "end", "nodeto"]);
  const capIdx = findHeaderIndex(header, ["capacity", "cap", "maxcapacity", "pipelinecapacity", "flowcapacity"]);
  const costIdx = findHeaderIndex(header, ["cost", "tariff", "price", "unitcost", "transportcost"]);

  if (fromIdx === -1 || toIdx === -1 || capIdx === -1 || costIdx === -1) {
    return [];
  }

  return rows
    .slice(1)
    .map((r) => ({
      from: String(r[fromIdx] ?? "").trim(),
      to: String(r[toIdx] ?? "").trim(),
      capacity: Number(r[capIdx] ?? 0),
      cost: Number(r[costIdx] ?? 0),
    }))
    .filter((x) => x.from && x.to && Number.isFinite(x.capacity));
}

function drawTransportHubMarkers(layer) {
  Object.entries(hubCoordinates).forEach(([name, coord]) => {
    L.circleMarker(coord, {
      radius: 4,
      color: "#1f2937",
      fillColor: "#f59e0b",
      fillOpacity: 0.9,
      weight: 1,
    })
      .addTo(layer)
      .bindTooltip(name);
  });
}

async function loadTransportData() {
  let rows = null;

  if (selectedTransportFile) {
    rows = await readRowsFromSource(selectedTransportFile);
  } else {
    const discoveredName = await discoverTransportFileName();
    const fallbackNames = discoveredName ? [discoveredName] : transportFileCandidates;

    for (const name of fallbackNames) {
      try {
        rows = await readRowsFromSource(name);
        break;
      } catch {
        // try next
      }
    }
  }

  if (transportLayerGroup) transportMap.removeLayer(transportLayerGroup);
  transportLayerGroup = L.layerGroup().addTo(transportMap);
  drawTransportHubMarkers(transportLayerGroup);

  if (!rows) return false;

  const flows = parseTransportRows(rows);
  if (!flows.length) return false;

  const maxCap = Math.max(...flows.map((f) => f.capacity), 1);

  flows.forEach((flow) => {
    const from = hubCoordinates[flow.from];
    const to = hubCoordinates[flow.to];
    if (!from || !to) return;

    const weight = 1 + 8 * (flow.capacity / maxCap);
    const line = L.polyline([from, to], {
      color: "#b45309",
      weight,
      opacity: 0.55,
    }).addTo(transportLayerGroup);

    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    L.marker(mid, {
      icon: L.divIcon({ className: "flow-cost-label", html: `${flow.cost}` }),
    }).addTo(transportLayerGroup);

    line.bindTooltip(`${flow.from} → ${flow.to}<br/>Capacity: ${flow.capacity}<br/>Cost: ${flow.cost}`);
  });

  return true;
}

async function loadAllData() {
  resetStateForReload();
  const loaded = [];
  const missing = [];

  const discovered = await discoverDemandFiles();
  const candidateMap = buildScenarioCandidates(discovered);

  for (const scenario of Object.keys(scenarioFileCandidates)) {
    try {
      const loadedFile = await loadWorkbookForScenario(scenario, candidateMap);
      loaded.push(`${scenario}: ${loadedFile}`);
    } catch {
      missing.push(scenario);
    }
  }

  if (loaded.length === 0) {
    fallbackData();
    const protocolHint =
      window.location.protocol === "file:"
        ? " Opened via file://. Use 'Load Selected Files' and pick all three demand scenario files together."
        : "";
    dataStatus.textContent = `Demand files could not be loaded.${protocolHint}`;
  } else {
    dataStatus.textContent = `Loaded ${loaded.join(" | ")}${missing.length ? ` | Missing: ${missing.join(", ")}` : ""}`;
  }

  rebuildDemandMarkers();
  redrawCurrentView();
  transportLoaded = await loadTransportData();
}

function switchPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(pageId).classList.remove("hidden");

  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });

  document.getElementById("controls-page-1").classList.toggle("hidden", pageId !== "page-1");
  document.getElementById("controls-page-2").classList.toggle("hidden", pageId !== "page-2");

  setTimeout(() => {
    if (pageId === "page-1") demandMap.invalidateSize();
    if (pageId === "page-2") {
      transportMap.invalidateSize();
      if (!transportLoaded) {
        dataStatus.textContent = `${dataStatus.textContent} | transport_rev.csv not found or has unexpected columns.`;
      }
    }
  }, 80);
}

initYearSelectors();
setupDemandPolygonSelection();

document.querySelectorAll('input[name="view-mode"]').forEach((input) => {
  input.addEventListener("change", () => redrawCurrentView());
});

scenarioSelect.addEventListener("change", () => redrawCurrentView());
startYearSelect.addEventListener("change", () => redrawCurrentView());
endYearSelect.addEventListener("change", () => redrawCurrentView());

reloadFilesBtn.addEventListener("click", async () => {
  captureSelectedFiles();
  await loadAllData();
});

document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});

loadAllData();
