"""
simlib.py - small simulator of a production app seen through PostHog and GA4.

A Sim holds a 3-day timeline in 5-minute steps: traffic with a daily curve and noise,
background items (pageviews, custom events, benign exceptions, segments, web vitals).
Families (families.py) inject faults or look-alikes at a known step. Then window_agg()
cuts a window and returns the neutral window-data dict that packet.build_packet() reads.

Standard library only. Deterministic for a given random.Random.
"""
import hashlib
import math
import random
from datetime import datetime, timedelta, timezone

STEP_MIN = 5
SPD = 288                     # steps per day
N_STEPS = SPD * 3
SLICES = 6                    # slices per window
ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


# ---------------------------------------------------------------- math helpers
def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def lin(t, a, b, v0, v1):
    """Linear ramp from v0 at step a to v1 at step b (flat outside)."""
    if b <= a:
        return v1 if t >= a else v0
    return v0 + (v1 - v0) * clamp((t - a) / float(b - a), 0.0, 1.0)


def geo(t, a, b, v0, v1):
    """Geometric ramp (good for rates that grow by a factor)."""
    v0, v1 = max(v0, 1e-9), max(v1, 1e-9)
    if b <= a:
        return v1 if t >= a else v0
    return v0 * (v1 / v0) ** clamp((t - a) / float(b - a), 0.0, 1.0)


def pois(rng, mean):
    if mean <= 0:
        return 0
    if mean < 40:
        lim, k, p = math.exp(-mean), 0, 1.0
        while True:
            p *= rng.random()
            if p <= lim:
                return k
            k += 1
    return max(0, int(round(rng.gauss(mean, math.sqrt(mean)))))


def diurnal(h):
    """Daily traffic curve: minimum near 03:00, peak near 15:00 (local time)."""
    x = 0.5 - 0.5 * math.cos(2 * math.pi * (h - 3.0) / 24.0)
    return 0.10 + 0.90 * x ** 1.4


def fill(fmt, rng):
    """Fills placeholders with fake values. Only fake data: example.com, sk_test_FAKE..., test card numbers."""
    out = fmt
    while "{n}" in out:
        out = out.replace("{n}", str(rng.randint(10, 99999)), 1)
    while "{em}" in out:
        out = out.replace("{em}", f"user{rng.randint(100, 9999)}@example.com", 1)
    while "{tok}" in out:
        out = out.replace("{tok}", "sk_test_FAKE" + "".join(rng.choice(ALNUM) for _ in range(12)), 1)
    while "{card}" in out:
        out = out.replace("{card}", rng.choice(["4242 4242 4242 4242", "4000 0566 5566 5556", "5555 5555 5555 4444"]), 1)
    return out


# ---------------------------------------------------------------- app profiles
APPS = {
    "shop": dict(
        friendly="checkout", key_page="/checkout/payment", vendor="payments-gateway",
        pages=[("/", 3.0), ("/products", 3.0), ("/product/{n}", 9.0), ("/cart", 2.0), ("/checkout", 1.2),
               ("/checkout/payment", 1.0), ("/order/{n}/confirmation", 0.6), ("/search?q=shoes", 1.5)],
        funnel=("checkout_started", "order_completed", "checkout_failed"),
        comps=["CartSummary", "PriceTag", "PaymentForm", "ProductGrid"],
        extras=["add_to_cart", "search_performed", "wishlist_added"]),
    "saas": dict(
        friendly="sign-up", key_page="/signup", vendor="email-provider",
        pages=[("/", 3.0), ("/pricing", 3.0), ("/signup", 1.5), ("/app/dashboard", 9.0), ("/app/reports/{n}", 4.0),
               ("/app/settings", 1.5), ("/docs/getting-started", 2.0)],
        funnel=("signup_started", "signup_completed", "signup_failed"),
        comps=["SignupForm", "PlanPicker", "ReportTable", "Sidebar"],
        extras=["report_exported", "invite_sent", "feature_flag_viewed"]),
    "booking": dict(
        friendly="booking", key_page="/book/payment", vendor="payments-gateway",
        pages=[("/", 3.0), ("/rooms", 4.0), ("/rooms/{n}", 8.0), ("/book", 2.0), ("/book/payment", 1.0),
               ("/book/confirmed", 0.7), ("/search?city=penang", 2.0)],
        funnel=("booking_started", "booking_confirmed", "booking_failed"),
        comps=["DatePicker", "RoomCard", "PaymentForm", "PriceSummary"],
        extras=["booking_searched", "room_viewed", "wishlist_added"]),
    "media": dict(
        friendly="subscription", key_page="/subscribe", vendor="ad-network",
        pages=[("/", 3.0), ("/news/{n}", 12.0), ("/topics/{n}", 3.0), ("/subscribe", 1.0), ("/account", 1.0),
               ("/search?q=election", 1.5)],
        funnel=("subscribe_clicked", "subscription_started", "paywall_error"),
        comps=["ArticleBody", "PaywallBanner", "VideoPlayer", "CommentBox"],
        extras=["article_shared", "newsletter_opened", "search_performed"]),
    "fintech": dict(
        friendly="transfer", key_page="/transfer/confirm", vendor="kyc-provider",
        pages=[("/", 2.0), ("/dashboard", 9.0), ("/transfer", 3.0), ("/transfer/confirm", 1.2),
               ("/statements", 2.0), ("/beneficiaries", 1.5)],
        funnel=("transfer_started", "transfer_completed", "transfer_failed"),
        comps=["TransferForm", "BalanceCard", "BeneficiaryList", "OtpInput"],
        extras=["beneficiary_added", "statement_downloaded", "search_performed"]),
}

