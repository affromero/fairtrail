#!/usr/bin/env node
import { program } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';

program
  .name('fairtrail')
  .description('The price trail airlines don\'t show you — TUI mode')
  .option('--headless', 'Launch interactive search wizard (default)')
  .option('--list', 'Show all tracked queries')
  .option('--view <id>', 'View price chart for a query')
  .parse();

const opts = program.opts<{ headless?: boolean; list?: boolean; view?: string }>();

const mode = opts.list ? 'list' as const : opts.view ? 'view' as const : 'search' as const;
const viewId = opts.view;

render(<App mode={mode} viewId={viewId} />);
