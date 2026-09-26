"""Charts from a stored factor-analysis result: scree plot (EFA) and CFA path diagram layout."""

from __future__ import annotations

import numpy as np

from statly_engine.charts.common import need, num


def scree(result: dict):
    need(result.get("analysis_id") == "validity.efa" and result.get("chart_data", {}).get("scree"),
         "A scree plot needs an exploratory factor analysis (EFA) from the Test Log.")
    rows = []
    for r in result["chart_data"]["scree"]:
        rows.append({"number": r["number"], "series": "Eigenvalues (correlation matrix)", "eigenvalue": num(r["eigenvalue"])})
        rows.append({"number": r["number"], "series": "Factor eigenvalues", "eigenvalue": num(r["factor_eigenvalue"])})
        rows.append({"number": r["number"], "series": "Parallel analysis (95th percentile)",
                     "eigenvalue": num(r["simulated_p95"])})
    series = ["Eigenvalues (correlation matrix)", "Factor eigenvalues", "Parallel analysis (95th percentile)"]
    n_factors = next((s["value"] for s in result.get("statistics", []) if s.get("key") == "n_factors"), None)
    return rows, {"levels": {"series": series}, "labels": {"x": "Factor number", "value": "Eigenvalue"},
                  "n_factors": n_factors}


def cfa_path(result: dict):
    """Layout: latent factors on top (y = 0), their indicators in a row below (y = 1), in model order.

    Rows: `node` (id, label, node_type, x, y, residual), `edge` loadings (x, y, x2, y2, weight, label
    position), and `curve` points (edge_id, order, x, y) for factor covariances drawn as arcs above.
    """
    need(result.get("analysis_id") == "validity.cfa" and result.get("chart_data", {}).get("path_diagram"),
         "A path diagram needs a confirmatory factor analysis (CFA) from the Test Log.")
    recs = result["chart_data"]["path_diagram"]
    nodes = [r for r in recs if r["kind"] == "node"]
    edges = [r for r in recs if r["kind"] == "edge"]
    latents = [n for n in nodes if n["node_type"] == "latent"]
    observed = {n["id"]: n for n in nodes if n["node_type"] == "observed"}
    order: list[str] = []
    owner: dict[str, str] = {}
    for f in latents:
        for e in edges:
            if e["edge_type"] == "loading" and e["from"] == f["id"] and e["to"] not in owner:
                owner[e["to"]] = f["id"]
                order.append(e["to"])
    order += [i for i in observed if i not in owner]
    pos: dict[str, tuple[float, float]] = {item: (float(i), 1.0) for i, item in enumerate(order)}
    for f in latents:
        xs = [pos[i][0] for i in order if owner.get(i) == f["id"]]
        pos[f["id"]] = (float(np.mean(xs)) if xs else 0.0, 0.0)
    rows = []
    for n in nodes:
        x, y = pos[n["id"]]
        rows.append({"kind": "node", "id": n["id"], "label": n["label"], "node_type": n["node_type"], "x": x, "y": y,
                     "residual": num(n.get("residual")),
                     "residual_label": None if n.get("residual") is None else f"{n['residual']:.2f}".replace("0.", ".", 1)})
    for k, e in enumerate(edges):
        (x1, y1), (x2, y2) = pos[e["from"]], pos[e["to"]]
        w = num(e["weight"])
        lab = None if w is None else (f"{w:.2f}".replace("0.", ".", 1) if abs(w) < 1 else f"{w:.2f}")
        eid = f"e{k}"
        if e["edge_type"] == "loading":
            rows.append({"kind": "edge", "id": eid, "from": e["from"], "to": e["to"], "edge_type": "loading",
                         "x": x1, "y": y1 + 0.12, "x2": x2, "y2": y2 - 0.1, "weight": w, "label": lab,
                         "label_x": x1 + 0.6 * (x2 - x1), "label_y": y1 + 0.6 * (y2 - y1), "p": num(e.get("p")),
                         "marker": bool(e.get("marker"))})
        else:
            # Arc above the factor row between the two latent factors.
            ts = np.linspace(0, 1, 21)
            h = 0.25 + 0.05 * abs(x2 - x1)
            for i, t in enumerate(ts):
                rows.append({"kind": "curve", "id": eid, "order": i, "x": float(x1 + (x2 - x1) * t),
                             "y": float(-0.12 - h * 4 * t * (1 - t))})
            rows.append({"kind": "edge", "id": eid, "from": e["from"], "to": e["to"], "edge_type": "covariance",
                         "weight": w, "label": lab, "label_x": (x1 + x2) / 2, "label_y": -0.12 - h - 0.06,
                         "p": num(e.get("p")), "marker": False})
    fit = {r["key"]: num(r["value"]) for r in result["chart_data"].get("fit_indices", [])}
    return rows, {"labels": {}, "fit": fit, "n_items": len(order), "n_factors": len(latents)}
