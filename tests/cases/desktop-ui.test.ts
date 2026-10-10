import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { getContrastRatio, meetsWcagAA } from '../../apps/desktop/src/util/contrast-check.js';
import { renderSanitizedText, ZWSP_REGEX, BIDI_REGEX } from '../../apps/desktop/src/util/sanitize-text.js';
import { PROMPT_SECURITY_LOGIC, PROMPT_ARCH_FEASIBILITY } from '../../apps/desktop/src/pages/HomePage.js';
import { STARTER_PROMPTS } from '../../apps/desktop/src/pages/SettingsPage.js';
import { tauriInvoke } from '../../apps/desktop/src/util/ipc.js';

describe('Frontend UI, Terra Design System & Desktop Shell (Part 3 / TC-144..149)', () => {
  const desktopSrcDir = path.resolve('apps/desktop/src');

  // --- 1. WCAG AA Contrast Ratios ---
  describe('WCAG AA Accessible Contrast (≥ 4.5:1)', () => {
    // Light mode surfaces
    const lightSurfaces = {
      appBg: '#FAF7F2',
      surface: '#FFFFFF',
      sidebar: '#F1ECE3',
      sidebarActive: '#E6DFD3'
    };

    // Light mode text
    const lightText = {
      primary: '#262320',
      secondary: '#524B44',
      tertiary: '#5C554E'
    };

    // Dark mode surfaces
    const darkSurfaces = {
      appBg: '#1C1816',
      surface: '#25201D',
      sidebar: '#181513',
      sidebarActive: '#2F2925'
    };

    // Dark mode text
    const darkText = {
      primary: '#F0EBE5',
      secondary: '#B8AEA5',
      tertiary: '#A89E95'
    };

    it('Light Mode: Primary, Secondary, and Tertiary text all achieve ≥ 4.5:1 across every surface', () => {
      for (const [sName, sColor] of Object.entries(lightSurfaces)) {
        for (const [tName, tColor] of Object.entries(lightText)) {
          const ratio = getContrastRatio(tColor, sColor);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
          expect(meetsWcagAA(tColor, sColor)).toBe(true);
        }
      }
    });

    it('Dark Mode: Primary, Secondary, and Tertiary text all achieve ≥ 4.5:1 across every surface', () => {
      for (const [sName, sColor] of Object.entries(darkSurfaces)) {
        for (const [tName, tColor] of Object.entries(darkText)) {
          const ratio = getContrastRatio(tColor, sColor);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
          expect(meetsWcagAA(tColor, sColor)).toBe(true);
        }
      }
    });

    it('Clay button contrast: Light mode ≥ 4.5:1, Dark mode ≥ 4.5:1', () => {
      // Light mode clay button: #FFFFFF on #A84F32
      const lightClayRatio = getContrastRatio('#FFFFFF', '#A84F32');
      expect(lightClayRatio).toBeGreaterThanOrEqual(4.5);

      // Dark mode clay button: #181513 on #D47B5B
      const darkClayRatio = getContrastRatio('#181513', '#D47B5B');
      expect(darkClayRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('Semantic status badges all achieve ≥ 4.5:1 contrast on their backgrounds', () => {
      // Light mode status tokens
      expect(getContrastRatio('#8E2417', '#FDF2F0')).toBeGreaterThanOrEqual(4.5); // Critical
      expect(getContrastRatio('#7A4B00', '#FBF3E2')).toBeGreaterThanOrEqual(4.5); // Warning
      expect(getContrastRatio('#1E5E3A', '#EAF5EE')).toBeGreaterThanOrEqual(4.5); // Safe
      expect(getContrastRatio('#1B4561', '#EDF3F8')).toBeGreaterThanOrEqual(4.5); // AI

      // Dark mode status tokens
      expect(getContrastRatio('#FCA5A5', '#2D120F')).toBeGreaterThanOrEqual(4.5); // Critical
      expect(getContrastRatio('#FDE68A', '#2E2108')).toBeGreaterThanOrEqual(4.5); // Warning
      expect(getContrastRatio('#86EFAC', '#10261A')).toBeGreaterThanOrEqual(4.5); // Safe
      expect(getContrastRatio('#93C5FD', '#12212F')).toBeGreaterThanOrEqual(4.5); // AI
    });
  });

  // --- 2. Zero dangerouslySetInnerHTML & Steganography / Bidi Sanitization ---
  describe('Content Sanitization & Safe Diff Rendering', () => {
    it('Strict security policy: ZERO dangerouslySetInnerHTML across entire desktop source code', () => {
      function checkDir(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkDir(fullPath);
          } else if (/\.[jt]sx?$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            expect(content).not.toContain('dangerouslySetInnerHTML');
          }
        }
      }

      checkDir(desktopSrcDir);
    });

    it('Steganography: Zero-width space (\u200B) rendered as visible [ZWSP] badge', () => {
      const malicious = 'const token = "secret\u200Bpassword";';
      const rendered = renderSanitizedText(malicious);

      expect(rendered.length).toBeGreaterThan(1);
      // Verify a node contains the [ZWSP] aria-label
      const hasZwspTag = rendered.some(
        (node: any) => node && node.props && node.props['aria-label'] === '[ZWSP]'
      );
      expect(hasZwspTag).toBe(true);
    });

    it('Bidi override: Right-to-Left override (\u202E) rendered as visible [BIDI-OVERRIDE] badge', () => {
      const bidiMalicious = 'access_level = "user\u202Eadmin";';
      const rendered = renderSanitizedText(bidiMalicious);

      expect(rendered.length).toBeGreaterThan(1);
      const hasBidiTag = rendered.some(
        (node: any) => node && node.props && node.props['aria-label'] === '[BIDI-OVERRIDE]'
      );
      expect(hasBidiTag).toBe(true);
    });
  });

  // --- 3. TC-147: Starter Prompts Catalog Exactness ---
  describe('TC-147: Starter Prompts Catalog', () => {
    it('Prompts catalog text matches specification exactly', () => {
      expect(PROMPT_SECURITY_LOGIC).toContain('Use the noulette MCP tools');
      expect(PROMPT_SECURITY_LOGIC).toContain('Call noulette_scan for this project');
      expect(PROMPT_SECURITY_LOGIC).toContain('Never edit tests, scanner settings, or files in .noulette/');
      expect(PROMPT_SECURITY_LOGIC).toContain('Never say anything is safe');

      expect(PROMPT_ARCH_FEASIBILITY).toContain('Call noulette_plan for this project');
      expect(PROMPT_ARCH_FEASIBILITY).toContain('only change what the plan items name after the user approves');

      expect(STARTER_PROMPTS.length).toBe(5);
      const titles = STARTER_PROMPTS.map((p: { title: string }) => p.title);
      expect(titles).toContain('Fix security and logic');
      expect(titles).toContain('Fix feasibility (scale and risk plan)');
      expect(titles).toContain('Check an outside project before opening it');
      expect(titles).toContain('Check before I ship');
      expect(titles).toContain('Explain a finding');
    });
  });

  // --- 4. TC-148: MCP Connection Testing ---
  describe('TC-148: MCP Connection & Engine Status', () => {
    it('Queries engine status successfully via IPC', async () => {
      const status = await tauriInvoke<any>('get_engine_status');
      expect(status.ready).toBe(true);
      expect(status.version).toBe('0.1.0');
      expect(status.sidecarPath).toContain('noulette-engine.exe');
    });
  });

  // --- 5. TC-144 & TC-145: Toast & Audio Chime Configuration ---
  describe('TC-144 & TC-145: Notification & Chime Invariants', () => {
    it('Audio chime command play_chime exists and executes without error', async () => {
      const result = await tauriInvoke('play_chime');
      expect(result).toBeUndefined();
    });
  });

  // --- 6. TC-149: Environment Paths Hardening ---
  describe('TC-149: Environment Paths Hardening', () => {
    it('Paths with spaces and Unicode load correctly without encoding failure', async () => {
      const unicodePath = 'C:\\Projects\\noulette 测试项目 2026\\sub folder';
      await tauriInvoke('set_active_project', { project_path: unicodePath });

      const active = await tauriInvoke<any>('get_active_projects');
      expect(active.activeProject).toBe(unicodePath);
      expect(active.recentProjects).toContain(unicodePath);
    });
  });

  // --- 7. Decision IPC & Accept Risk Enforcement ---
  describe('Decisions IPC & Risk Exception Rules', () => {
    it('record_decision rejects accept-risk with reason < 10 characters', async () => {
      expect(async () => {
        await tauriInvoke('record_decision', {
          project_path: 'test',
          decision_id: 'dec_01J00000000000000000000001',
          action: 'accept-risk',
          reason: 'too short',
          owner: 'lead',
          days: 30
        });
      }).toThrow(/at least 10 characters/);
    });

    it('record_decision rejects accept-risk with expiry > 90 days', async () => {
      expect(async () => {
        await tauriInvoke('record_decision', {
          project_path: 'test',
          decision_id: 'dec_01J00000000000000000000001',
          action: 'accept-risk',
          reason: 'Valid justification with sufficient length',
          owner: 'lead',
          days: 95
        });
      }).toThrow(/cannot exceed 90 days/);
    });

    it('record_decision accepts valid risk parameters', async () => {
      const res = await tauriInvoke<any>('record_decision', {
        project_path: 'test',
        decision_id: 'dec_01J00000000000000000000001',
        action: 'accept-risk',
        reason: 'Valid justification with sufficient length',
        owner: 'security-team',
        days: 45
      });

      expect(res.decisionId).toBe('dec_01J00000000000000000000001');
      expect(res.action).toBe('accept-risk');
      expect(res.status).toBe('recorded');
    });

    it('record_decision handles reject by marking status discarded', async () => {
      const res = await tauriInvoke<any>('record_decision', {
        project_path: 'test',
        decision_id: 'dec_01J00000000000000000000001',
        action: 'reject'
      });

      expect(res.action).toBe('reject');
      expect(res.status).toBe('discarded');
    });
  });

  // --- 8. Brand Logo Separation & Zero Coexistence ---
  describe('Brand Logo Non-Coexistence & Centering', () => {
    it('BrandLogo component never renders both mark and wordmark simultaneously', () => {
      const brandLogoFile = path.resolve('apps/desktop/src/components/BrandLogo.tsx');
      const content = fs.readFileSync(brandLogoFile, 'utf8');

      // Verifies ternary check where collapsed renders BrandMark and expanded renders BrandWordmark
      expect(content).toContain('collapsed ?');
      expect(content).toContain('<BrandMark');
      expect(content).toContain('<BrandWordmark');
      expect(content).toContain('justifyContent: \'center\'');
    });

    it('Desktop layout has zero header component rendering, delegating branding to sidebar', () => {
      const appFile = path.resolve('apps/desktop/src/App.tsx');
      const content = fs.readFileSync(appFile, 'utf8');

      expect(content).not.toContain('<Header');
      expect(content).not.toContain('import { Header }');
    });
  });

  // --- 9. Vibe Coder Abstraction & Dynamic Prompts ---
  describe('Vibe Coder Technical Abstraction & MCP Prompts', () => {
    it('Settings page abstracts away git hooks, raw keypair management, and separate MCP column', () => {
      const settingsFile = path.resolve('apps/desktop/src/pages/SettingsPage.tsx');
      const content = fs.readFileSync(settingsFile, 'utf8');

      expect(content).not.toContain('Git Save Gate Hooks');
      expect(content).not.toContain('toggle-hooks-btn');
      expect(content).not.toContain('Rotate Keypair');
      expect(content).not.toContain('copy-mcp-btn');
    });

    it('All 5 starter prompts contain MCP server configuration and dynamic skill paths', () => {
      expect(STARTER_PROMPTS.length).toBe(5);
      for (const prompt of STARTER_PROMPTS) {
        const text = prompt.getPrompt('C:\\Users\\User\\Downloads\\noulette');
        expect(text).toContain('Use the noulette MCP server');
        expect(text).toContain('command:');
        expect(text).toContain('noulette.exe');
        expect(text).toContain('args: ["mcp"]');
        expect(text).toContain('skills\\');
      }
    });

    it('Settings page cards do not show raw prompt body in the card view', () => {
      const settingsFile = path.resolve('apps/desktop/src/pages/SettingsPage.tsx');
      const content = fs.readFileSync(settingsFile, 'utf8');

      // Card view must render title, description, and copy button without dumping prompt.text directly in paragraph
      expect(content).not.toContain('"{prompt.text}"');
    });
  });

  // --- 10. Glowing Circle Animation & Sidebar Controls ---
  describe('Google-Style Brown Glowing Circle & Sidebar Controls', () => {
    it('CSS contains 4-second Google-style Brown Glow keyframes', () => {
      const cssFile = path.resolve('apps/desktop/src/index.css');
      const content = fs.readFileSync(cssFile, 'utf8');

      expect(content).toContain('@keyframes googleBrownGlow');
      expect(content).toContain('.nav-badge.glow-google-brown');
      expect(content).toContain('rgba(168, 79, 50');
    });

    it('Sidebar contains gear icon for Settings, info icon for Manual, and minimal SVG theme icon toggle (no text)', () => {
      const sidebarFile = path.resolve('apps/desktop/src/components/Sidebar.tsx');
      const content = fs.readFileSync(sidebarFile, 'utf8');

      expect(content).toContain('SettingsIcon');
      expect(content).toContain('manual');
      expect(content).toContain('theme-toggle-btn');
      expect(content).not.toContain('Engine ready');
      expect(content).not.toContain('theme-segmented-group');
      expect(content).toContain('glowActive');
    });
  });
});

