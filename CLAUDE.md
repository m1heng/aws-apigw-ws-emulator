# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
pnpm build             # Compile TypeScript to dist/
pnpm dev               # Run CLI directly with ts-node
pnpm start             # Run compiled CLI
pnpm test              # Run all e2e tests (61 tests)
pnpm test:watch        # Run tests in watch mode
```

Run a single test file:
```bash
pnpm vitest run tests/e2e/connection.test.ts
```

Run tests matching a pattern:
```bash
pnpm vitest run -t "should route to custom route"
```

## Architecture

Local emulator for AWS API Gateway WebSocket with HTTP integration. Forwards WebSocket events ($connect, $disconnect, $default, custom routes) as HTTP POST to backend services.

### Core Files

- **`src/server.ts`** - `AWSWebSocketGateway` class: WebSocket server + HTTP management API in single http.Server
- **`src/cli.ts`** - CLI entry point with Commander, loads YAML/JSON config
- **`src/types.ts`** - `GatewayConfig`, `AWSWebSocketEvent`, `AWSRequestContext` types with AWS-conformant fields
- **`src/logger.ts`** - Colored console output with verbose mode
- **`src/index.ts`** - Public exports for programmatic usage

### Request Flow

1. Client connects via WebSocket → gateway POSTs `$connect` event to backend
2. Client sends message → gateway routes to `$default` or custom route (via `routeSelectionExpression`)
3. Client disconnects → gateway POSTs `$disconnect` event
4. Backend calls `POST /@connections/{id}` → gateway forwards to WebSocket client

### AWS Event Format

Events sent to backend conform to AWS API Gateway WebSocket format:
- `requestContext.messageDirection`: always `'IN'`
- `requestContext.requestTime`: format `DD/Mon/YYYY:HH:MM:SS +0000`
- `multiValueHeaders`: required field (each header as single-element array)
- `queryStringParameters`: `null` when no params (not empty object)
- `body`: `null` for $connect/$disconnect, string for messages

### Route Selection

When `routeSelectionExpression` is set (e.g., `$request.body.action`):
1. Parse message as JSON
2. Extract value at path (supports nested: `$request.body.data.type`)
3. If route exists for that value, use it; otherwise fallback to `$default`

### Timeout Management

- **Idle timeout**: resets on message received or postToConnection
- **Hard timeout**: never resets, absolute connection lifetime
- Both use `setTimeout` stored in `timeoutTimers` Map with `{connectionId}:idle` and `{connectionId}:hard` keys

## Test Infrastructure

Tests in `tests/e2e/` use unique port ranges to avoid conflicts:
- `aws-conformance.test.ts`: 14001-14002
- `connection.test.ts`: 14003-14004
- `management-api.test.ts`: 14005-14006
- `routes.test.ts`: 14007-14012
- `timeout.test.ts`: 14013-14016
- `edge-cases.test.ts`: 14017-14020

Key test utilities in `tests/e2e/setup.ts`:
- `MockBackend`: HTTP server that captures AWS events, supports `waitForEvent()` for async assertions
- `TestContext`: manages gateway + backend lifecycle, provides `createConnection()` helper
- `sleep()`: delay helper for timing-sensitive tests

Tests run sequentially (`fileParallelism: false` in vitest.config.ts) to avoid port conflicts.
