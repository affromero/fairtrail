import React from 'react';
import { Box, Text } from 'ink';

const BORDER = '══════════════════════════════════════';

export function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{`╔${BORDER}╗`}</Text>
      <Text color="cyan" bold>{'║'}<Text color="cyan" bold>  ✈  </Text><Text color="white" bold>F A I R T R A I L</Text>{'              ║'}</Text>
      <Text color="cyan" bold>{'║'}<Text dimColor>  The price trail they don&apos;t show  </Text>{'║'}</Text>
      <Text color="cyan" bold>{`╚${BORDER}╝`}</Text>
    </Box>
  );
}
