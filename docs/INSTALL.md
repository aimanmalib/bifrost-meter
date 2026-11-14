# Install

Bifrost Meter is not published to any extension marketplace. You install it from a `.vsix` file.

## Requirements

- VS Code 1.90 or newer, or code-server. Tested in code-server 4.145.2. Editors built on VS Code (Cursor, VSCodium) should
  work but are not tested.
- A Bifrost gateway that serves `GET /api/governance/virtual-keys/quota` (v1.5.0 or newer; tested with v2.5.1).
- A Bifrost virtual key. You do not need admin access to the gateway.

## Install the .vsix

1. Download `bifrost-meter.vsix` from the repository's Releases page, or build it yourself (below).
2. Install it, either from the command line:

   ```
   code --install-extension bifrost-meter.vsix
   ```

   or in the editor: Extensions view, `...` menu, **Install from VSIX...**, then pick the file.
3. Run **Bifrost Meter: Set Virtual Key** from the Command Palette and paste your key.
4. If your gateway is not at `http://localhost:8080`, run **Bifrost Meter: Set Gateway URL**.

The status bar item on the right now shows how much of the closest limit is used. Click it for the details panel.

## Build the .vsix yourself

Requires Node.js 22.

```
npm ci
npm run package
```

This writes `bifrost-meter.vsix` in the repository root. `npm run gate` runs lint, type checks, unit tests and the
package step together.

## Try it without your own gateway

The `demo/` folder starts a pinned Bifrost gateway with a mock upstream and two demo keys. No provider account and no
paid API call is needed. See [demo/README.md](../demo/README.md).

## Without a UI to type a secret

On machines where the editor cannot show an input box (some remote setups), set these environment variables for the editor
process instead:

- `BIFROST_VIRTUAL_KEY`: the virtual key. A key saved with Set Virtual Key always wins.
- `BIFROST_BASE_URL`: the gateway address. The `bifrostMeter.baseUrl` setting wins when you set it.

## Uninstall

Run **Bifrost Meter: Clear Virtual Key** first so the key is removed from the editor's secret storage, then uninstall the
extension from the Extensions view.
