# Demo stack

A local stack for trying Bifrost Meter without a real model provider and without spending anything.

## What is real and what is mock

| Part | Real or mock |
|---|---|
| Bifrost gateway | **Real.** The official image, unmodified, pinned by digest in `docker-compose.yml`. |
| Virtual keys, budgets, rate limits, usage counting, the quota endpoint | **Real.** All done by the gateway itself. |
| Model replies | **Mock.** `mock-upstream/server.mjs` answers every chat request with a fixed text that starts with `[mock]` and a fixed token count. No real model is called and no API key is used. |
| Cost per request | Computed by the gateway from its own price list for the model name, using the mock token counts. |

## One command

```sh
demo/run.sh          # from the repository root; needs Docker only
```

This creates `demo/.env` with a random setup token if it does not exist, starts the gateway, the mock upstream, the demo keys,
steady mock traffic and code-server with Bifrost Meter installed, then prints the editor link (`http://127.0.0.1:8443/` by
default). Open it: the meter is already in the status bar, because the editor gets the demo key and the gateway URL through
its environment (`BIFROST_VIRTUAL_KEY`, `BIFROST_BASE_URL`), and a short note on what to look at opens in the editor
(`editor-welcome.md`).

The one-command demo seeds from `run.config.json`, not `demo.config.json`. Its traffic key has a budget of $1.00 that
resets every 5 minutes, and the mock upstream reports 3,000 prompt and 2,000 completion tokens per call, so one cycle shows
every state: OK, the warning at 75%, critical at 90%, "Budget used up" while the gateway refuses requests, then the reset. The first run builds the extension in a Node 22 container;
set `BIFROST_METER_VSIX` to use a package you already have. Ports are `BIFROST_PORT` and `CODE_SERVER_PORT` in `demo/.env`,
and the editor settings are in `editor-settings.json`. Every port is bound to `127.0.0.1` only. When a port is taken (8080
usually is on a machine that already runs Bifrost), the script uses the next free one and prints it. The first run
downloads about 550 MB of images. If the start fails half way, the script removes what it started.

`demo/run.sh stop` removes every container and all gateway data.

## Run it step by step

You need Docker with the compose plugin.

```sh
cd demo
cp .env.example .env              # then set BIFROST_SETUP_TOKEN, for example: openssl rand -hex 24
docker compose up -d              # gateway + mock upstream + one-shot seed
docker compose logs bifrost-meter-seed   # prints the two demo virtual keys
```

The seed waits for the gateway, points the `openai` provider at the mock upstream, and creates the virtual keys listed in
`demo.config.json` with their budgets and rate limits. Running it again reuses keys with the same name.

Then in VS Code: install the `.vsix`, run **Bifrost Meter: Set Virtual Key**, paste one of the demo keys, and set
`bifrostMeter.baseUrl` to `http://127.0.0.1:8080` (or the port you chose in `BIFROST_PORT`).

The gateway listens on `127.0.0.1` only. The demo keys are created fresh on every new stack and only work against it.

## Make the meter move

```sh
docker compose --profile traffic up -d   # one mock request every few seconds through a demo key
```

The traffic service sends chat requests through the gateway with the key named in `demo.config.json` (`traffic.keyName`),
rotating over the provider models so the spend per model has more than one row.
When a budget or rate limit is reached, the gateway blocks the request and the traffic log shows it; that is expected.

To send a fixed number of requests from your own shell instead (Node 22):

```sh
BIFROST_URL=http://127.0.0.1:8080 BIFROST_SETUP_TOKEN=<your token> node traffic/traffic.mjs --requests 10 --interval 1
```

## Change the demo

Everything the demo creates is in `demo.config.json` (`run.config.json` for `demo/run.sh`): provider, model names, virtual
key names, budgets (`max_limit` in USD, `reset_duration` such as `5m`, `1h` or `1d`), rate limits, and the traffic settings
(key, optional `models` list, interval, number of requests; `0` means run until stopped). `run.config.json` also sets the
token counts the mock upstream reports. No code change is needed.

## Record the demo video

```sh
npm run record:demo
```

This starts the same stack with code-server and the packaged extension, seeds one key from `recording.config.json`
(a small budget, so a few dozen mock requests move it from OK to warning to used up), records the editor in a headless browser,
then cuts the scenes and burns in the captions with ffmpeg. Scenes are cut, never sped up, and every number on screen comes
from the running gateway. Scene order, lengths, captions, zoom areas and the GIF slice are in `recording.config.json`.
The agent scene is drawn from `agent-session.json`, one recorded session of a coding agent calling the MCP tool. Narration
is optional: the released video carries an AI clone of the author's voice, and those audio files are not in the repository.
Output: `out/recording/bifrost-meter-demo.mp4` (1920x1080, silent without narration files), `docs/images/hero.gif` and three screenshots
(`docs/images/demo-ok.png`, `demo-warning.png`, `demo-exhausted.png`). Needs Docker and ffmpeg; it takes about ten minutes.

## Stop and clean up

```sh
docker compose --profile traffic down -v
```

All gateway data lives in a temporary filesystem inside the container, so this removes every key and counter.

## Use a real provider instead

The extension does not care where replies come from; it only reads the quota endpoint. To use your own provider key, point
Bifrost Meter at a Bifrost gateway where the provider is configured with your key (for example through the gateway's own
web interface or API), create a virtual key with a budget there, and paste that key into the extension. Real requests then
cost real money on your provider account, so set a budget you are comfortable with.
