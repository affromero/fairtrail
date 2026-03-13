import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  hint?: string;
}

export function StatusBar({ hint }: StatusBarProps) {
  return (
    <Box marginTop={1} flexDirection="row" justifyContent="space-between">
      <Text dimColor>{hint ?? 'q: quit  tab: navigate  enter: confirm'}</Text>
      <Text dimColor>fairtrail.org</Text>
    </Box>
  );
}
