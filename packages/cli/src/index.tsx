#!/usr/bin/env node
import { program } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';
import { launchTmuxView } from './lib/tmux-view.js';

program
  .name('fairtrail')
  .description('The price trail airlines don\'t show you — TUI mode')
  .option('--headless', 'Launch interactive search wizard (default)')
  .option('--list', 'Show all tracked queries')
  .option('--view <id>', 'View price chart for a query')
  .option('--tmux', 'Split grouped routes into tmux panes (use with --view)')
  .parse();

const opts = program.opts<{ headless?: boolean; list?: boolean; view?: string; tmux?: boolean }>();

if (opts.view && opts.tmux) {
  launchTmuxView(opts.view).catch((err) => {
    console.error('tmux view failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
} else {
  const mode = opts.list ? 'list' as const : opts.view ? 'view' as const : 'search' as const;
  const viewId = opts.view;
  render(<App mode={mode} viewId={viewId} />);
}
