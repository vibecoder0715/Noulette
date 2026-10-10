"""
allowlist.py - the only PostHog and GA4 field names the generated data may use.

Built from the PostHog docs and GA4 Data API pages read on 2026-10-10.
See IMPLEMENTATION.md ("Training data") for the sources and what could not be confirmed.
Names that start with "$" are PostHog system fields and must be in POSTHOG_SYSTEM.
Names without "$" in PostHog samples are CUSTOM (the app's own events and properties) and
must be in POSTHOG_CUSTOM, which lists the custom names the simulator is allowed to invent.
"""

# PostHog system events and properties (confirmed in the PostHog docs unless noted)
POSTHOG_SYSTEM = {
    # events
    "$pageview", "$autocapture", "$exception", "$web_vitals",
    # default properties
    "$current_url", "$pathname", "$referrer", "$browser", "$browser_version", "$device_type", "$event_type",
    "$geoip_country_code",
    # error tracking
    "$exception_list", "$exception_fingerprint", "$exception_level",
    # web vitals values (opt-in via capture_performance)
    "$web_vitals_LCP_value", "$web_vitals_INP_value", "$web_vitals_CLS_value", "$web_vitals_FCP_value",
}

# GA4 Data API names. Most were confirmed on the pages read.
# From memory, NOT confirmed on those pages: eventName, keyEvents, screenPageViews, sessionMedium, pageTitle.
GA4_NAMES = {
    # metrics
    "activeUsers", "sessions", "engagedSessions", "engagementRate", "bounceRate", "eventCount",
    "keyEvents", "screenPageViews",
    # dimensions
    "pagePath", "sessionSource", "sessionMedium", "deviceCategory", "country", "eventName",
}

# GA4 names that must never appear in a GA4 sample (GA4 has no stack traces or latency).
GA4_FORBIDDEN_TEXT = (
    "stack", "stacktrace", "$exception", "traceback", " at ", "lcp", "inp", "cls", "fcp",
    "latency", "p75", "web_vitals", "web vitals", "ms)",
)

# Custom (app-defined) PostHog names the simulator may use.
POSTHOG_CUSTOM = {
    # funnel and login
    "checkout_started", "order_completed", "checkout_failed", "signup_started", "signup_completed",
    "signup_failed", "booking_started", "booking_confirmed", "booking_failed", "subscribe_clicked",
    "subscription_started", "paywall_error", "transfer_started", "transfer_completed", "transfer_failed",
    "login_attempt", "login_failed",
    # extras
    "add_to_cart", "search_performed", "wishlist_added", "report_exported", "invite_sent",
    "feature_flag_viewed", "booking_searched", "room_viewed", "article_shared", "newsletter_opened",
    "beneficiary_added", "statement_downloaded", "api_error", "profile_updated", "poll_status",
    "scroll_depth_tick", "checkout_note", "session_heartbeat",
    # custom properties
    "vendor", "status", "endpoint", "release", "fingerprint", "api_key", "card_number", "display_name",
    "email",
}

# Names we show in the packet that are our own labels, not PostHog or GA4 fields
PACKET_LABELS = {"user_engagement", "page_view", "exception"}