BENIGN_EXC = [
    "Error: ResizeObserver loop completed with undelivered notifications. @ ResizeObserver.callback (vendor.js:{n})",
    "ChunkLoadError: Loading chunk {n} failed. @ __webpack_require__.e (runtime.js:{n})",
    "TypeError: Failed to fetch @ fetchJson (api.js:{n})",
    "NotAllowedError: play() failed because the user didn't interact with the document first. @ MediaPlayer.start (player.js:{n})",
    "Error: Non-Error promise rejection captured with value: undefined @ onUnhandledRejection (monitor.js:{n})",
]
NEW_EXC = [
    "TypeError: Cannot read properties of undefined (reading 'price') @ {comp} (app.js:{n})",
    "TypeError: Cannot read properties of null (reading 'items') @ {comp} (app.js:{n})",
    "RangeError: Invalid array length @ {comp} (app.js:{n})",
    "ReferenceError: formatCurrency is not defined @ {comp} (app.js:{n})",
    "SyntaxError: Unexpected token '<' in JSON at position {n} @ parseResponse (api.js:{n})",
]
COUNTRIES = ["MY", "SG", "ID", "US", "TH", "IN", "GB", "AU", "PH", "VN"]
SOURCES = [("google.com", "google"), ("direct", "(direct)"), ("facebook.com", "facebook"),
           ("newsletter", "newsletter"), ("bing.com", "bing"), ("instagram.com", "instagram")]
DEVICES = [("Mobile", "mobile", 0.6), ("Desktop", "desktop", 0.34), ("Tablet", "tablet", 0.06)]
VITAL_NAMES = ("LCP", "INP", "CLS", "FCP")


class Item:
    def __init__(self, key, kind, role, ph, ga, rate, props=None, n=N_STEPS):
        self.key, self.kind, self.role = key, kind, role
        self.ph, self.ga = ph, ga                  # raw format strings; None = not visible in that source
        self.props = props or {}
        self.rate = [float(rate)] * n              # per 1,000 sessions
        self.counts = None


