import * as esbuild from 'esbuild';
import { pathToFileURL } from 'url';
await esbuild.build({ entryPoints: ['tests/bench.js'], bundle: true, platform: 'node', format: 'esm', outfile: '.tmp/bench.mjs', logLevel: 'warning' });
await import(pathToFileURL('.tmp/bench.mjs').href);
