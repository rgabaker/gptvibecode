const scenarioFileCandidates = {
  Archipelagos: ["Demand_Archipelagos.xlsx"],
  Surge: ["Demand_Surge.xlsx"],
  Horizon: ["Demand_Horizon.xlsx", "Demand_Horzion.xlsx"],
};

const scenarioColors = {
  Archipelagos: "#2563eb",
  Surge: "#ea580c",
  Horizon: "#7c3aed",
};

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
  Henry: [29.9480, -93.7890],
  LNG: [30.2266, -93.2174],
  AECO: [51.0447, -114.0719],
  Mexico: [25.6866, -100.3161],
};

const chartTitle = document.getElementById("chart-title");
const chartSubtitle = document.getElementById("chart-subtitle");
const dataStatus = document.getElementById("data-status");
const scenarioSelect = document.getElementById("scenario-select");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");

const map = L.map("map", { zoomControl: true }).setView([37.5, -96], 4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

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
  if (mdY) {
    return new Date(Number(mdY[3]), Number(mdY[1]) - 1, Number(mdY[2]));
  }

  return null;
}

function cleanDateForCentury(rawDate, rowIndex) {
  const d = new Date(rawDate.getTime());
  if (rowIndex >= 350 && d.getFullYear() < 2000) {
    d.setFullYear(d.getFullYear() + 100);
  }
  return d;
}

function formatIsoDate(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

function normalizeScenarioName(raw) {
  return raw === "Horzion" ? "Horizon" : raw;
}

function getViewMode() {
  return document.querySelector('input[name="view-mode"]:checked').value;
}

function normalizeDateInputs() {
  if (!startDateInput.value) startDateInput.value = "2000-01-01";
  if (!endDateInput.value) endDateInput.value = "2050-12-31";
  if (startDateInput.value > endDateInput.value) {
    endDateInput.value = startDateInput.value;
  }
}


function applyDateWindow(labels, datasets) {
  normalizeDateInputs();
  const start = new Date(startDateInput.value);
  const end = new Date(endDateInput.value);

  const idx = state.dateObjects
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d >= start && x.d <= end)
    .map((x) => x.i);

  const filteredLabels = idx.map((i) => labels[i]);
  const filteredDatasets = datasets.map((set) => ({
    ...set,
    data: idx.map((i) => set.data[i] ?? 0),
  }));

  return { filteredLabels, filteredDatasets };
}

function updateChart(title, subtitle, labels, datasets, stacked = false) {
  const { filteredLabels, filteredDatasets } = applyDateWindow(labels, datasets);

  chartTitle.textContent = title;
  chartSubtitle.textContent = subtitle;
  demandChart.data.labels = filteredLabels;
  demandChart.data.datasets = filteredDatasets;
  demandChart.options.scales.y.stacked = stacked;
  demandChart.update();
}

function scenarioSeriesForHub(hub, scenario) {
  return {
    label: `${scenario}`,
    data: state.scenarios[scenario]?.[hub] || [],
    borderColor: scenarioColors[scenario],
    backgroundColor: `${scenarioColors[scenario]}66`,
    fill: true,
    pointRadius: 0,
    tension: 0.2,
    borderWidth: 1.4,
  };
}

function showHubAllScenarios(hub) {
  const datasets = Object.keys(scenarioFileCandidates).map((scenario) => scenarioSeriesForHub(hub, scenario));
  state.lastView = { type: "hub", hub };

  updateChart(
    `Demand for ${hub}`,
    "All three scenarios for selected hub.",
    state.dates,
    datasets,
    false,
  );
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

  updateChart(
    `${scenario}: ${hubs.length} selected hub(s)`,
    "Stacked area by selected hubs for chosen scenario.",
    state.dates,
    datasets,
    true,
  );
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
  const hubColumns = headers
    .map((value, col) => ({ value: String(value ?? "").trim(), col }))
    .filter((entry) => entry.col !== dateCol && entry.value.length > 0);

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

async function loadWorkbookForScenario(scenario) {
  const candidates = scenarioFileCandidates[scenario];

  for (const fileName of candidates) {
    try {
      const response = await fetch(fileName);
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      parseWorkbookRows(rows, scenario);
      return fileName;
    } catch {
      // try next candidate
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

function buildHubMarkers() {
  const layer = L.layerGroup().addTo(map);

  state.hubs.forEach((hub) => {
    const coord = hubCoordinates[hub] || [37 + Math.random() * 8, -100 + Math.random() * 20];
    const marker = L.circleMarker(coord, {
      radius: 6,
      color: "#1d4ed8",
      fillColor: "#60a5fa",
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(layer);

    marker.hubName = hub;
    marker.bindTooltip(hub);

    marker.on("click", () => {
      if (getViewMode() === "hub-all-scenarios") {
        showHubAllScenarios(hub);
      } else {
        showPolygonSpecificScenario([hub], normalizeScenarioName(scenarioSelect.value));
      }
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

  updateChart(
    "Click a hub to view all scenarios",
    "Or draw a polygon to view stacked selected hubs for one scenario.",
    state.dates,
    [],
    false,
  );
}

function setupPolygonSelection() {
  const drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  map.addControl(
    new L.Control.Draw({
      draw: {
        polygon: { allowIntersection: false },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems, remove: true, edit: false },
    }),
  );

  map.on(L.Draw.Event.CREATED, (event) => {
    drawnItems.clearLayers();
    drawnItems.addLayer(event.layer);

    const polygon = event.layer.toGeoJSON();
    const selected = [];

    map.eachLayer((layer) => {
      if (layer.hubName) {
        const ll = layer.getLatLng();
        const point = turf.point([ll.lng, ll.lat]);
        if (turf.booleanPointInPolygon(point, polygon)) {
          selected.push(layer.hubName);
        }
      }
    });

    state.selectedHubs = selected;
    showPolygonSpecificScenario(selected, normalizeScenarioName(scenarioSelect.value));
  });

  map.on(L.Draw.Event.DELETED, () => {
    state.selectedHubs = [];
    redrawCurrentView();
  });
}

async function init() {
  const loaded = [];
  const missing = [];

  for (const scenario of Object.keys(scenarioFileCandidates)) {
    try {
      const loadedFile = await loadWorkbookForScenario(scenario);
      loaded.push(`${scenario}: ${loadedFile}`);
    } catch {
      missing.push(scenario);
    }
  }

  if (loaded.length === 0) {
    fallbackData();
    dataStatus.textContent = "Demand files not found in app folder. Showing fallback demo data.";
  } else {
    dataStatus.textContent = `Loaded ${loaded.join(" | ")}${missing.length ? ` | Missing: ${missing.join(", ")}` : ""}`;
  }

  buildHubMarkers();
  setupPolygonSelection();

  redrawCurrentView();
}

document.querySelectorAll('input[name="view-mode"]').forEach((input) => {
  input.addEventListener("change", () => redrawCurrentView());
});

scenarioSelect.addEventListener("change", () => redrawCurrentView());
startDateInput.addEventListener("change", () => redrawCurrentView());
endDateInput.addEventListener("change", () => redrawCurrentView());

init();
