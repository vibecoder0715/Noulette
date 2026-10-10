import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, 
  ArrowDown, 
  Cpu, 
  Copy, 
  ShieldCheck 
} from 'lucide-react';
import type { NavPage } from '../components/Sidebar.js';

export interface ManualPageProps {
  onNavigate?: (page: NavPage) => void;
  onOpenSetupWizard?: () => void;
}

const MANUAL_BACKGROUND_SLIDES = [
  '/images/manual-1.jpg',
  '/images/manual-2.jpg',
  '/images/manual-3.jpg',
  '/images/manual-4.jpg'
];

interface IntegrationItem {
  id: string;
  num: string;
  name: string;
  icon: string;
}

// 8 Official Integration Brands (Cropped & Transparent Background)
const INTEGRATIONS: IntegrationItem[] = [
  { id: 'claude-code', num: '01', name: 'Claude Code', icon: '/images/integrations/claude-code.png' },
  { id: 'codex', num: '02', name: 'Codex', icon: '/images/integrations/codex.png' },
  { id: 'antigravity', num: '03', name: 'Antigravity', icon: '/images/integrations/antigravity.png' },
  { id: 'cline', num: '04', name: 'Cline', icon: '/images/integrations/cline.png' },
  { id: 'kiro', num: '05', name: 'Kiro', icon: '/images/integrations/kiro.png' },
  { id: 'opencode', num: '06', name: 'OpenCode', icon: '/images/integrations/opencode.png' },
  { id: 'posthog', num: '07', name: 'PostHog', icon: '/images/integrations/posthog.png' },
  { id: 'google-analytics', num: '08', name: 'Analytics', icon: '/images/integrations/google-analytics.png' }
];

