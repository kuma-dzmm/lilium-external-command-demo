# Lilium External Command Demo

Cloudflare Worker demo for a Lilium stateless external command.

The first command is `/calc`: Lilium sends a signed `command.invoke` envelope,
the Worker validates the request, evaluates the arithmetic expression from
`command.args`, and returns a `command.result` with a `reply` effect.

## Supported Expressions

- Operators: `+`, `-`, `*`, `/`, `%`, `^`
- Parentheses
- Unary `+` / `-`
- Decimal and scientific notation numbers

The Worker uses a small parser instead of JavaScript `eval`.

## Local Development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Set `LILIUM_SHARED_SECRET` in `.dev.vars` to the same value configured in
Lilium bot config.

## Lilium Bot Config

```yaml
external_commands:
  calc:
    name: /calc
    description: 计算表达式
    help_text: |
      ## /calc

      **用法**
      - `/calc 1 + 2 * (3 + 4)`

      计算一个算术表达式并返回结果。
    aliases: []
    hidden: false
    admin_only: false
    group: 外部命令
    room_types: null
    llm_note: |
      外部无状态计算器命令。参数是算术表达式，第三方 Worker 返回 reply effect。
    acl_denied_message: null
    acl_denied_invite: null
    subcommands: []

    external:
      mode: stateless
      endpoint: https://calc-demo.kuma.homes/api/lilium/external-commands/v1/calc/invoke
      timeout_ms: 30000
      shared_secret: "replace-with-the-same-secret-used-by-worker"
```

## Deploy

Push `main` to deploy through the Cloudflare-connected repository. Use
`npx wrangler secret put LILIUM_SHARED_SECRET` only when rotating the Worker
secret.

`LILIUM_COMMAND_CONFIG_ID` defaults to `calc` in `wrangler.jsonc`.

## Verification

```bash
npm run check
```

This regenerates Worker binding types, runs TypeScript checks, runs unit tests,
and validates the Wrangler config.
