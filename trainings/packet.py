"""
packet.py - turns window data into the compact packet the model reads.

This is deterministic code. Production uses the same functions as training:
build the window-data dict (see build_dataset.py / simlib.py for the shape), then call build_packet().
Standard library only.
"""
import math
import re

from schema import UNTRUSTED_OPEN, UNTRUSTED_CLOSE

# ---------------------------------------------------------------- template extractor
_PATTERNS = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "<EMAIL>"),
    (re.compile(r"\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+"), "<TOKEN>"),
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "<CARD>"),
    (re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"), "<UUID>"),
    (re.compile(r"\b(?=[0-9a-fA-F]*\d)(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{8,}\b"), "<HEX>"),
    (re.compile(r"\d+(?:\.\d+)?"), "<NUM>"),
]


def extract_template(raw):
    """Drain-style template: replaces emails, tokens, card numbers, UUIDs, hex ids and numbers."""
    out = raw
    for pat, repl in _PATTERNS:
        out = pat.sub(repl, out)
    return re.sub(r"\s+", " ", out).strip()


# ---------------------------------------------------------------- small helpers
def _f(x, nd=1):
    if x is None:
        return "n/a"
    if abs(x) >= 1000:
        return f"{x:,.0f}".replace(",", "")
    return f"{x:.{nd}f}"


def _k(num, sess):
    return 1000.0 * num / sess if sess > 0 else 0.0


def _sum(sl, key):
    return sum(s[key] for s in sl)


def _pct_change(cur, base):
    if base is None or cur is None or base <= 0:
        return None
    return (cur - base) / base * 100.0


def _zscore(cur, base_vals):
    m = sum(base_vals) / len(base_vals)
    var = sum((x - m) ** 2 for x in base_vals) / len(base_vals)
    sd = max(math.sqrt(var), 0.1 * m, 0.05)
    return (cur - m) / sd


def _conv(sl):
    st = _sum(sl, "fstart")
    return 100.0 * _sum(sl, "fdone") / st if st >= 10 else None


def _lf(sl):
    a = _sum(sl, "lattempt")
    return 100.0 * _sum(sl, "lfail") / a if a >= 10 else None


def _wmean(sl, key):
    w = _sum(sl, "sessions")
    if w <= 0:
        return None
    return sum(s[key] * s["sessions"] for s in sl) / w


def _silent(sec):
    out = []
    for it in sec["items"]:
        if it["kind"] == "event" and it["role"] in ("fstart", "fdone", "lattempt", "lfail", "extra", "api"):
            if it["base"][-1] >= 5 and it["cur"][-1] == 0:
                out.append(extract_template(it["raws"][0]).split("=", 1)[-1].split(" ")[0])
    return out


