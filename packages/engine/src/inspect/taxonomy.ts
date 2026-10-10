/**
 * Plain-language labels. Technical detail (CWE, rule id, scanner output) stays in the
 * collapsed "Details" section; users see only the label and a one-line TL;DR.
 */
export interface Label {
  id: string;
  label: string;
  tldr: string;
  cwes: number[];
}

export const LABELS: Label[] = [
  { id: 'database', label: 'Database flaw', tldr: 'Someone could read or change your database by typing special text.', cwes: [89, 564, 943] },
  { id: 'command', label: 'Command takeover', tldr: 'Someone could make your server run their own commands.', cwes: [77, 78, 88] },
  { id: 'code-injection', label: 'Code takeover', tldr: 'Someone could make your app run their own code.', cwes: [94, 95, 96, 917, 1336] },
  { id: 'xss', label: 'Page injection', tldr: 'Someone could put harmful scripts on pages other users see.', cwes: [79, 80, 83, 87] },
  { id: 'path', label: 'File access flaw', tldr: 'Someone could read or overwrite files they should not reach.', cwes: [22, 23, 35, 73, 59] },
  { id: 'upload', label: 'Unsafe upload', tldr: 'Uploaded files are not checked, so harmful files could get in.', cwes: [434] },
  { id: 'ssrf', label: 'Server tricked into requests', tldr: 'Your server could be tricked into calling private systems.', cwes: [918] },
  { id: 'redirect', label: 'Unsafe redirect', tldr: 'Links could send your users to a fake site.', cwes: [601] },
  { id: 'xxe', label: 'Unsafe file parsing', tldr: 'Special files could make the app leak data or crash.', cwes: [611, 776] },
  { id: 'deserialize', label: 'Unsafe data loading', tldr: 'Loading untrusted data could let someone run code.', cwes: [502] },
  { id: 'proto', label: 'Object tampering', tldr: 'Crafted input could change how your app behaves everywhere.', cwes: [1321, 915] },
  { id: 'auth', label: 'Login flaw', tldr: 'People might get in without the right password.', cwes: [287, 288, 290, 306, 1390] },
  { id: 'access', label: 'Access control flaw', tldr: 'Users can see or change things that belong to someone else.', cwes: [284, 285, 639, 862, 863, 732, 269] },
  { id: 'session', label: 'Session flaw', tldr: 'Logged-in sessions could be stolen or reused.', cwes: [384, 613, 614, 1004, 539] },
  { id: 'csrf', label: 'Forged request', tldr: 'Another site could make actions on behalf of your logged-in users.', cwes: [352] },
  { id: 'password', label: 'Weak password storage', tldr: 'Passwords are stored in a way that is easy to crack.', cwes: [256, 257, 261, 916, 759, 760] },
  { id: 'crypto', label: 'Weak encryption', tldr: 'Data protection uses outdated or broken methods.', cwes: [327, 328, 326, 330, 338, 780] },
  { id: 'tls', label: 'Unsafe connection', tldr: 'Connections are not properly protected, so data can be read on the way.', cwes: [295, 297, 319, 757] },
  { id: 'secret', label: 'Leaked password or key', tldr: 'A password or key is written in the code where others can find it.', cwes: [798, 259, 321, 522, 540] },
  { id: 'exposure', label: 'Private data exposed', tldr: 'Private information could be shown to people who should not see it.', cwes: [200, 201, 209, 532, 538, 359] },
  { id: 'logging', label: 'Sensitive data in logs', tldr: 'Logs contain private data that should not be stored there.', cwes: [532, 117] },
  { id: 'jwt', label: 'Token flaw', tldr: 'Login tokens could be forged or accepted without checks.', cwes: [347, 345] },
  { id: 'cors', label: 'Open cross-site access', tldr: 'Any website could read data from your app on behalf of your users.', cwes: [942, 346] },
  { id: 'headers', label: 'Missing browser protections', tldr: 'Basic browser safety settings are missing.', cwes: [693, 1021, 16] },
  { id: 'ratelimit', label: 'No abuse limits', tldr: 'Someone could spam or guess passwords without being slowed down.', cwes: [307, 770, 799] },
  { id: 'dos', label: 'Crash or overload risk', tldr: 'Certain input could slow down or crash your app.', cwes: [400, 1333, 674, 789] },
  { id: 'regex', label: 'Slow pattern check', tldr: 'A text pattern could freeze the app on crafted input.', cwes: [1333] },
  { id: 'race', label: 'Timing flaw', tldr: 'Two actions at the same moment could break your data, such as double spending.', cwes: [362, 367] },
  { id: 'validation', label: 'Missing input checks', tldr: 'Input is not checked, so bad values can get through.', cwes: [20, 1284, 1287] },
  { id: 'debug', label: 'Debug mode left on', tldr: 'Developer settings are left on and reveal internals.', cwes: [489, 215, 11] },
  { id: 'config', label: 'Unsafe setting', tldr: 'A setting makes the app easier to attack.', cwes: [1188, 276, 250] },
  { id: 'dependency', label: 'Outdated package with known flaw', tldr: 'A package you use has a publicly known security problem.', cwes: [1104, 1395, 937] },
  { id: 'dependency-exploited', label: 'Package flaw attackers use right now', tldr: 'A package you use has a flaw that is being actively exploited.', cwes: [] },
  { id: 'supply', label: 'Suspicious install step', tldr: 'Something runs automatically on install and could be harmful.', cwes: [506, 829, 494] },
  { id: 'malware', label: 'Possible malware', tldr: 'This looks like it was made to harm your computer or steal data.', cwes: [506, 507, 912] },
  { id: 'prompt-injection', label: 'Hidden instructions for AI', tldr: 'A file contains hidden text that tries to control AI tools.', cwes: [1427] },
  { id: 'business', label: 'Business rule flaw', tldr: 'The app lets users break your rules, such as negative prices or skipping payment.', cwes: [840, 841, 837] },
  { id: 'money', label: 'Money handling flaw', tldr: 'Money values could be rounded, duplicated or faked.', cwes: [681, 190, 191] },
  { id: 'state', label: 'Broken step order', tldr: 'Users can skip or repeat steps in a flow.', cwes: [841, 696] },
  { id: 'mock', label: 'Fake or placeholder code', tldr: 'Part of the app uses fake data or placeholders instead of real systems.', cwes: [1164, 561] },
  { id: 'scale', label: 'Will not handle your user count', tldr: 'The current setup is likely to struggle with the number of users you expect.', cwes: [1050, 405] },
  { id: 'overbuild', label: 'More complex than needed', tldr: 'The setup is heavier and costlier than your user count needs.', cwes: [] },
  { id: 'integration', label: 'Outside connection problem', tldr: 'A connection to another system is missing checks or will fail in real use.', cwes: [754, 755] },
  { id: 'reliability', label: 'Breaks easily', tldr: 'Errors are not handled, so one failure can take the app down.', cwes: [248, 391, 703, 252] },
  { id: 'pipeline', label: 'Release process problem', tldr: 'How the app is built or released has a gap.', cwes: [1127] },
  { id: 'infra', label: 'Hosting setup problem', tldr: 'The server or cloud setup has a gap.', cwes: [1008, 668] },
  { id: 'monitoring', label: 'No way to see problems after launch', tldr: 'You will not know when something breaks for users.', cwes: [778, 223] },
  { id: 'compliance', label: 'Rules or law requirement', tldr: 'The app may not meet a rule that applies to your users or data.', cwes: [359, 1230] },
  { id: 'license', label: 'License conflict', tldr: 'The licenses of your code or packages may not allow how you use them.', cwes: [1357] },
  { id: 'license-missing', label: 'Missing license', tldr: 'Your project has no license, so others cannot safely use it.', cwes: [] },
  { id: 'asset', label: 'Risky copied asset', tldr: 'An image, font or file may be used without permission.', cwes: [] },
  { id: 'live-test', label: 'Live test finding', tldr: 'Running your app showed a problem.', cwes: [] },
  { id: 'other', label: 'Other problem', tldr: 'Something needs a closer look.', cwes: [] }
];

const BY_ID = new Map(LABELS.map((l) => [l.id, l]));
const BY_CWE = new Map<number, Label>();
for (const l of LABELS) for (const c of l.cwes) if (!BY_CWE.has(c)) BY_CWE.set(c, l);

export function labelById(id: string): Label {
  return BY_ID.get(id) ?? BY_ID.get('other')!;
}

export function labelForCwe(cwe: string | number | null | undefined): Label | null {
  if (cwe === null || cwe === undefined) return null;
  const n = typeof cwe === 'number' ? cwe : parseInt(String(cwe).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? BY_CWE.get(n) ?? null : null;
}

export const LABEL_IDS = LABELS.map((l) => l.id) as [string, ...string[]];
