import * as esbuild from 'esbuild';
import { pathToFileURL } from 'url';
await esbuild.build({ entryPoints: ['tests/suite.js'], bundle: true, platform: 'node', format: 'esm', outfile: '.tmp/suite.mjs', logLevel: 'warning' });
await import(pathToFileURL('.tmp/suite.mjs').href);
