#!/usr/bin/env node
import { runCli } from './cli.js';

// The serve process must survive a stray async failure — it is the single CDP client.
process.on('unhandledRejection', (e) => console.error('zbridge: unhandled rejection', e));
process.on('uncaughtException', (e) => console.error('zbridge: uncaught exception', e));

runCli(process.argv.slice(2)).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
