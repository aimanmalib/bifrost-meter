# Security

## What the meter holds

One secret: a Bifrost virtual key. It is the credential for model calls through the gateway, so anyone holding it can
spend its budget. The meter needs no admin credential and cannot change any limit.

## Where the key lives

- Saved with **Set Virtual Key** into the editor's secret storage (the operating system keychain on desktop VS Code).
  Never in `settings.json`, never in the workspace.
- Fallback for editors without an input box: the `BIFROST_VIRTUAL_KEY` environment variable of the editor process. A key in
  secret storage wins over the variable.
- **Clear Virtual Key** removes it from secret storage.
- MCP server (docs/MCP.md): when the editor registers it, the extension passes the key from secret storage into the server
  process environment only at the moment the editor starts the server. With manual setup, the key sits wherever the MCP
  client keeps its configuration.

## Where the key goes

- Only to `bifrostMeter.baseUrl`, in the `x-bf-vk` header of `GET /api/governance/virtual-keys/quota`.
- The version lookup (`GET /api/version`, shown in the panel) is sent without the key.
- The MCP server sends the same single request to `BIFROST_BASE_URL`, with the same rules (same-origin redirects only, no
  plain `http` to public hosts unless allowed).
- No other network call. No telemetry.

## Where the key never appears

- Not in the status bar text.
- Not in the tooltip, the details panel, notifications, error messages, Copy Summary or the log. Where the meter must say
  which key it uses, it shows the last four characters only.
- Not in the panel HTML, so a screenshot of the panel is safe to share.
- Not in the MCP tool result or the server's error output; the result carries the last four characters as `key_hint`.

## Threats and what the meter does about them

| Threat | What the meter does |
| --- | --- |
| Key sent in clear over the internet | Plain `http://` to a host outside loopback and private networks is refused until `bifrostMeter.allowInsecureHttp` is `true`. The status bar shows "Insecure URL" and the tooltip and panel name the setting. |
| Gateway or proxy redirects the request to another host | Redirects are followed only inside the same origin (scheme, host and port). A redirect elsewhere stops the request and shows "Redirect refused"; the key is not sent again. |
| Slow or hanging gateway | Every request times out after 5 seconds. Errors back off up to 5 minutes. |
| Gateway answers with unexpected or hostile text | The response is shape-checked. Text from the gateway (key name, model names) is escaped before it reaches the panel HTML. |
| Script injection in the details panel | The panel runs under a content security policy of `default-src 'none'`; the only style and script carry a fresh nonce; nothing loads from outside; the script can only ask for five of the extension's own commands. Command links are disabled in the webview. |
| Key leaks through a shared screenshot or log | See "Where the key never appears". Test fixtures keep only the last four characters of keys. |
| Someone with access to your editor session | Out of scope. They can use the key through the editor anyway. Clear the key on shared machines. |

## What is not protected

- The key is as safe as the editor's secret storage and the machine it runs on.
- With `allowInsecureHttp` set to `true`, anyone on the network path can read the key.
- The environment variable fallback is visible to every process that can read the editor's environment.

## Reporting a problem

Please report a security problem privately, not in a public issue: use GitHub's private vulnerability reporting on this
repository (**Security** tab) when it is available, or contact the repository owner through their GitHub profile.
