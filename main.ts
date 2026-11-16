// funboard's hand-in program (Node 22, standard library only, no build step).
//
// The frontend itself is the app/ folder beside this file: plain static
// files (an index.html, one stylesheet and a handful of ES modules) that any
// static server can serve, reading make.fun's public API at run time. This
// program hands it in: it copies app/ and screenshots/ into the output
// directory and writes dossier.json there with buildDossier from the
// vendored library, so the scorer can rebuild the same dossier from the
// same files and compare the two byte for byte. vendor/makefun-frontend.ts
// stays exactly as the kit ships it.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const target = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(target, { recursive: true });
cpSync(join(root, 'app'), join(target, 'app'), { recursive: true });
mkdirSync(join(target, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(target, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own: at most 3 screenshots of 256 KiB each, at
// most 993 files and directories and 16 MiB under app/, and the dossier
// text capped at 160 KiB. buildDossier refuses anything past them, exactly
// as the scorer would.
writeFileSync(
  join(target, 'dossier.json'),
  buildDossier(target, {
    text_max_bytes: 163840,
    screenshots: { max: 3, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 16777216,
  }),
);