export function ManualPage({ onNavigate }: ManualPageProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isHoldingAtBottom, setIsHoldingAtBottom] = useState(false);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState(1.5);
  const walkthroughContainerRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cycling 4 background manual workspace photos indefinitely (36% alpha)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % MANUAL_BACKGROUND_SLIDES.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  const cancelHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setIsHoldingAtBottom(false);
    setHoldSecondsLeft(1.5);
  };

  useEffect(() => {
    return () => {
      cancelHoldTimer();
    };
  }, []);

  const handleOpenWalkthrough = () => {
    setShowWalkthrough(true);
    setIsClosing(false);
  };

  const handleCloseWalkthrough = () => {
    cancelHoldTimer();
    setIsClosing(true);
    setTimeout(() => {
      setShowWalkthrough(false);
      setIsClosing(false);
    }, 320);
  };

  // When scrolling to the bottom-most, change back to manual after 1.5 seconds of hold
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;

    if (isAtBottom && showWalkthrough && !isClosing) {
      if (!holdTimerRef.current) {
        setIsHoldingAtBottom(true);
        setHoldSecondsLeft(1.5);
        const startTime = Date.now();

        holdIntervalRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          const remaining = Math.max(0, parseFloat((1.5 - elapsed).toFixed(1)));
          setHoldSecondsLeft(remaining);
        }, 100);

        holdTimerRef.current = setTimeout(() => {
          cancelHoldTimer();
          handleCloseWalkthrough();
        }, 1500);
      }
    } else {
      // User scrolled back up away from bottom, cancel hold
      if (holdTimerRef.current) {
        cancelHoldTimer();
      }
    }
  };

  return (
    <div
      className="manual-page-container"
      id="manual-page"
      style={{
        position: 'relative',
        minHeight: 'calc(100vh - 64px)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0',
        overflow: 'hidden'
      }}
    >
      {/* Backmost Layer: 4 Manual / Guidance Slides (Rich Workspace Photography) */}
      <div
        className="manual-background-slideshow"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          overflow: 'hidden'
        }}
      >
        {MANUAL_BACKGROUND_SLIDES.map((slideSrc, idx) => (
          <div
            key={slideSrc}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${slideSrc})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
              opacity: idx === currentSlide ? 0.36 : 0,
              transform: idx === currentSlide ? 'scale(1.02)' : 'scale(1.0)',
              transition: 'opacity 1.6s cubic-bezier(0.4, 0, 0.2, 1), transform 6s cubic-bezier(0.25, 1, 0.5, 1)',
              willChange: 'opacity, transform'
            }}
          />
        ))}

        {/* Ambient Vignette Overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 35%, var(--bg-app) 92%)',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Default Landing View: "New to us? Let's dive in." */}
      <div
        className="manual-hero-content"
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: '860px',
          margin: '0 auto',
          width: '100%',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px 20px',
          opacity: showWalkthrough ? 0 : 1,
          pointerEvents: showWalkthrough ? 'none' : 'auto',
          transition: 'opacity 0.25s ease'
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '56px',
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            WebkitTextStroke: '0.6px currentColor',
            color: 'var(--text-primary)',
            margin: '0 0 36px 0',
            textShadow: '0 2px 16px rgba(0, 0, 0, 0.06)'
          }}
        >
          New to us?<br />
          Let's dive in.
        </h1>

        <div>
          <button
            type="button"
            className="btn-clay"
            id="manual-walkthrough-btn"
            onClick={handleOpenWalkthrough}
            style={{
              padding: '11px 26px',
              fontSize: '13.5px',
              fontWeight: 800,
              borderRadius: '9999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.15)',
              cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease'
            }}
          >
            <BookOpen size={16} />
            <span>Walkthrough</span>
          </button>
        </div>
      </div>

      {/* Interactive Walkthrough View (Hidden by default, smooth transition on click) */}
      {showWalkthrough && (
        <div
          ref={walkthroughContainerRef}
          className={`walkthrough-overlay-container ${isClosing ? 'closing' : ''}`}
          id="walkthrough-overlay-page"
          onScroll={handleScroll}
        >
          {/* Ambient Background Image Layer for Walkthrough Page */}
          <div
            className="walkthrough-background-layer"
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'url(/images/manual-1.jpg)',
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                opacity: 0.18,
                filter: 'blur(2px)'
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(ellipse at center, transparent 30%, var(--bg-app) 88%)',
                pointerEvents: 'none'
              }}
            />
          </div>

          {/* Main Walkthrough Scrollable Content (No extra top bar or clutter) */}
          <div className="walkthrough-content-wrapper" style={{ position: 'relative', zIndex: 2 }}>
            {/* Section 1: Title & Lead */}
            <div style={{ textAlign: 'center', maxWidth: '820px', margin: '0 auto' }}>
              <h1
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '48px',
                  fontWeight: 800,
                  lineHeight: 1.15,
                  letterSpacing: '-0.03em',
                  WebkitTextStroke: '0.6px currentColor',
                  color: 'var(--text-primary)',
                  margin: '0 0 20px 0'
                }}
              >
                It's time to build real products.
              </h1>

              <p
                style={{
                  fontSize: '18px',
                  lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                  margin: '0'
                }}
              >
                Before shipping, plug Noulette in to find underlying problems in your software before catastrophe ever happens!
              </p>
            </div>

            {/* Section 2: Integration Banner Carousel */}
            <div>
              <div style={{ marginBottom: '16px' }}>
                <h2
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '28px',
                    fontWeight: 800,
                    WebkitTextStroke: '0.4px currentColor',
                    color: 'var(--text-primary)',
                    margin: '0 0 6px 0'
                  }}
                >
                  Super large scale, flexible integration
                </h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                  Integrated with:
                </p>
              </div>

              {/* Infinite Left-to-Right Marquee Carousel of Real Brand Icons */}
              <div className="integration-carousel-wrapper">
                <div className="integration-carousel-row" id="integration-carousel-row">
                  {/* Duplicated for seamless infinite loop */}
                  {[...INTEGRATIONS, ...INTEGRATIONS].map((item, idx) => (
                    <div key={`${item.id}-${idx}`} className="integration-square-card">
                      <span className="integration-card-num">{item.num}</span>
                      <img src={item.icon} alt={item.name} className="integration-card-logo" />
                      <span className="integration-card-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <span style={{ fontSize: '13.5px', fontStyle: 'italic', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  And many more upcoming...
                </span>
              </div>
            </div>

            {/* Section 3: Feature 1 - Background MCP & System */}
            <div className="walkthrough-feature-block" id="feature-mcp-engine">
              <div className="walkthrough-feature-header">
                <div className="walkthrough-feature-icon-badge">
                  <Cpu size={22} />
                </div>
                <div>
                  <h3 className="walkthrough-feature-text">
                    Whenever you open this desktop app, the MCP and system runs behind, it is that easy.
                  </h3>
                </div>
              </div>

              <div className="walkthrough-feature-media">
                <img
                  src="/images/walkthrough-control-mcp.png"
                  alt="Desktop app sidebar with background MCP engine active highlighted as manual"
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            </div>

            {/* Section 4: Feature 2 - Copy Prompts from Settings */}
            <div className="walkthrough-feature-block" id="feature-settings-prompts">
              <div className="walkthrough-feature-header">
                <div className="walkthrough-feature-icon-badge">
                  <Copy size={22} />
                </div>
                <div>
                  <h3 className="walkthrough-feature-text">
                    To setup the system, just copy the prompts from the settings
                  </h3>
                </div>
              </div>

              <div className="walkthrough-feature-media">
                <img
                  src="/images/walkthrough-control-settings.png"
                  alt="Settings page with Copy Prompt button highlighted as manual"
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            </div>

            {/* Section 5: Feature 3 - Production Decisions */}
            <div className="walkthrough-feature-block" id="feature-production-decisions">
              <div className="walkthrough-feature-header">
                <div className="walkthrough-feature-icon-badge">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3 className="walkthrough-feature-text">
                    Beyond pre-shipping, Noulette identifies, predict and make decisions on problems during production
                  </h3>
                </div>
              </div>

              <div className="walkthrough-feature-media">
                <img
                  src="/images/walkthrough-control-decisions.png"
                  alt="Production problem prediction and decision controls highlighted as manual"
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            </div>

            {/* Section 6: Bottom Down Arrow (Holds for 3 seconds at bottom before returning) */}
            <div
              className={`walkthrough-bottom-arrow-zone ${isHoldingAtBottom ? 'holding' : ''}`}
              id="walkthrough-exit-zone"
              onClick={handleCloseWalkthrough}
              title="Hold at bottom for 1.5s or click to return to manual"
            >
              <button
                type="button"
                className={`walkthrough-down-arrow-btn ${isHoldingAtBottom ? 'pulse-hold' : ''}`}
                id="walkthrough-down-arrow-btn"
                aria-label="Hold at bottom for 1.5 seconds or click to exit walkthrough"
              >
                <ArrowDown size={22} />
              </button>
              
              <div
                style={{
                  fontSize: '12.5px',
                  fontWeight: 700,
                  color: isHoldingAtBottom ? 'var(--accent-clay)' : 'var(--text-tertiary)',
                  transition: 'color 0.2s ease',
                  textAlign: 'center',
                  minHeight: '20px'
                }}
              >
                {isHoldingAtBottom ? (
                  <span>Returning to manual in {holdSecondsLeft}s...</span>
                ) : (
                  <span>Hold at bottom for 1.5s to return</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManualPage;
