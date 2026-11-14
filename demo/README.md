# Demo stack

A local stack for trying Bifrost Meter without a real model provider and without spending anything.

## What is real and what is mock

| Part | Real or mock |
|---|---|
| Bifrost gateway | **Real.** The official image, unmodified, pinned by digest in `docker-compose.yml`. |
| Virtual keys, budgets, rate limits, usage counting, the quota endpoint | **Real.** All done by the gateway itself. |
| Model replies | **Mock.** `mock-upstream/server.mjs` answers every chat request with a fixed text that starts with `[mock]` and a fixed token count. No real model is called and no API key is used. |
| Cost per request | Computed by the gateway from its own price list for the model name, using the mock token counts. |

## Run it

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

The traffic service sends chat requests through the gateway with the key named in `demo.config.json` (`traffic.keyName`).
When a budget or rate limit is reached, the gateway blocks the request and the traffic log shows it; that is expected.

To send a fixed number of requests from your own shell instead (Node 22):

```sh
BIFROST_URL=http://127.0.0.1:8080 BIFROST_SETUP_TOKEN=<your token> node traffic/traffic.mjs --requests 10 --interval 1
```

## Change the demo

Everything the demo creates is in `demo.config.json`: provider, model names, virtual key names, budgets
(`max_limit` in USD, `reset_duration` such as `1h` or `1d`), rate limits, and the traffic settings (key, model, interval,
number of requests; `0` means run until stopped). No code change is needed.

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
