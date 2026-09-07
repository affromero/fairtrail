import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { carTerminalText, type CarBrowserConfirmation } from '../lib/car-browser.js';

export function CarConfirmation({ confirmation, rows, onConfirm }: { confirmation: CarBrowserConfirmation; rows: number; onConfirm: () => void }) {
  const { stdout } = useStdout();
  const [answer, setAnswer] = useState(''), [offset, setOffset] = useState(0);
  const operation = confirmation.operation;
  const action = operation.kind === 'edit' && typeof operation.body?.active === 'boolean'
    ? operation.body.active ? 'Resume tracking' : 'Pause tracking' : operation.kind === 'refresh' ? 'Check prices' : operation.kind === 'delete' ? 'Delete tracker' : operation.kind;
  const width = Math.max(10, (stdout.columns || 80) - 4), count = Math.max(1, rows - 15);
  const json = JSON.stringify(operation.body, null, 2).split('').map(character => character.charCodeAt(0) > 126
    ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}` : character).join('');
  const lines = json.split('\n').flatMap(line => Array.from({ length: Math.max(1, Math.ceil(line.length / width)) }, (_, index) => line.slice(index * width, (index + 1) * width)));
  const start = Math.min(offset, Math.max(0, lines.length - count));
  useInput((input, key) => {
    if (key.upArrow) setOffset(Math.max(0, start - 1));
    if (key.downArrow) setOffset(Math.min(start + 1, Math.max(0, lines.length - count)));
  });
  return <Box flexDirection="column">
    <Text bold color={operation.kind === 'delete' ? '#c1272d' : '#80a8a5'}>{confirmation.receiptPath ? 'RETRY SAVED REQUEST' : 'CONFIRM CHANGE'} / {action}</Text>
    <Text>{carTerminalText(confirmation.label)}</Text>
    <Text>Server: {carTerminalText(confirmation.origin)}</Text>
    <Text>Account: {carTerminalText(confirmation.scope)}</Text>
    <Text>Target: {operation.id ?? 'New resource'} · revision: {operation.revision ?? 'Not applicable'}</Text>
    {confirmation.receiptPath && <Text>Receipt: {carTerminalText(confirmation.receiptPath)}</Text>}
    {confirmation.conflict && <Text color="#c1272d">The earlier outcome is unproven. This applies a new change to the displayed revision.</Text>}
    {operation.kind === 'delete' && <Text color="#c1272d">Deletes the tracker and its price history. This cannot be undone.</Text>}
    <Text dimColor>Saved payload · lines {start + 1}–{Math.min(start + count, lines.length)} of {lines.length} · ↑↓ scroll</Text>
    {lines.slice(start, start + count).map((line, index) => <Text key={start + index}>{line}</Text>)}
    <Box><Text>Type yes, then Enter: </Text><TextInput value={answer} onChange={value => setAnswer(value.slice(0, 10))} onSubmit={value => { if (value === 'yes') onConfirm(); }} /></Box>
    <Text dimColor>Esc cancels without sending a request</Text>
  </Box>;
}
