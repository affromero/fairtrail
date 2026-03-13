import React, { useState } from 'react';
import { Box, useApp, useInput } from 'ink';
import { Header } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { SearchWizard } from './screens/SearchWizard.js';
import { QueryList } from './screens/QueryList.js';
import { QueryView } from './screens/QueryView.js';

interface AppProps {
  mode: 'search' | 'list' | 'view';
  viewId?: string;
}

export function App({ mode: initialMode, viewId: initialViewId }: AppProps) {
  const { exit } = useApp();
  const isTTY = process.stdin.isTTY ?? false;
  const [mode, setMode] = useState(initialMode);
  const [viewId, setViewId] = useState(initialViewId);

  useInput((_input, key) => {
    if (key.escape && mode === initialMode) {
      exit();
    }
  }, { isActive: isTTY });

  return (
    <Box flexDirection="column">
      <Header />
      <Box flexDirection="column" paddingX={1}>
        {mode === 'search' && <SearchWizard />}
        {mode === 'list' && (
          <QueryList
            onView={(id) => {
              setViewId(id);
              setMode('view');
            }}
          />
        )}
        {mode === 'view' && viewId && (
          <QueryView
            id={viewId}
            onBack={initialMode === 'list' ? () => setMode('list') : undefined}
          />
        )}
      </Box>
      <StatusBar />
    </Box>
  );
}