# ---------------------------------------------------------------- detectors
def section_metrics(sec, planned, interval_min, source):
    cs, bs = sec["slices"], sec["base_slices"]
    win_min = interval_min * len(cs)
    m = {"source": source}
    m["sessions_cur"], m["sessions_base"] = _sum(cs, "sessions"), _sum(bs, "sessions")
    m["sessions_pct"] = _pct_change(m["sessions_cur"], m["sessions_base"])
    m["epm_cur"], m["epm_base"] = _sum(cs, "events") / win_min, _sum(bs, "events") / win_min
    m["epm_pct"] = _pct_change(m["epm_cur"], m["epm_base"])
    m["users_ratio"] = max(s["peak_users"] for s in cs) / planned
    m["users_ratio_base"] = max(s["peak_users"] for s in bs) / planned
    m["conv_cur"], m["conv_base"] = _conv(cs), _conv(bs)
    m["lf_cur"], m["lf_base"] = _lf(cs), _lf(bs)
    m["silent"] = _silent(sec)
    m["partial_last"] = bool(sec.get("partial_last"))
    # exceptions (PostHog $exception, or the GA4 exception event if configured)
    has_exc = source == "ph" or sec.get("ga4_exception")
    m["has_exc"] = bool(has_exc)
    m["exc_cur"] = _k(_sum(cs, "exc"), m["sessions_cur"]) if has_exc else None
    m["exc_base"] = _k(_sum(bs, "exc"), m["sessions_base"]) if has_exc else None
    if has_exc:
        base_k = [_k(s["exc"], s["sessions"]) for s in bs]
        m["z"] = _zscore(_k(cs[-1]["exc"], cs[-1]["sessions"]), base_k)
    else:
        m["z"] = None
    if source == "ph":
        hv = bool(sec.get("has_vitals"))
        m["has_vitals"] = hv
        for k in ("lcp", "inp", "cls"):
            m[k + "_cur"] = _wmean(cs, k) if hv else None
            m[k + "_base"] = _wmean(bs, k) if hv else None
        m["release"] = sec.get("release")
    else:
        m["eng_cur"] = None if _wmean(cs, "eng") is None else 100 * _wmean(cs, "eng")
        m["eng_base"] = None if _wmean(bs, "eng") is None else 100 * _wmean(bs, "eng")
        m["key_cur"] = _k(_sum(cs, "fdone"), m["sessions_cur"])
        m["key_base"] = _k(_sum(bs, "fdone"), m["sessions_base"])
    # suspicious slices (1-based): any detector clearly off in that slice
    susp = []
    for i in range(len(cs)):
        c, b = cs[i], bs[i]
        bad = False
        if has_exc and m["exc_base"] is not None:
            base_k = [_k(s["exc"], s["sessions"]) for s in bs]
            bad |= _zscore(_k(c["exc"], c["sessions"]), base_k) > 3
        if source == "ph" and sec.get("has_vitals") and b["lcp"] and c["lcp"] / b["lcp"] > 1.4:
            bad = True
        if c["fstart"] >= 10 and b["fstart"] >= 10 and (100 * c["fdone"] / c["fstart"]) - (100 * b["fdone"] / b["fstart"]) < -10:
            bad = True
        if c["lattempt"] >= 10 and b["lattempt"] >= 10 and (100 * c["lfail"] / c["lattempt"]) - (100 * b["lfail"] / b["lattempt"]) > 15:
            bad = True
        if b["events"] > 0 and abs(c["events"] / b["events"] - 1) > 1.0 and not (i == len(cs) - 1 and m["partial_last"]):
            bad = True
        if bad:
            susp.append(i + 1)
    m["suspicious"] = susp
    return m


