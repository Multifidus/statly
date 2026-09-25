"""Factor-analysis building blocks for validity.efa (SPEC §8 "Validity"). Reference: fixtures/r/factor.R.

Everything here reproduces psych 2.6.5 / GPArotation 2026.8.2 / stats (R 4.6) in-house (factor_analyzer is
GPL and banned):
- `smc`, `kmo` (psych::KMO), `bartlett` (psych::cortest.bartlett).
- Extraction (psych::fa): `fit_minres` and `fit_ml` minimise psych's objectives over the uniquenesses in
  [.005, max(smc, 1)] with L-BFGS-B, from psych's start 1 - smc, to a much tighter tolerance than psych's
  optim default (so the two agree to ~1e-6). minres is solved as the full least-squares fit of the reduced
  matrix, whose exact gradient 2 diag(LL' + Psi - R) is psych's own minres gradient; its stationary points
  are psych's. `fit_pa` is psych's principal-axis loop verbatim (SMC start, stop when the communality sum
  changes by < .001 or after 50 iterations), so it matches psych to machine precision.
- Rotations, ported line by line so the iterates (and stopping points) are R's:
  GPArotation::GPFoblq (oblimin, gam = 0, "bb" step, fwindow 10, eps 1e-5), GPArotation::GPForth
  (Varimax), stats::varimax (Kaiser-normalized, eps 1e-5), psych::Promax via psych::kaiser (power 4).
- `orient` = psych's final step: each factor signed so its column sum is positive, factors sorted by
  SS loadings (diag(Phi L'L) when oblique).
- `parallel_analysis` = psych::fa.parallel(fa = "fa", fm = "minres", sim = TRUE, quant = .95) run
  sequentially (options(mc.cores = 1)) after set.seed(seed): per iteration the column resamples
  (sample(y, n, TRUE); redrawn while a correlation is NA) and then rnorm(n * p), drawn with R's RNG so the
  simulated eigenvalues are R's.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import optimize, special, stats

from statly_engine.stats.effect_sizes_rank import RRandom

EPS = np.finfo(float).eps
PSI_MIN = 0.005                   # psych: lower bound of the uniquenesses (Heywood floor)
HEYWOOD = 1 - PSI_MIN
_BIG = 134217728                  # R norm_rand (Inversion): 2^27


# ---------------------------------------------------------------------------
# Correlations and diagnostics
# ---------------------------------------------------------------------------
def pairwise_cor(x: np.ndarray) -> np.ndarray:
    """cor(x, use = "pairwise")."""
    return pd.DataFrame(x).corr().to_numpy()


def eigvals_desc(m: np.ndarray) -> np.ndarray:
    return np.linalg.eigvalsh((m + m.T) / 2)[::-1]


def eigh_desc(m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    w, v = np.linalg.eigh((m + m.T) / 2)
    return w[::-1], v[:, ::-1]


def smc(r: np.ndarray) -> np.ndarray:
    """psych::smc: 1 - 1 / diag(Pinv(R)), clipped to [0, 1]."""
    out = 1 - 1 / np.diag(np.linalg.pinv(r, rcond=math.sqrt(EPS), hermitian=True))
    return np.clip(out, 0.0, 1.0)


def kmo(r: np.ndarray) -> tuple[float, np.ndarray]:
    """psych::KMO: overall MSA and per-item MSA from the anti-image correlations."""
    try:
        q = np.linalg.inv(r)
    except np.linalg.LinAlgError:
        q = r.copy()
    d = 1 / np.sqrt(np.diag(q))
    img = q * np.outer(d, d)
    np.fill_diagonal(img, 0)
    r0 = r.copy()
    np.fill_diagonal(r0, 0)
    q2, r2 = (img ** 2), (r0 ** 2)
    return float(r2.sum() / (r2.sum() + q2.sum())), r2.sum(axis=0) / (r2.sum(axis=0) + q2.sum(axis=0))


def bartlett(r: np.ndarray, n: int) -> tuple[float, float, float]:
    """psych::cortest.bartlett(R, n): chi2 = -log|R| (n - 1 - (2p + 5) / 6), df = p(p - 1) / 2."""
    p = r.shape[0]
    sign, logdet = np.linalg.slogdet(r)
    chi2 = -logdet * (n - 1 - (2 * p + 5) / 6) if sign > 0 else math.inf
    df = p * (p - 1) / 2
    return float(chi2), float(df), float(stats.chi2.sf(chi2, df))


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
def _top(m: np.ndarray, nf: int) -> tuple[np.ndarray, np.ndarray]:
    w, v = eigh_desc(m)
    return w, v[:, :nf]


def _minres_loadings(psi: np.ndarray, r: np.ndarray, nf: int) -> np.ndarray:
    """psych FAout.wls: eigenvectors of R - diag(psi) scaled by sqrt(max(value, 0))."""
    s = r.copy()
    np.fill_diagonal(s, np.diag(r) - psi)
    w, v = _top(s, nf)
    return v * np.sqrt(np.maximum(w[:nf], 0))


def _ml_loadings(psi: np.ndarray, r: np.ndarray, nf: int) -> np.ndarray:
    """psych FAout (factanal's): from the eigen decomposition of Psi^-1/2 R Psi^-1/2."""
    sc = 1 / np.sqrt(psi)
    w, v = _top(r * np.outer(sc, sc), nf)
    return np.sqrt(psi)[:, None] * (v * np.sqrt(np.maximum(w[:nf] - 1, 0)))


def _minres_fg(psi: np.ndarray, r: np.ndarray, nf: int) -> tuple[float, np.ndarray]:
    s = r.copy()
    np.fill_diagonal(s, np.diag(r) - psi)
    w, v = eigh_desc(s)
    lam = v[:, :nf] * np.sqrt(np.maximum(w[:nf], 0))
    f = 0.5 * float(np.sum((s - lam @ lam.T) ** 2))
    g = np.sum(lam ** 2, axis=1) + psi - np.diag(r)
    return f, g


def _ml_fg(psi: np.ndarray, r: np.ndarray, nf: int) -> tuple[float, np.ndarray]:
    sc = 1 / np.sqrt(psi)
    w, v = eigh_desc(r * np.outer(sc, sc))
    e = w[nf:]
    f = -(float(np.sum(np.log(e) - e)) - nf + r.shape[0])
    load = np.sqrt(psi)[:, None] * (v[:, :nf] * np.sqrt(np.maximum(w[:nf] - 1, 0)))
    g = (np.sum(load ** 2, axis=1) + psi - np.diag(r)) / psi ** 2
    return f, g


def _optimise(fg, r: np.ndarray, nf: int) -> tuple[np.ndarray, bool]:
    s = smc(r)
    upper = max(float(s.max()), 1.0)
    start = np.clip(np.diag(r) - s, PSI_MIN, upper)
    res = optimize.minimize(fg, start, args=(r, nf), jac=True, method="L-BFGS-B",
                            bounds=[(PSI_MIN, upper)] * len(start),
                            options={"ftol": 1e-15, "gtol": 1e-11, "maxiter": 20000, "maxcor": 20})
    psi = res.x
    # Polish: L-BFGS-B can stop on ftol just short of the root of the gradient.
    for _ in range(3):
        f2 = optimize.minimize(fg, psi, args=(r, nf), jac=True, method="L-BFGS-B",
                               bounds=[(PSI_MIN, upper)] * len(start),
                               options={"ftol": 0, "gtol": 1e-13, "maxiter": 20000, "maxcor": 20})
        if np.max(np.abs(f2.x - psi)) < 1e-12:
            psi = f2.x
            break
        psi = f2.x
    g = fg(psi, r, nf)[1]
    free = (psi > PSI_MIN + 1e-9) & (psi < upper - 1e-9)
    converged = bool(res.success or not np.any(np.abs(g[free]) > 1e-6))
    return psi, converged


def fit_minres(r: np.ndarray, nf: int) -> dict:
    psi, ok = _optimise(_minres_fg, r, nf)
    return {"loadings": _minres_loadings(psi, r, nf), "psi": psi, "converged": ok}


def fit_ml(r: np.ndarray, nf: int) -> dict:
    psi, ok = _optimise(_ml_fg, r, nf)
    return {"loadings": _ml_loadings(psi, r, nf), "psi": psi, "converged": ok}


def fit_pa(r: np.ndarray, nf: int, min_err: float = 0.001, max_iter: int = 50) -> dict:
    """psych::fa(fm = "pa"): iterated principal axes from SMC communalities (psych's stopping rule)."""
    rm = r.copy()
    np.fill_diagonal(rm, smc(r))
    comm = float(np.trace(rm))
    lam = None
    it, converged = 1, True
    while True:
        w, v = _top(rm, nf)
        with np.errstate(invalid="ignore"):
            lam = v * np.sqrt(w[:nf])
        new = np.sum(lam ** 2, axis=1)
        comm1 = float(new.sum())
        np.fill_diagonal(rm, new)
        err = abs(comm - comm1)
        comm = comm1
        it += 1
        if not math.isfinite(err):
            converged = False
            break
        if it > max_iter:
            converged = err <= min_err
            break
        if err <= min_err:
            break
    # psych's $values for "pa" are the eigenvalues of the last reduced matrix factored (previous communalities).
    return {"loadings": lam, "psi": 1 - np.sum(lam ** 2, axis=1), "converged": converged, "iterations": it - 1,
            "values": w}


EXTRACTORS = {"minres": fit_minres, "ml": fit_ml, "pa": fit_pa}


def sign_unrotated(lam: np.ndarray) -> np.ndarray:
    """psych: before rotation each column is signed so its sum is positive."""
    s = np.sign(lam.sum(axis=0))
    s[s == 0] = 1
    return lam * s


# ---------------------------------------------------------------------------
# Rotations
# ---------------------------------------------------------------------------
def _vgq_oblimin(lam: np.ndarray) -> tuple[float, np.ndarray]:
    l2 = lam ** 2
    x = l2.sum(axis=1, keepdims=True) - l2
    return float(np.sum(l2 * x) / 4), lam * x


def _vgq_varimax(lam: np.ndarray) -> tuple[float, np.ndarray]:
    ql = lam ** 2 - (lam ** 2).mean(axis=0)
    return float(-np.sum(ql ** 2) / 4), -lam * ql


def _bb_alpha(alpha, t, t_prev, gp, gp_prev):
    if t_prev is None:
        return 2 * alpha
    dt, dgp = t - t_prev, gp - gp_prev
    if np.sum(dgp ** 2) > 0:
        return max(1e-10, min(float(np.sum(dt ** 2) / abs(np.sum(dt * dgp))), 20.0))
    return alpha


def gpf_oblq(a: np.ndarray, vgq=_vgq_oblimin, eps: float = 1e-5, maxit: int = 2000, fwindow: int = 10) -> dict:
    """GPArotation::GPFoblq (algorithm "bb")."""
    k = a.shape[1]
    t = np.eye(k)
    alpha, t_prev, gp_prev = 1.0, None, None
    tinv = np.linalg.inv(t)
    lam = a @ tinv.T
    f, gq = vgq(lam)
    g = -(lam.T @ gq @ tinv).T
    fs: list[float] = []
    s = math.inf
    for it in range(maxit + 1):
        gp = g - t @ np.diag(np.sum(t * g, axis=0))
        s = math.sqrt(float(np.sum(gp ** 2)))
        fs.append(f)
        if s < eps:
            break
        alpha = _bb_alpha(alpha, t, t_prev, gp, gp_prev)
        target = max(fs[max(0, it + 1 - fwindow):it + 1])
        for _ in range(11):
            x = t - alpha * gp
            tt = x / np.sqrt(np.sum(x ** 2, axis=0))
            ttinv = np.linalg.inv(tt)
            lam = a @ ttinv.T
            ft, gqt = vgq(lam)
            if target - ft > 0.5 * s ** 2 * alpha:
                break
            alpha /= 2
        t_prev, gp_prev, t, f = t, gp, tt, ft
        g = -(lam.T @ gqt @ ttinv).T
    return {"loadings": lam, "phi": t.T @ t, "converged": s < eps}


def gpf_orth(a: np.ndarray, vgq=_vgq_varimax, eps: float = 1e-5, maxit: int = 2000, fwindow: int = 10) -> dict:
    """GPArotation::GPForth (algorithm "bb")."""
    k = a.shape[1]
    t = np.eye(k)
    alpha, t_prev, gp_prev = 1.0, None, None
    lam = a @ t
    f, gq = vgq(lam)
    g = a.T @ gq
    fs: list[float] = []
    s = math.inf
    for it in range(maxit + 1):
        m = t.T @ g
        gp = g - t @ ((m + m.T) / 2)
        s = math.sqrt(float(np.sum(gp ** 2)))
        fs.append(f)
        if s < eps:
            break
        alpha = _bb_alpha(alpha, t, t_prev, gp, gp_prev)
        target = max(fs[max(0, it + 1 - fwindow):it + 1])
        for _ in range(11):
            u, _, vt = np.linalg.svd(t - alpha * gp)
            tt = u @ vt
            lam = a @ tt
            ft, gqt = vgq(lam)
            if target - ft > 0.5 * s ** 2 * alpha:
                break
            alpha /= 2
        t_prev, gp_prev, t, f = t, gp, tt, ft
        g = a.T @ gqt
    return {"loadings": lam, "th": t, "converged": s < eps}


def varimax(x: np.ndarray, eps: float = 1e-5) -> dict:
    """stats::varimax(normalize = TRUE)."""
    sc = np.sqrt(np.sum(x ** 2, axis=1))
    xn = x / sc[:, None]
    p, k = xn.shape
    tt = np.eye(k)
    d = 0.0
    converged = False
    for _ in range(1000):
        z = xn @ tt
        b = xn.T @ (z ** 3 - z @ np.diag(np.sum(z ** 2, axis=0)) / p)
        u, sv, vt = np.linalg.svd(b)
        tt = u @ vt
        dpast, d = d, float(np.sum(sv))
        if d < dpast * (1 + eps):
            converged = True
            break
    return {"loadings": (xn @ tt) * sc[:, None], "converged": converged}


def promax(x: np.ndarray, m: int = 4) -> dict:
    """psych::kaiser(x, rotate = "Promax"): row-normalize, psych::Promax (GPArotation::Varimax + power m)."""
    h = np.sqrt(np.sum(x ** 2, axis=1))
    w = x / h[:, None]
    vm = gpf_orth(w)
    xl = vm["loadings"]
    q = xl * np.abs(xl) ** (m - 1)
    u = np.linalg.lstsq(xl, q, rcond=None)[0]
    d = np.diag(np.linalg.inv(u.T @ u))
    u = u @ np.diag(np.sqrt(d))
    z = xl @ u
    ui = np.linalg.inv(vm["th"] @ u)
    return {"loadings": z * h[:, None], "phi": ui @ ui.T, "converged": vm["converged"]}


def rotate(lam: np.ndarray, method: str) -> dict:
    """Returns loadings, phi (None if orthogonal) and a convergence flag."""
    if lam.shape[1] < 2 or method == "none":
        return {"loadings": lam, "phi": None, "converged": True}
    if method == "oblimin":
        return gpf_oblq(lam)
    if method == "varimax":
        return {**varimax(lam), "phi": None}
    if method == "promax":
        return promax(lam)
    raise ValueError(method)


def orient(lam: np.ndarray, phi: np.ndarray | None) -> tuple[np.ndarray, np.ndarray | None]:
    """psych: sign each factor so its loadings sum positive, then sort by SS loadings."""
    s = np.sign(lam.sum(axis=0))
    s[s == 0] = 1
    lam = lam * s
    if phi is not None:
        phi = phi * np.outer(s, s)
    if lam.shape[1] > 1:
        ev = np.diag(phi @ lam.T @ lam) if phi is not None else np.sum(lam ** 2, axis=0)
        order = np.argsort(-ev, kind="stable")
        lam = lam[:, order]
        if phi is not None:
            phi = phi[np.ix_(order, order)]
    return lam, phi


def ss_loadings(lam: np.ndarray, phi: np.ndarray | None) -> np.ndarray:
    return np.diag(phi @ lam.T @ lam) if phi is not None else np.sum(lam ** 2, axis=0)


# ---------------------------------------------------------------------------
# Parallel analysis
# ---------------------------------------------------------------------------
def rnorm(rng: RRandom, n: int) -> np.ndarray:
    """R's rnorm(n) with the default Inversion normal generator (two uniforms per draw)."""
    u = rng.unif(2 * n).reshape(n, 2)
    return special.ndtri((np.floor(_BIG * u[:, 0]) + u[:, 1]) / _BIG)


def factor_values(r: np.ndarray, nf: int = 1) -> np.ndarray:
    """psych fa(r, nf, fm = "minres")$values: eigenvalues of R with the fitted communalities."""
    lam = fit_minres(r, nf)["loadings"]
    rr = r.copy()
    np.fill_diagonal(rr, np.sum(lam ** 2, axis=1))
    return eigvals_desc(rr)


def parallel_analysis(x: np.ndarray, iterations: int = 100, seed: int = 12345) -> dict:
    """psych::fa.parallel(fa = "fa", fm = "minres", n.iter, quant = .95), sequential, after set.seed(seed)."""
    n, p = x.shape
    rng = RRandom(seed)
    observed = factor_values(pairwise_cor(x))
    sims = np.empty((iterations, p))
    for it in range(iterations):
        while True:   # resampled data: only its RNG draws matter here (psych redraws while a correlation is NA)
            samp = np.column_stack([x[rng.index(n, n), j] for j in range(p)])
            with np.errstate(all="ignore"):
                if not np.isnan(pairwise_cor(samp)).any():
                    break
        z = rnorm(rng, n * p).reshape(p, n).T
        sims[it] = factor_values(np.corrcoef(z, rowvar=False))
    p95 = np.quantile(sims, 0.95, axis=0)
    below = np.flatnonzero(~(observed > p95))
    suggested = int(below[0]) if len(below) else None
    return {"observed": observed, "sim_mean": sims.mean(axis=0), "sim_p95": p95, "suggested": suggested,
            "iterations": iterations, "seed": seed}
