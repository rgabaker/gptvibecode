from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, dcc, html

BASE = Path(__file__).parent

HUB_COORDS: Dict[str, Tuple[float, float]] = {
    "Algonquin": (42.3601, -71.0589),
    "Appalachia": (39.9526, -79.9959),
    "Chicago": (41.8781, -87.6298),
    "NBPL": (41.2565, -95.9345),
    "Opal": (41.4216, -110.8688),
    "Socal": (34.0522, -118.2437),
    "TGP": (36.1627, -86.7816),
    "Transco Z5": (28.5383, -81.3792),
    "Waha": (31.6504, -103.2502),
    "Henry": (29.9480, -93.7890),
    "LNG": (30.2266, -93.2174),
    "AECO": (51.0447, -114.0719),
    "Mexico": (25.6866, -100.3161),
}

SCENARIO_FILES = {
    "Archipelagos": ["demand_Archipelagos.csv", "Demand_Archipelagos.csv", "Demand_Archipelagos.xlsx"],
    "Surge": ["demand_Surge.csv", "Demand_Surge.csv", "Demand_Surge.xlsx"],
    "Horizon": ["demand_Horizon.csv", "Demand_Horizon.csv", "Demand_Horizon.xlsx", "Demand_Horzion.csv"],
}


def _read_table(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    return pd.read_excel(path)


def _normalize_date(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce")
    mask = (parsed.index + 2 >= 350) & (parsed.dt.year < 2000)
    parsed.loc[mask] = parsed.loc[mask] + pd.DateOffset(years=100)
    return parsed


def load_scenario_data() -> tuple[dict, list, pd.DatetimeIndex, str]:
    data = {}
    hubs = []
    dates = None
    msgs = []

    for scenario, candidates in SCENARIO_FILES.items():
        found = next((BASE / name for name in candidates if (BASE / name).exists()), None)
        if not found:
            msgs.append(f"Missing {scenario}")
            continue

        df = _read_table(found)
        date_col = next((c for c in df.columns if str(c).strip().lower() in {"date", "month", "gas_month"}), df.columns[0])
        parsed_dates = _normalize_date(df[date_col])
        keep = parsed_dates.dt.year.between(2000, 2050)
        df = df.loc[keep].copy()
        parsed_dates = parsed_dates.loc[keep]

        drop_cols = {str(date_col).lower(), "month", "gas_month"}
        hub_cols = [c for c in df.columns if str(c).strip() and str(c).strip().lower() not in drop_cols]

        if dates is None:
            dates = pd.DatetimeIndex(parsed_dates)
            hubs = [str(c).strip() for c in hub_cols]

        scenario_frame = pd.DataFrame(index=dates)
        for hub in hubs:
            match = next((c for c in hub_cols if str(c).strip() == hub), None)
            vals = pd.to_numeric(df[match], errors="coerce").fillna(0).to_numpy() if match is not None else np.zeros(len(dates))
            scenario_frame[hub] = vals

        data[scenario] = scenario_frame
        msgs.append(f"Loaded {scenario}: {found.name}")

    if not data:
        dates = pd.date_range("2000-01-01", "2050-01-01", freq="YS")
        hubs = list(HUB_COORDS.keys())
        for i, scenario in enumerate(SCENARIO_FILES):
            frame = pd.DataFrame(index=dates)
            for j, hub in enumerate(hubs):
                frame[hub] = 100 + i * 30 + j * 8 + 15 * np.sin(np.arange(len(dates)) / 3)
            data[scenario] = frame
        msgs = ["No demand files found in app folder; showing fallback data."]

    return data, hubs, dates, " | ".join(msgs)


def load_transport() -> tuple[pd.DataFrame, str]:
    candidates = ["transport_rev.csv", "Transport_rev.csv", "transport.csv"]
    found = next((BASE / c for c in candidates if (BASE / c).exists()), None)
    if not found:
        return pd.DataFrame(columns=["from", "to", "capacity", "cost"]), "transport_rev.csv missing"

    df = pd.read_csv(found)
    renamed = {c: str(c).strip().lower() for c in df.columns}
    df = df.rename(columns=renamed)

    def col(*names):
        for n in names:
            if n in df.columns:
                return n
        return None

    c_from = col("from", "origin", "source", "fromhub")
    c_to = col("to", "destination", "sink", "tohub")
    c_cap = col("capacity", "cap", "maxcapacity")
    c_cost = col("cost", "tariff", "price")

    if not all([c_from, c_to, c_cap, c_cost]):
        return pd.DataFrame(columns=["from", "to", "capacity", "cost"]), f"{found.name} has unexpected columns"

    out = pd.DataFrame(
        {
            "from": df[c_from].astype(str).str.strip(),
            "to": df[c_to].astype(str).str.strip(),
            "capacity": pd.to_numeric(df[c_cap], errors="coerce").fillna(0),
            "cost": pd.to_numeric(df[c_cost], errors="coerce").fillna(0),
        }
    )
    out = out[(out["from"] != "") & (out["to"] != "")]
    return out, f"Loaded transport: {found.name}"


SCENARIO_DATA, HUBS, DATES, STATUS = load_scenario_data()
TRANSPORT_DF, TRANSPORT_STATUS = load_transport()
YEARS = sorted(set(DATES.year))


app = Dash(__name__)
server = app.server


def demand_map_figure():
    lat = [HUB_COORDS.get(h, (37.0, -95.0))[0] for h in HUBS]
    lon = [HUB_COORDS.get(h, (37.0, -95.0))[1] for h in HUBS]
    fig = go.Figure(
        go.Scattergeo(
            lat=lat,
            lon=lon,
            mode="markers+text",
            text=HUBS,
            textposition="top center",
            marker={"size": 8, "color": "#2563eb"},
            customdata=HUBS,
        )
    )
    fig.update_geos(scope="north america", projection_type="albers usa")
    fig.update_layout(dragmode="lasso", margin=dict(l=0, r=0, t=20, b=0))
    return fig


def transport_figure():
    fig = go.Figure()
    for hub in HUBS:
        lat, lon = HUB_COORDS.get(hub, (37.0, -95.0))
        fig.add_trace(go.Scattergeo(lat=[lat], lon=[lon], mode="markers+text", text=[hub], textposition="top center", marker={"size": 7}))

    if not TRANSPORT_DF.empty:
        max_cap = max(TRANSPORT_DF["capacity"].max(), 1)
        for _, r in TRANSPORT_DF.iterrows():
            if r["from"] not in HUB_COORDS or r["to"] not in HUB_COORDS:
                continue
            f_lat, f_lon = HUB_COORDS[r["from"]]
            t_lat, t_lon = HUB_COORDS[r["to"]]
            width = 1 + 7 * (float(r["capacity"]) / max_cap)
            fig.add_trace(
                go.Scattergeo(
                    lat=[f_lat, t_lat],
                    lon=[f_lon, t_lon],
                    mode="lines",
                    line={"width": width, "color": "#b45309"},
                    opacity=0.6,
                    hovertemplate=f"{r['from']} → {r['to']}<br>Capacity: {r['capacity']}<br>Cost: {r['cost']}<extra></extra>",
                    showlegend=False,
                )
            )
            mlat, mlon = (f_lat + t_lat) / 2, (f_lon + t_lon) / 2
            fig.add_trace(go.Scattergeo(lat=[mlat], lon=[mlon], mode="text", text=[f"{r['cost']:.2f}"], showlegend=False))

    fig.update_geos(scope="north america", projection_type="albers usa")
    fig.update_layout(margin=dict(l=0, r=0, t=20, b=0), title=TRANSPORT_STATUS)
    return fig


app.layout = html.Div(
    [
        html.H2("Hub Demand by Scenario"),
        dcc.Tabs(
            [
                dcc.Tab(
                    label="Page 1: Hub Demand by Scenario",
                    children=[
                        html.Div(
                            [
                                html.Label("View Mode"),
                                dcc.RadioItems(
                                    id="view-mode",
                                    options=[
                                        {"label": "View all scenarios for clicked hub", "value": "hub"},
                                        {"label": "View hubs selected on map for one scenario", "value": "poly"},
                                    ],
                                    value="hub",
                                ),
                                html.Label("Scenario"),
                                dcc.Dropdown(list(SCENARIO_FILES.keys()), "Archipelagos", id="scenario"),
                                html.Label("Start year"),
                                dcc.Dropdown(YEARS, YEARS[0], id="start-year"),
                                html.Label("End year"),
                                dcc.Dropdown(YEARS, YEARS[-1], id="end-year"),
                                html.Div("All Scenarios must be loaded at the same time.", style={"marginTop": "8px", "padding": "8px", "border": "1px solid #f59e0b", "background": "#fef3c7"}),
                                html.Div(STATUS, id="status", style={"marginTop": "8px", "fontSize": "12px"}),
                            ],
                            style={"width": "28%", "display": "inline-block", "verticalAlign": "top", "padding": "8px"},
                        ),
                        html.Div(
                            [
                                dcc.Graph(id="hub-map", figure=demand_map_figure(), style={"height": "45vh"}),
                                dcc.Graph(id="hub-chart", style={"height": "45vh"}),
                            ],
                            style={"width": "71%", "display": "inline-block", "padding": "8px"},
                        ),
                    ],
                ),
                dcc.Tab(
                    label="Page 2: Transport Network",
                    children=[dcc.Graph(id="transport-map", figure=transport_figure(), style={"height": "88vh"})],
                ),
            ]
        ),
    ]
)


@app.callback(
    Output("hub-chart", "figure"),
    Input("hub-map", "clickData"),
    Input("hub-map", "selectedData"),
    Input("view-mode", "value"),
    Input("scenario", "value"),
    Input("start-year", "value"),
    Input("end-year", "value"),
)
def update_chart(click_data, selected_data, view_mode, scenario, start_year, end_year):
    start_year = int(start_year)
    end_year = int(end_year)
    if start_year > end_year:
        end_year = start_year

    idx = (DATES.year >= start_year) & (DATES.year <= end_year)
    x = DATES[idx]

    fig = go.Figure()

    if view_mode == "hub":
        hub = click_data["points"][0]["customdata"] if click_data and click_data.get("points") else HUBS[0]
        for scen in SCENARIO_FILES.keys():
            color = scenarioColors[scen]
            y = SCENARIO_DATA[scen][hub][idx]
            fig.add_trace(go.Scatter(x=x, y=y, mode="lines", name=scen, line={"color": color, "width": 2}))
        fig.update_layout(title=f"Demand for {hub} (line chart)", xaxis_title="Year", yaxis_title="Demand")
    else:
        hubs = [p["customdata"] for p in (selected_data or {}).get("points", []) if p.get("customdata") in HUBS]
        hubs = hubs or HUBS[:3]
        for hub in hubs:
            y = SCENARIO_DATA[scenario][hub][idx]
            fig.add_trace(go.Scatter(x=x, y=y, mode="lines", stackgroup="one", name=hub, line={"width": 1}))
        fig.update_layout(title=f"{scenario}: selected hubs (stacked)", xaxis_title="Year", yaxis_title="Demand")

    return fig


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8050)