def _detector_lines(m, sec, planned, interval_min):
    lines = []
    src = m["source"]
    win_min = interval_min * len(sec["slices"])
    if src == "ph":
        lines.append(f"- error_rate_zscore (last slice vs baseline slices): {_f(m['z'])}")
        lines.append(f"- exceptions_per_1000_sessions: {_f(m['exc_cur'])} (baseline {_f(m['exc_base'])})")
        if m["has_vitals"]:
            lines.append(f"- web_vitals_p75: LCP {_f(m['lcp_cur'], 0)} ms (baseline {_f(m['lcp_base'], 0)}, "
                         f"{_f(_pct_change(m['lcp_cur'], m['lcp_base']), 0)}%), INP {_f(m['inp_cur'], 0)} ms "
                         f"(baseline {_f(m['inp_base'], 0)}), CLS {_f(m['cls_cur'], 2)} (baseline {_f(m['cls_base'], 2)})")
        else:
            lines.append("- web_vitals_p75: n/a ($web_vitals not captured by this app)")
    else:
        if m["has_exc"]:
            lines.append(f"- ga4_exception_events_per_1000_sessions: {_f(m['exc_cur'])} (baseline {_f(m['exc_base'])})")
        else:
            lines.append("- ga4_exception_events_per_1000_sessions: n/a (GA4 exception event not configured)")
        lines.append(f"- engagementRate: {_f(m['eng_cur'])}% (baseline {_f(m['eng_base'])}%), "
                     f"bounceRate: {_f(100 - m['eng_cur']) if m['eng_cur'] is not None else 'n/a'}%")
        lines.append(f"- keyEvents_per_1000_sessions: {_f(m['key_cur'])} (baseline {_f(m['key_base'])})")
        lines.append(f"- sessions_change_vs_baseline: {_f(m['sessions_pct'], 0)}%")
        lines.append(f"- last_slice_partial: {'true (newest GA4 data is still being processed)' if m['partial_last'] else 'false'}")
    lines.append(f"- peak_active_users_vs_planned: {_f(100 * m['users_ratio'], 0)}% of {planned} planned "
                 f"(baseline {_f(100 * m['users_ratio_base'], 0)}%)")
    if m["conv_cur"] is not None and m["conv_base"] is not None:
        lines.append(f"- funnel_step_conversion: {_f(m['conv_cur'])}% (baseline {_f(m['conv_base'])}%, "
                     f"{_f(m['conv_cur'] - m['conv_base'])} pp)")
    else:
        lines.append("- funnel_step_conversion: n/a (funnel events not seen)")
    if m["lf_cur"] is not None and m["lf_base"] is not None:
        lines.append(f"- login_failure_rate: {_f(m['lf_cur'])}% (baseline {_f(m['lf_base'])}%)")
    else:
        lines.append("- login_failure_rate: n/a (login events not seen)")
    lines.append(f"- events_per_minute_change: {_f(m['epm_cur'], 2)}/min vs baseline {_f(m['epm_base'], 2)}/min "
                 f"({_f(m['epm_pct'], 0)}%)")
    # Names that come from the app are listed only inside the untrusted block, never here.
    lines.append(f"- silent_events_last_slice: {len(m['silent'])} event type(s)" +
                 (" (names listed in the untrusted block)" if m['silent'] else ""))
    if src == "ph":
        rel = m.get("release")
        if rel:
            lines.append(f"- new_release: yes, first seen in slice {rel['first_slice']}, "
                         f"share of pageviews in last slice {_f(100 * rel['share_last'], 0)}% "
                         f"(version strings listed in the untrusted block)")
        else:
            lines.append("- new_release: none seen in the last 24 hours")
    lines.append(f"- suspicious_slices: {', '.join(str(i) for i in m['suspicious']) if m['suspicious'] else 'none'}")
    return lines


def _trend_lines(sec, src, planned, interval_min):
    cs = sec["slices"]
    vals = lambda fn, nd=1: ", ".join(_f(fn(s), nd) for s in cs)
    lines = []
    if src == "ph" or sec.get("ga4_exception"):
        lines.append("- exceptions_per_1000_sessions: " + vals(lambda s: _k(s["exc"], s["sessions"])))
    if src == "ph" and sec.get("has_vitals"):
        lines.append("- lcp_p75_ms: " + vals(lambda s: s["lcp"], 0))
    if src == "ga4":
        lines.append("- engagementRate_pct: " + vals(lambda s: 100 * s["eng"]))
        lines.append("- keyEvents_per_1000_sessions: " + vals(lambda s: _k(s["fdone"], s["sessions"])))
    lines.append("- funnel_conversion_pct: " + ", ".join(
        _f(100 * s["fdone"] / s["fstart"]) if s["fstart"] >= 10 else "n/a" for s in cs))
    lines.append("- login_failure_pct: " + ", ".join(
        _f(100 * s["lfail"] / s["lattempt"]) if s["lattempt"] >= 10 else "n/a" for s in cs))
    lines.append("- events_per_minute: " + vals(lambda s: s["events"] / interval_min, 2))
    lines.append("- peak_active_users_pct_of_planned: " + vals(lambda s: 100 * s["peak_users"] / planned, 0))
    return lines


# ---------------------------------------------------------------- template ranking
def rank_items(items, k):
    scored = []
    for it in items:
        c, b = sum(it["cur"]), sum(it["base"])
        if it["kind"] == "webvital":
            cv = sum(it["value"]) / len(it["value"])
            bv = sum(it["base_value"]) / len(it["base_value"])
            score = abs(math.log(max(cv, 1e-6) / max(bv, 1e-6))) * 20 + 0.1
        else:
            ratio = (c + 1.0) / (b + 1.0)
            score = abs(math.log(ratio)) * min(math.sqrt(c + b), 20.0) + 0.15 * math.log1p(c)
        scored.append((-score, it["key"], it))
    scored.sort(key=lambda x: (x[0], x[1]))
    return [x[2] for x in scored[:k]]


