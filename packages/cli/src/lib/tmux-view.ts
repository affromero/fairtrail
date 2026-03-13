import { execSync, spawnSync, spawn } from 'child_process';
import { prisma } from '@/lib/prisma';

const SESSION_NAME = 'fairtrail-view';
const WINDOW_NAME = 'fairtrail';

function tmux(...args: string[]): string {
  const result = spawnSync('tmux', args, { encoding: 'utf-8' });
  if (result.error) throw result.error;
  return result.stdout.trim();
}

function hasTmux(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasGhostty(): boolean {
  try {
    execSync('which ghostty', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function currentSession(): string {
  return tmux('display-message', '-p', '#{session_name}');
}

function buildViewCommand(queryId: string): string {
  const cwd = process.cwd();
  return `cd ${cwd} && doppler run -- node --import tsx/esm --import ./packages/cli/register.mjs packages/cli/src/index.tsx --view ${queryId}`;
}

function createTmuxPanes(session: string, window: string, queries: Array<{ id: string; origin: string; destination: string; dateFrom: Date }>) {
  const firstCmd = buildViewCommand(queries[0]!.id);
  tmux('send-keys', '-t', `${session}:${window}`, firstCmd, 'Enter');

  for (let i = 1; i < queries.length; i++) {
    const cmd = buildViewCommand(queries[i]!.id);
    const splitDir = i % 2 === 1 ? '-h' : '-v';
    tmux('split-window', splitDir, '-t', `${session}:${window}`);
    tmux('send-keys', '-t', `${session}:${window}`, cmd, 'Enter');
  }

  tmux('select-layout', '-t', `${session}:${window}`, 'tiled');
  tmux('select-pane', '-t', `${session}:${window}.0`);
}

export async function launchTmuxView(queryId: string): Promise<void> {
  if (!hasTmux()) {
    console.error('tmux is required for --tmux mode. Install with: brew install tmux');
    process.exit(1);
  }

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) {
    console.error(`Query "${queryId}" not found`);
    process.exit(1);
  }

  let queries = [query];
  if (query.groupId) {
    queries = await prisma.query.findMany({
      where: { groupId: query.groupId },
      orderBy: { createdAt: 'asc' },
    });
  }

  console.log(`Found ${queries.length} route(s) — opening tmux panes...`);
  for (const q of queries) {
    console.log(`  ${q.origin} → ${q.destination}  (${q.dateFrom.toISOString().slice(0, 10)})`);
  }

  if (process.env.TMUX) {
    // Inside tmux — create a new window in the current session
    const session = currentSession();
    tmux('new-window', '-t', `${session}:`, '-n', WINDOW_NAME);
    createTmuxPanes(session, WINDOW_NAME, queries);
    tmux('select-window', '-t', `${session}:${WINDOW_NAME}`);
    console.log(`Opened ${queries.length} panes in tmux window "${WINDOW_NAME}"`);
  } else {
    // Outside tmux — create a new detached session, then open in Ghostty or attach
    try { tmux('kill-session', '-t', SESSION_NAME); } catch { /* ok */ }

    tmux('new-session', '-d', '-s', SESSION_NAME, '-x', '220', '-y', '55');
    createTmuxPanes(SESSION_NAME, '0', queries);

    if (hasGhostty()) {
      // Open a new Ghostty window attached to the tmux session
      spawn('ghostty', ['-e', `tmux attach-session -t ${SESSION_NAME}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      console.log(`Opened Ghostty window with ${queries.length} panes`);
    } else {
      // Attach in current terminal
      spawnSync('tmux', ['attach-session', '-t', SESSION_NAME], { stdio: 'inherit' });
    }
  }

  await prisma.$disconnect();
}