class Sim:
    def __init__(self, rng, app, planned, tz_h, start_date, flags):
        self.rng, self.app, self.P, self.planned, self.tz = rng, app, APPS[app], planned, tz_h
        self.flags = flags
        self.n = N_STEPS
        self.start = datetime(start_date[0], start_date[1], start_date[2], tzinfo=timezone(timedelta(hours=tz_h)))
        small = planned < 300
        self.peak_frac = rng.uniform(0.05, 0.18) * (1.6 if small else 1.0)
        self.dm = [1.0, rng.uniform(0.94, 1.06), rng.uniform(0.94, 1.06)]
        self.spu = rng.uniform(1.05, 1.3)
        self.tm = [1.0] * self.n
        self.rho_fn = None
        self.ebase = rng.uniform(0.55, 0.72)
        self.emult = [1.0] * self.n
        self.vbase = {"LCP": rng.uniform(1700, 2400), "INP": rng.uniform(110, 190),
                      "CLS": rng.uniform(0.03, 0.08), "FCP": rng.uniform(1000, 1600)}
        self.vm = {m: [1.0] * self.n for m in VITAL_NAMES}
        self.items = {}
        self.rel_old = f"{rng.randint(1, 4)}.{rng.randint(0, 9)}.{rng.randint(0, 9)}"
        a, b, c = self.rel_old.split(".")
        self.rel_new = f"{a}.{int(b) + 1}.0" if rng.random() < 0.4 else f"{a}.{b}.{int(c) + 1}"
        self.rel_t = None
        self.rel_share = [0.0] * self.n
        self._base()

    # ------------------------------------------------------------ building blocks
    def add(self, item):
        self.items[item.key] = item
        return item

    def ts(self, t):
        return (self.start + timedelta(minutes=STEP_MIN * t)).isoformat(timespec="minutes")

    def local_hour(self, t):
        return (t % SPD) * STEP_MIN / 60.0

    def mul_rate(self, key, fn):
        arr = self.items[key].rate
        for t in range(self.n):
            arr[t] *= fn(t)

    def set_rate(self, key, fn):
        arr = self.items[key].rate
        for t in range(self.n):
            arr[t] = fn(t)

    def mul_traffic(self, fn):
        for t in range(self.n):
            self.tm[t] *= fn(t)

    def mul_v(self, name, fn):
        for t in range(self.n):
            self.vm[name][t] *= fn(t)

    def mul_eng(self, fn):
        for t in range(self.n):
            self.emult[t] *= fn(t)

    def deploy(self, t0):
        """A new release starts rolling out at step t0 (full rollout after about 1 hour)."""
        self.rel_t = t0
        self.rel_share = [lin(t, t0, t0 + 12, 0.0, 1.0) for t in range(self.n)]

    def new_exception(self, key, comp, rate0, props=None, ga=True, text=None):
        fmt = (text or self.rng.choice(NEW_EXC)).replace("{comp}", comp)
        fp = "fp_" + hashlib.md5(key.encode()).hexdigest()[:8]
        pr = {"release": self.rel_old, "fingerprint": fp}
        pr.update(props or {})
        desc = fmt.split(" @ ")[0]
        return self.add(Item(key, "exception", "exc", fmt, desc if (ga and self.flags["ga4_exc"]) else None, rate0, pr))

    # ------------------------------------------------------------ base timeline
    def _base(self):
        rng, P, fl = self.rng, self.P, self.flags
        pw = sum(w for _, w in P["pages"])
        pvs = rng.uniform(3.5, 6.0)
        for path, w in P["pages"]:
            self.add(Item("pv:" + path, "pageview", "pv", "$pageview $pathname=" + path, "ga4 pagePath=" + path,
                          1000 * pvs * w / pw))
        start, done, fail = P["funnel"]
        self.conv = rng.uniform(0.5, 0.72)
        rs = rng.uniform(50, 90)
        self.add(Item("ev:" + start, "event", "fstart", f"event={start}", f"ga4 eventName={start}", rs))
        self.add(Item("ev:" + done, "event", "fdone", f"event={done}", f"ga4 eventName={done}", rs * self.conv))
        if fl["has_fail"]:
            self.add(Item("ev:" + fail, "event", "ffail", f"event={fail}", f"ga4 eventName={fail}", rs * rng.uniform(0.01, 0.03)))
        if fl["has_login"]:
            ra = rng.uniform(100, 220)
            self.add(Item("ev:login_attempt", "event", "lattempt", "event=login_attempt", "ga4 eventName=login_attempt", ra))
            self.add(Item("ev:login_failed", "event", "lfail", "event=login_failed", "ga4 eventName=login_failed",
                          ra * rng.uniform(0.04, 0.08)))
        for name in rng.sample(P["extras"], 2):
            self.add(Item("ev:" + name, "event", "extra", f"event={name}", f"ga4 eventName={name}", rng.uniform(80, 300)))
        if fl["has_api"]:
            self.add(Item("ev:api_internal", "event", "api", "event=api_error vendor=internal-api status=error",
                          "ga4 eventName=api_error", rng.uniform(0.3, 0.9)))
            self.add(Item("ev:api_vendor", "event", "api", f"event=api_error vendor={P['vendor']} status=timeout",
                          None, rng.uniform(0.1, 0.4)))
        self.add(Item("ev:noise", "event", "noise", "event=$autocapture", "ga4 eventName=user_engagement",
                      rng.uniform(2200, 3500)))
        for i, fmt in enumerate(rng.sample(BENIGN_EXC, 3)):
            fp = "fp_" + hashlib.md5(fmt.encode()).hexdigest()[:8]
            desc = fmt.split(" @ ")[0]
            self.add(Item(f"exc:benign{i}", "exception", "exc", fmt, desc if fl["ga4_exc"] else None,
                          rng.uniform(0.3, 2.0), {"release": self.rel_old, "fingerprint": fp}))
        cs = rng.sample(COUNTRIES, 4)
        w = [rng.uniform(0.5, 2.0) for _ in cs]
        for c, x in zip(cs, w):
            self.add(Item("seg:country:" + c, "segment", "seg", f"breakdown $geoip_country_code={c}",
                          f"ga4 country={c}", 1000 * x / sum(w)))
        ss = rng.sample(SOURCES, 4)
        w = [rng.uniform(0.4, 2.0) for _ in ss]
        for (pv, gv), x in zip(ss, w):
            self.add(Item("seg:source:" + gv, "segment", "seg", f"breakdown $referrer={pv}",
                          f"ga4 sessionSource={gv}", 1000 * x / sum(w)))
        for pv, gv, share in DEVICES:
            self.add(Item("seg:device:" + gv, "segment", "seg", f"breakdown $device_type={pv}",
                          f"ga4 deviceCategory={gv}", 1000 * share * rng.uniform(0.85, 1.15)))
        if fl["has_vitals"]:
            for m in VITAL_NAMES:
                self.add(Item("wv:" + m, "webvital", "wv", f"$web_vitals metric={m}", None, 450))

    # ------------------------------------------------------------ finalize
    def finalize(self):
        rng, n = self.rng, self.n
        self.users, self.sess = [0] * n, [0] * n
        for t in range(n):
            if self.rho_fn:
                rho = self.rho_fn(t)
            else:
                rho = self.peak_frac * diurnal(self.local_hour(t)) * self.dm[t // SPD] * self.tm[t]
            u = max(0.0, self.planned * rho * rng.gauss(1.0, 0.04))
            self.users[t] = int(round(u))
            self.sess[t] = int(round(u * self.spu))
        for it in self.items.values():
            it.counts = [pois(rng, self.sess[t] / 1000.0 * it.rate[t]) for t in range(n)]
        self.vval = {m: [self.vbase[m] * self.vm[m][t] * rng.gauss(1.0, 0.03) for t in range(n)] for m in VITAL_NAMES}
        self.eng = [clamp(self.ebase * self.emult[t] * rng.gauss(1.0, 0.02), 0.01, 0.98) for t in range(n)]
        return self

    # ------------------------------------------------------------ probes used by checks
    def rate_avg(self, key, t0, t1):
        s = sum(self.sess[t0:t1])
        return 1000.0 * sum(self.items[key].counts[t0:t1]) / s if s > 0 else 0.0

    def vital_avg(self, name, t0, t1):
        v = self.vval[name][t0:t1]
        return sum(v) / len(v)

    def users_ratio(self, t0, t1):
        return max(self.users[t0:t1]) / float(self.planned)

    def conv_avg(self, t0, t1):
        st = sum(it.counts[t] for it in self.items.values() if it.role == "fstart" for t in range(t0, t1))
        dn = sum(it.counts[t] for it in self.items.values() if it.role == "fdone" for t in range(t0, t1))
        return dn / st if st > 0 else None

    def events_per_step(self, t0, t1):
        return sum(it.counts[t] for it in self.items.values() if it.kind in ("pageview", "event", "exception")
                   for t in range(t0, t1)) / float(max(1, t1 - t0))

    # ------------------------------------------------------------ window cut
    def window_agg(self, source, e, L, freshness, partial, tag):
        """Returns the window-data dict that packet.build_packet() reads."""
        s = e - SLICES * L
        sections = {}
        want = {"posthog": ["ph"], "ga4": ["ga"], "both": ["ph", "ga"]}[source]
        for key in want:
            sections[key] = self._section(key, e, L, partial and key == "ga", tag)
        return {"source": {"posthog": "posthog", "ga4": "ga4", "both": "posthog+ga4"}[source],
                "start": self.ts(s), "end": self.ts(e), "interval_min": L * STEP_MIN,
                "freshness_min": freshness, "planned_users": self.planned, "sections": sections}

    def _section(self, key, e, L, partial, tag):
        vis = [it for it in self.items.values() if (it.ph if key == "ph" else it.ga)]
        scale = self.rng.uniform(0.35, 0.75) if partial else 1.0

        def mk(t0, t1, sc):
            d = {"sessions": sum(self.sess[t0:t1]), "peak_users": max(self.users[t0:t1]),
                 "events": 0, "exc": 0, "fstart": 0, "fdone": 0, "lattempt": 0, "lfail": 0}
            for it in vis:
                c = sum(it.counts[t0:t1])
                if it.kind in ("pageview", "event", "exception"):
                    d["events"] += c
                if it.role == "exc":
                    d["exc"] += c
                elif it.role in ("fstart", "fdone", "lattempt", "lfail"):
                    d[it.role] += c
            for m in ("LCP", "INP", "CLS"):
                d[m.lower()] = sum(self.vval[m][t0:t1]) / (t1 - t0)
            d["eng"] = sum(self.eng[t0:t1]) / (t1 - t0)
            if sc != 1.0:
                for k in ("sessions", "peak_users", "events", "exc", "fstart", "fdone", "lattempt", "lfail"):
                    d[k] = int(round(d[k] * sc))
            return d

        cs, bs = [], []
        for i in range(SLICES):
            t0, t1 = e - (SLICES - i) * L, e - (SLICES - i - 1) * L
            sc = scale if (i == SLICES - 1) else 1.0
            cs.append(mk(t0, t1, sc))
            bs.append(mk(t0 - SPD, t1 - SPD, 1.0))
        items = []
        for it in vis:
            cur, base, val, bval = [], [], None, None
            for i in range(SLICES):
                t0, t1 = e - (SLICES - i) * L, e - (SLICES - i - 1) * L
                c = sum(it.counts[t0:t1])
                if i == SLICES - 1 and scale != 1.0:
                    c = int(round(c * scale))
                cur.append(c)
                base.append(sum(it.counts[t0 - SPD:t1 - SPD]))
            if it.kind == "webvital":
                m = it.key.split(":")[1]
                val = [sum(self.vval[m][e - (SLICES - i) * L:e - (SLICES - i - 1) * L]) / L for i in range(SLICES)]
                bval = [sum(self.vval[m][e - (SLICES - i) * L - SPD:e - (SLICES - i - 1) * L - SPD]) / L for i in range(SLICES)]
            fmt = it.ph if key == "ph" else it.ga
            raws = [fill(fmt, random.Random(f"{tag}:{it.key}:{j}")) for j in range(3)]
            items.append({"key": it.key, "kind": it.kind, "role": it.role, "raws": raws, "props": dict(it.props),
                          "cur": cur, "base": base, "value": val, "base_value": bval})
        sec = {"slices": cs, "base_slices": bs, "items": items, "has_vitals": bool(self.flags["has_vitals"]),
               "ga4_exception": bool(self.flags["ga4_exc"]), "partial_last": bool(partial), "release": None}
        if key == "ph" and self.rel_t is not None and self.rel_t < e and self.rel_t >= e - SPD:
            s0 = e - SLICES * L
            first = 1 if self.rel_t < s0 else min(SLICES, 1 + (self.rel_t - s0) // L)
            share_last = sum(self.rel_share[e - L:e]) / L
            sec["release"] = {"new": self.rel_new, "old": self.rel_old, "first_slice": int(first),
                              "share_last": share_last}
        return sec