def _is_suspicious(it):
    c, b = sum(it["cur"]), sum(it["base"])
    if it["kind"] == "webvital":
        return sum(it["value"]) / len(it["value"]) > 1.25 * sum(it["base_value"]) / len(it["base_value"])
    return it["kind"] == "exception" or b == 0 or (c + 1.0) / (b + 1.0) >= 1.8 or (c + 1.0) / (b + 1.0) <= 0.4


def build_packet(agg, k_single=10, k_both=7):
    """
    agg = {source, start, end, interval_min, freshness_min, planned_users, sections: {"ph":..., "ga":...}}
    Returns {"text", "templates", "metrics", "template_ids"}.
    """
    planned, interval = agg["planned_users"], agg["interval_min"]
    secs = [(s, agg["sections"][s]) for s in ("ph", "ga") if agg["sections"].get(s)]
    k = k_single if len(secs) == 1 else k_both
    src_name = {"ph": "posthog", "ga": "ga4"}
    nslices = len(secs[0][1]["slices"])
    head = [
        "MONITORING WINDOW",
        f"source: {agg['source']}",
        f"window: {agg['start']} to {agg['end']} ({nslices} slices x {interval} min)",
        f"data_freshness_minutes: {agg['freshness_min']}",
        f"planned_users: {planned}",
        "baseline: the same clock window on the previous day",
    ]
    metrics, det_blocks, templates, tn = {}, [], [], 0
    block_lines = []
    for key, sec in secs:
        m = section_metrics(sec, planned, interval, key if key == "ph" else "ga4")
        metrics[key] = m
        det_blocks.append(f"DETECTORS [{src_name[key]}]")
        det_blocks += _detector_lines(m, sec, planned, interval)
        det_blocks.append(f"TRENDS [{src_name[key]}] (oldest to newest, one value per {interval}-minute slice)")
        det_blocks += _trend_lines(sec, "ph" if key == "ph" else "ga4", planned, interval)
        if m["silent"]:
            block_lines.append(f"SILENT [{src_name[key]}] | " + ", ".join(m["silent"]))
        if key == "ph" and m.get("release"):
            block_lines.append(f"RELEASE | new={m['release']['new']} | previous={m['release']['old']}")
        for it in rank_items(sec["items"], k):
            tn += 1
            tid = f"T{tn}"
            text = extract_template(it["raws"][0])
            c, b = sum(it["cur"]), sum(it["base"])
            win = interval * nslices
            if it["kind"] == "webvital":
                cv = sum(it["value"]) / len(it["value"])
                bv = sum(it["base_value"]) / len(it["base_value"])
                nd = 2 if "CLS" in text else 0
                stats = f"p75={_f(cv, nd)} (baseline {_f(bv, nd)}) | count={c}"
            else:
                stats = f"count={c} (baseline {b}) | rate/min={c / win:.2f} (baseline {b / win:.2f})"
            line = f"{tid} | src={src_name[key]} | kind={it['kind']} | {text} | {stats}"
            if it.get("props"):
                line += " | " + " ".join(f"{pk}={pv}" for pk, pv in it["props"].items())
            block_lines.append(line)
            examples = []
            if _is_suspicious(it) and it["kind"] != "webvital":
                for raw in it["raws"][:2]:
                    block_lines.append(f'    e.g. "{raw}"')
                    examples.append(raw)
            templates.append({"id": tid, "src": src_name[key], "key": it["key"], "kind": it["kind"],
                              "text": text, "count": c, "base": b, "props": dict(it.get("props") or {}),
                              "examples": examples, "item": it})
    text = "\n".join(
        head + [""] + det_blocks + ["",
                                    "Templates are numbered. Use these IDs as evidence.",
                                    UNTRUSTED_OPEN] + block_lines + [UNTRUSTED_CLOSE])
    return {"text": text, "templates": templates, "metrics": metrics,
            "template_ids": [t["id"] for t in templates]}


USER_INSTRUCTION = "Analyze this monitoring window. Reply with the JSON verdict only.\n\n"


def user_message(packet_text):
    return USER_INSTRUCTION + packet_text
