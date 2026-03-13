import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_SH = readFileSync(
  resolve(__dirname, '../../../public/install.sh'),
  'utf-8'
);
const CLI_SH = readFileSync(
  resolve(__dirname, '../../../public/fairtrail-cli'),
  'utf-8'
);

describe('install.sh', () => {
  it('uses bash shebang, not sh', () => {
    expect(INSTALL_SH).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it('documents | bash in usage comment, not | sh', () => {
    const usageLine = INSTALL_SH.split('\n').find((l) =>
      l.includes('Usage:')
    );
    expect(usageLine).toContain('| bash');
    expect(usageLine).not.toMatch(/\| sh\b/);
  });

  it('does not reference | sh in user-facing messages', () => {
    // Find all lines that show the install command to users (printf/echo with curl)
    const userFacingLines = INSTALL_SH.split('\n').filter(
      (l) => l.includes('fairtrail.org/install.sh') && !l.startsWith('#')
    );
    for (const line of userFacingLines) {
      expect(line, `Line references | sh: ${line.trim()}`).not.toMatch(
        /\| sh\b/
      );
    }
  });

  it('auto-adds ~/.local/bin to shell profile when not in PATH', () => {
    // Should modify a shell profile, not just print a warning
    expect(INSTALL_SH).toContain('>> "$SHELL_PROFILE"');
  });

  it('exports PATH for the rest of the script after adding it', () => {
    expect(INSTALL_SH).toContain('export PATH="$INSTALL_BIN:$PATH"');
  });

  it('guards xdg-open behind DISPLAY/WAYLAND_DISPLAY check', () => {
    const xdgLines = INSTALL_SH.split('\n').filter((l) =>
      l.includes('xdg-open')
    );
    expect(xdgLines.length).toBeGreaterThan(0);
    for (const line of xdgLines) {
      // The guard should be on the same line or the line before (elif)
      const lineIdx = INSTALL_SH.split('\n').indexOf(line);
      const context = INSTALL_SH.split('\n')
        .slice(Math.max(0, lineIdx - 1), lineIdx + 1)
        .join('\n');
      expect(
        context,
        `xdg-open not guarded: ${line.trim()}`
      ).toMatch(/DISPLAY|WAYLAND_DISPLAY/);
    }
  });

  it('redirects both stdout and stderr for xdg-open', () => {
    const xdgExecLines = INSTALL_SH.split('\n').filter(
      (l) => l.includes('xdg-open') && !l.includes('command -v')
    );
    for (const line of xdgExecLines) {
      expect(line, `xdg-open stderr not redirected: ${line.trim()}`).toMatch(
        />[^ ]* 2>&1/
      );
    }
  });

  it('includes cli-cache volume for persisting CLI installs', () => {
    expect(INSTALL_SH).toContain('cli-cache:/home/node/.npm-global');
  });
});

describe('fairtrail-cli', () => {
  it('uses bash shebang', () => {
    expect(CLI_SH).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it('guards xdg-open behind DISPLAY/WAYLAND_DISPLAY check', () => {
    const xdgLines = CLI_SH.split('\n').filter((l) =>
      l.includes('xdg-open')
    );
    expect(xdgLines.length).toBeGreaterThan(0);
    for (const line of xdgLines) {
      const lineIdx = CLI_SH.split('\n').indexOf(line);
      const context = CLI_SH.split('\n')
        .slice(Math.max(0, lineIdx - 1), lineIdx + 1)
        .join('\n');
      expect(
        context,
        `xdg-open not guarded: ${line.trim()}`
      ).toMatch(/DISPLAY|WAYLAND_DISPLAY/);
    }
  });

  it('does not reference | sh for install command', () => {
    const installLines = CLI_SH.split('\n').filter(
      (l) => l.includes('fairtrail.org/install.sh') && !l.startsWith('#')
    );
    for (const line of installLines) {
      expect(line, `Line references | sh: ${line.trim()}`).not.toMatch(
        /\| sh\b/
      );
    }
  });
});
