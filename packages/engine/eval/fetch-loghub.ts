/**
 * Downloads a small public LogHub sample for the eval (not bundled: LogHub is for research use,
 * see https://github.com/logpai/loghub for its terms).
 *   bun run packages/engine/eval/fetch-loghub.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const URL_HDFS = 'https://raw.githubusercontent.com/logpai/loghub/master/HDFS/HDFS_2k.log';
const out = path.join(import.meta.dir, 'data', 'HDFS_2k.log');
fs.mkdirSync(path.dirname(out), { recursive: true });
const res = await fetch(URL_HDFS);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
fs.writeFileSync(out, await res.text());
console.log(`saved ${out}`);
