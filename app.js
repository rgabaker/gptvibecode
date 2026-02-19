const WELL_COUNT = 1000;
const MONTH_COUNT = 24;

const stateClusters = [
  { code: "TX", weight: 0.48, lat: [26.5, 35.2], lon: [-106.4, -93.5] },
  { code: "LA", weight: 0.16, lat: [29.0, 33.1], lon: [-94.2, -88.8] },
  { code: "OK", weight: 0.14, lat: [33.7, 37.0], lon: [-103.0, -94.3] },
  { code: "NM", weight: 0.05, lat: [31.2, 36.9], lon: [-108.0, -103.0] },
  { code: "ND", weight: 0.05, lat: [46.0, 49.0], lon: [-104.1, -96.5] },
  { code: "PA", weight: 0.04, lat: [39.7, 42.4], lon: [-80.5, -74.6] },
  { code: "CO", weight: 0.04, lat: [37.0, 40.9], lon: [-109.0, -102.0] },
  { code: "WY", weight: 0.04, lat: [41.0, 44.9], lon: [-111.0, -104.0] },
];

const chartTitle = document.getElementById("chart-title");
const chartSubtitle = document.getElementById("chart-subtitle");

const map = L.map("map", {
  zoomControl: true,
}).setView([37.5, -96], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function weightedChoice(items) {
  const roll = Math.random();
  let running = 0;
  for (const item of items) {
    running += item.weight;
    if (roll <= running) {
      return item;
    }
  }
  return items[items.length - 1];
}

function syntheticProduction(wellType) {
  const start = wellType === "Oil" ? randomInRange(500, 1800) : randomInRange(900, 2600);
  const decline = randomInRange(0.018, 0.042);
  const seasonality = randomInRange(0.03, 0.09);

  return Array.from({ length: MONTH_COUNT }, (_, idx) => {
    const base = start * Math.exp(-decline * idx);
    const cyclical = 1 + seasonality * Math.sin((idx / 12) * Math.PI * 2);
    return Math.max(0, Math.round(base * cyclical));
  });
}

function buildWells() {
  return Array.from({ length: WELL_COUNT }, (_, idx) => {
    const cluster = weightedChoice(stateClusters);
    const wellType = Math.random() < 0.56 ? "Oil" : "Gas";

    return {
      id: `WELL-${String(idx + 1).padStart(4, "0")}`,
      state: cluster.code,
      type: wellType,
      lat: randomInRange(cluster.lat[0], cluster.lat[1]),
      lon: randomInRange(cluster.lon[0], cluster.lon[1]),
      production: syntheticProduction(wellType),
    };
  });
}

const wells = buildWells();

const monthLabels = Array.from({ length: MONTH_COUNT }, (_, idx) => {
  const date = new Date(2023, idx, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
});

const productionChart = new Chart(document.getElementById("production-chart"), {
  type: "line",
  data: {
    labels: monthLabels,
    datasets: [],
  },
  options: {
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
    },
    scales: {
      y: {
        beginAtZero: true,
        stacked: false,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
    },
  },
});

function updateChart({ title, subtitle, datasets, stacked = false, showLegend = false }) {
  chartTitle.textContent = title;
  chartSubtitle.textContent = subtitle;
  productionChart.options.scales.y.stacked = stacked;
  productionChart.options.plugins.legend.display = showLegend;
  productionChart.data.datasets = datasets;
  productionChart.update();
}

function markerColor(type) {
  return type === "Oil" ? "#dc2626" : "#16a34a";
}

function wellDataset(well, alpha = 0.35) {
  const color = markerColor(well.type);
  const rgba =
    well.type === "Oil"
      ? `rgba(220, 38, 38, ${alpha})`
      : `rgba(22, 163, 74, ${alpha})`;

  return {
    label: `${well.id} (${well.type})`,
    data: well.production,
    borderColor: color,
    backgroundColor: rgba,
    fill: true,
    tension: 0.2,
    pointRadius: 0,
    stack: "selected-wells",
    borderWidth: 1,
  };
}

const wellLayer = L.layerGroup().addTo(map);

wells.forEach((well) => {
  const marker = L.circleMarker([well.lat, well.lon], {
    radius: 5,
    color: markerColor(well.type),
    fillColor: markerColor(well.type),
    fillOpacity: 0.85,
    weight: 1,
  }).addTo(wellLayer);

  marker.bindTooltip(`${well.id} (${well.type}) • ${well.state}`);

  marker.on("click", () => {
    updateChart({
      title: `${well.id} (${well.type}) Production`,
      subtitle: `State: ${well.state}. Monthly synthetic production for last ${MONTH_COUNT} months.`,
      datasets: [
        {
          ...wellDataset(well, 0.25),
          label: "Production",
          stack: undefined,
        },
      ],
      stacked: false,
      showLegend: false,
    });
  });
});

const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

map.addControl(
  new L.Control.Draw({
    draw: {
      polygon: {
        allowIntersection: false,
      },
      polyline: false,
      rectangle: false,
      circle: false,
      marker: false,
      circlemarker: false,
    },
    edit: {
      featureGroup: drawnItems,
      remove: true,
      edit: false,
    },
  }),
);

function summarizePolygon(layer) {
  const polygon = layer.toGeoJSON();
  const selected = wells.filter((well) => {
    const point = turf.point([well.lon, well.lat]);
    return turf.booleanPointInPolygon(point, polygon);
  });

  const oilCount = selected.filter((well) => well.type === "Oil").length;
  const gasCount = selected.length - oilCount;

  if (selected.length === 0) {
    updateChart({
      title: "Selected Area Production (0 wells)",
      subtitle: "No wells inside polygon. Draw another selection.",
      datasets: [],
      stacked: false,
      showLegend: false,
    });
    return;
  }

  const datasets = selected.map((well) => wellDataset(well));

  updateChart({
    title: `Selected Area Production (${selected.length} wells)`,
    subtitle: `${oilCount} oil wells + ${gasCount} gas wells inside polygon (stacked area by well).`,
    datasets,
    stacked: true,
    showLegend: false,
  });
}

map.on(L.Draw.Event.CREATED, (event) => {
  drawnItems.clearLayers();
  drawnItems.addLayer(event.layer);
  summarizePolygon(event.layer);
});

map.on(L.Draw.Event.DELETED, () => {
  updateChart({
    title: "Click a well marker to view production history",
    subtitle: "Or draw a polygon on the map to see stacked area production by selected wells.",
    datasets: [],
    stacked: false,
    showLegend: false,
  });
});

updateChart({
  title: "Click a well marker to view production history",
  subtitle: "Or draw a polygon on the map to see stacked area production by selected wells.",
  datasets: [],
  stacked: false,
  showLegend: false,
});
