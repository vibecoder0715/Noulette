/**
 * Tauri 2 IPC wrapper with browser fallback.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

export interface EngineStatus {
  ready: boolean;
  version: string;
  sidecarPath: string;
}

export interface KeyStatus {
  keyExists: boolean;
  fingerprint: string;
}

export interface ProjectsRecord {
  activeProject: string;
  recentProjects: string[];
}

// In-memory mock store for browser dev mode
let mockProjects: ProjectsRecord = {
  activeProject: 'C:/Users/User/Downloads/noulette',
  recentProjects: [
    'C:/Users/User/Downloads/noulette',
    'C:/Projects/my-shop-app',
    'C:/Projects/auth-service'
  ]
};

export async function tauriInvoke<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  const win = typeof window !== 'undefined' ? (window as any) : null;
  if (win?.__TAURI_INTERNALS__?.invoke) {
    return win.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  if (win?.__TAURI__?.core?.invoke) {
    return win.__TAURI__.core.invoke(cmd, args);
  }

  // Browser Fallback Implementations
  switch (cmd) {
    case 'get_engine_status':
      const extractedPath = typeof process !== 'undefined' && process.env?.APPDATA
        ? `${process.env.APPDATA}\\noulette\\bin\\noulette-engine.exe`
        : 'C:\\Users\\User\\AppData\\Roaming\\noulette\\bin\\noulette-engine.exe';
      return {
        ready: true,
        version: '0.1.0',
        sidecarPath: extractedPath,
        sidecar_path: extractedPath
      } as T;

    case 'get_key_status':
      return {
        keyExists: true,
        key_exists: true,
        fingerprint: 'ed25519:e5f6a1b2c3d4e5f6... (Windows Credential Manager)'
      } as T;

    case 'get_active_projects':
      return { ...mockProjects } as T;

    case 'set_active_project':
      mockProjects.activeProject = args.project_path;
      if (!mockProjects.recentProjects.includes(args.project_path)) {
        mockProjects.recentProjects.unshift(args.project_path);
      }
      return undefined as T;

    case 'pick_project_folder':
      return 'C:\\Projects\\my-new-app' as T;

    case 'play_chime':
      try {
        const { playNotificationSound } = await import('./sound.js');
        await playNotificationSound(args.volume ?? 80);
      } catch (e) {
        console.warn('play_chime warning:', e);
      }
      return undefined as T;

    case 'sign_decision':
      const decRe = /^dec_[0-9A-Z]{26}$/;
      if (!decRe.test(args.decision_id)) {
        throw new Error('Invalid decision_id format: must match ^dec_[0-9A-Z]{26}$');
      }
      const p = args.project_path || '';
      const hasStream = p.slice(2).includes(':') || (p.includes(':') && !/^[a-zA-Z]:/.test(p));
      if (!p || p.startsWith('\\\\') || p.startsWith('//') || hasStream || p.includes('..')) {
        throw new Error('Invalid project_path: UNC paths, traversal, and alternate data streams are prohibited (TC-267)');
      }
      return `ed25519:signed_${args.decision_id}` as T;

    case 'record_decision':
      const decRe2 = /^dec_[0-9A-Z]{26}$/;
      if (!decRe2.test(args.decision_id)) {
        throw new Error('Invalid decision_id format: must match ^dec_[0-9A-Z]{26}$');
      }
      if (args.action === 'accept-risk') {
        if (!args.reason || args.reason.length < 10) {
          throw new Error('Risk acceptance reason must be at least 10 characters');
        }
        if (args.days > 90) {
          throw new Error('Risk acceptance expiry cannot exceed 90 days');
        }
      }
      return {
        decisionId: args.decision_id,
        decision_id: args.decision_id,
        action: args.action,
        status: args.action === 'reject' ? 'discarded' : 'recorded',
        signature: args.action === 'reject' ? null : `ed25519:rec_${args.decision_id}`
      } as T;

    case 'sign_receipt':
      const rid = `rcpt_${Date.now()}`;
      return {
        receiptId: rid,
        receipt_id: rid,
        status: 'valid',
        signature: `ed25519:receipt_${rid}`
      } as T;

    case 'watch_project_folder':
      return undefined as T;

    default:
      console.warn(`[IPC Mock] Unhandled command: ${cmd}`, args);
      return undefined as T;
  }
}
