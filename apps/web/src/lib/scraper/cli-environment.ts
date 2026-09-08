/** Keep application secrets out of CLI processes that consume untrusted page text. */
export function cliEnvironment(provider: string): NodeJS.ProcessEnv {
  const common = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'SYSTEMROOT', 'WINDIR',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'];
  const keys = [...common, ...(provider === 'codex' ? ['CODEX_HOME', 'CODEX_API_KEY'] : ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'])];
  return { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(keys.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])) };
}
