const scenarioFiles = {
  Archipelagos: "Demand_Archipelagos.xlsx",
  Surge: "Demand_Surge.xlsx",
  Horizon: "Demand_Horizon.xlsx",
};

const scenarioColors = {
  Archipelagos: "#2563eb",
  Surge: "#ea580c",
  Horizon: "#7c3aed",
};

const knownHubCoordinates = {
  "Henry Hub": [29.948, -93.789],
  "Waha Hub": [31.650, -103.250],
  "Katy Hub": [29.786, -95.823],
  "Agua Dulce": [27.783, -97.908],
  "Carthage Hub": [32.157, -94.337],
  "SoCal Citygate": [34.052, -118.244],
  "PG&E Citygate": [37.775, -122.419],
  "Chicago Citygate": [41.878, -87.630],
  "Dominion South": [40.300, -80.000],
  "Transco Zone 6": [40.713, -74.006],
};

const chartTitle = document.getElementById("chart-title");
const chartSubtitle = document.getElementById("chart-subtitle");
const dataStatus = document.getElementById("data-status");
const scenarioSelect = document.getElementById("scenario-select");

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
  },
});

const state = {
  dates: [],
  scenarios: {},
  hubs: [],
  selectedHubs: [],
  viewMode: "hub-all-scenarios",
};

function hashCoordinate(name, min, max) {
  const h = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return min + ((h % 1000) / 1000) * (max - min);
}

function normalizeScenarioName(raw) {
  return raw === "Horzion" ? "Horizon" : raw;
}

function updateChart(title, subtitle, labels, datasets, stacked = false) {
  chartTitle.textContent = title;
  chartSubtitle.textContent = subtitle;
  demandChart.data.labels = labels;
  demandChart.data.datasets = datasets;
  demandChart.options.scales.y.stacked = stacked;
  demandChart.update();
}

function getViewMode() {
  return document.querySelector('input[name="view-mode"]:checked').value;
}

function seriesForHubScenario(hub, scenario) {
  const values = state.scenarios[scenario]?.[hub] || [];
  return {
    label: `${hub} (${scenario})`,
    data: values,
    borderColor: scenarioColors[scenario],
    backgroundColor: `${scenarioColors[scenario]}55`,
    fill: true,
    pointRadius: 0,
    tension: 0.2,
  };
}

function showHubAllScenarios(hub) {
  const datasets = Object.keys(scenarioFiles).map((scenario) => seriesForHubScenario(hub, scenario));
  updateChart(
    `Demand for ${hub}`,
    "All scenarios for selected hub.",
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
  }));

  updateChart(
    `${scenario}: ${hubs.length} selected hub(s)`,
    "Stacked area by selected hubs for chosen scenario.",
    state.dates,
    datasets,
    true,
  );
}

async function loadWorkbook(fileName, scenario) {
  const response = await fetch(fileName);
  if (!response.ok) {
    throw new Error(`${fileName} not found`);
  }

  const buffer = await response.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const hubs = rows[0].slice(1).map((h) => String(h).trim());
  const dates = rows.slice(1).map((r) => String(r[0] ?? ""));

  if (state.dates.length === 0) {
    state.dates = dates;
    state.hubs = hubs;
  }

  state.scenarios[scenario] = {};
  hubs.forEach((hub, idx) => {
    state.scenarios[scenario][hub] = rows.slice(1).map((r) => Number(r[idx + 1] ?? 0));
  });
}

function fallbackData() {
  const hubs = ["Henry Hub", "Waha Hub", "Katy Hub", "Agua Dulce", "Carthage Hub"];
  state.hubs = hubs;
  state.dates = Array.from({ length: 24 }, (_, i) => new Date(2024, i, 1).toISOString().slice(0, 10));
  Object.keys(scenarioFiles).forEach((scenario, si) => {
    state.scenarios[scenario] = {};
    hubs.forEach((hub, hi) => {
      state.scenarios[scenario][hub] = state.dates.map((_, i) =>
        Math.round(120 + hi * 25 + si * 40 + 20 * Math.sin((i / 12) * Math.PI * 2)),
      );
    });
  });
}

function buildHubMarkers() {
  const layer = L.layerGroup().addTo(map);

  state.hubs.forEach((hub) => {
    const coord = knownHubCoordinates[hub] || [hashCoordinate(hub, 26, 48), hashCoordinate(hub, -123, -72)];
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

  return layer;
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
    const scenario = normalizeScenarioName(scenarioSelect.value);
    showPolygonSpecificScenario(selected, scenario);
  });

  map.on(L.Draw.Event.DELETED, () => {
    state.selectedHubs = [];
    updateChart(
      "Click a hub to view all scenarios",
      "Or draw a polygon to view stacked selected hubs for one scenario.",
      state.dates,
      [],
      false,
    );
  });
}

async function init() {
  const loadErrors = [];

  for (const [scenarioRaw, fileName] of Object.entries(scenarioFiles)) {
    const scenario = normalizeScenarioName(scenarioRaw);
    try {
      await loadWorkbook(fileName, scenario);
    } catch (err) {
      loadErrors.push(String(err.message));
    }
  }

  if (Object.keys(state.scenarios).length === 0) {
    fallbackData();
    dataStatus.textContent = "Demand files not found in this folder. Showing fallback demo data.";
  } else {
    dataStatus.textContent = loadErrors.length
      ? `Loaded available demand files. Missing: ${loadErrors.join("; ")}`
      : "Loaded demand files successfully.";
  }

  buildHubMarkers();
  setupPolygonSelection();

  updateChart(
    "Click a hub to view all scenarios",
    "Or draw a polygon to view stacked selected hubs for one scenario.",
    state.dates,
    [],
    false,
  );
}

document.querySelectorAll('input[name="view-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.viewMode = getViewMode();
  });
});

scenarioSelect.addEventListener("change", () => {
  if (state.selectedHubs.length) {
    showPolygonSpecificScenario(state.selectedHubs, normalizeScenarioName(scenarioSelect.value));
  }
});

init();
