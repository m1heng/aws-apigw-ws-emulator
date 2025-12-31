# AWS WebSocket Gateway Local

A lightweight local emulator for **AWS API Gateway WebSocket** with HTTP integration support.

[![npm version](https://img.shields.io/npm/v/aws-apigw-ws-emulator.svg)](https://www.npmjs.com/package/aws-apigw-ws-emulator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

AWS API Gateway WebSocket supports HTTP integration, allowing you to route WebSocket events to your HTTP backend. However, there's no good open-source solution for local development:

- **LocalStack**: WebSocket support requires Pro (paid) version
- **serverless-offline**: Only supports Lambda integration, not HTTP

This tool fills that gap - a simple, standalone emulator that:
- Accepts WebSocket connections from your frontend
- Forwards `$connect`, `$disconnect`, `$default` events to your HTTP backend
- Provides `/@connections/{connectionId}` endpoint for `postToConnection`

## Quick Start

### Using npx (no installation)

```bash
npx aws-apigw-ws-emulator --backend http://localhost:8080
```

### Using npm

```bash
npm install -g aws-apigw-ws-emulator
aws-apigw-ws-emulator --backend http://localhost:8080
```

### Using Docker

```bash
docker run -p 3001:3001 m1heng/aws-apigw-ws-emulator --backend http://host.docker.internal:8080
```

## Architecture

```
┌──────────────┐     WebSocket      ┌─────────────────────┐     HTTP POST      ┌──────────────────┐
│   Frontend   │◄──────────────────►│  aws-ws-gateway-    │───────────────────►│   Your Backend   │
│              │  ws://localhost    │  local (:3001)      │                    │   (:8080)        │
│              │  :3001?token=...   │                     │  /api/.../connect  │                  │
└──────────────┘                    └──────────┬──────────┘  /api/.../default  └────────┬─────────┘
       ▲                                       │             /api/.../disconnect        │
       │                                       │                                        │
       │                                       │◄───────────────────────────────────────┘
       │                                       │  POST /@connections/{connectionId}
       └───────────────────────────────────────┘  (postToConnection)
```

## Usage

### CLI Options

```bash
aws-apigw-ws-emulator [options]

Options:
  -p, --port <port>              WebSocket server port (default: 3001)
  -s, --stage <stage>            API stage name (default: local)
  --idle-timeout <seconds>       Idle timeout in seconds (default: 600)
  --hard-timeout <seconds>       Hard timeout in seconds (default: 7200)
  -c, --config <file>            Config file (YAML or JSON)
  -v, --verbose                  Enable verbose logging
  -h, --help                     Display help
```

### Config File

Create `gateway.config.yaml`:

```yaml
port: 3001
stage: local

routes:
  $connect:
    uri: http://localhost:8080/ws/connect
  $disconnect:
    uri: http://localhost:8080/ws/disconnect
  $default:
    uri: http://localhost:8080/ws/default

idleTimeout: 600
hardTimeout: 7200
verbose: false
```

Run with config:

```bash
aws-apigw-ws-emulator -c gateway.config.yaml
```

## Integration Guide

### Backend Requirements

Your backend receives AWS Lambda-style WebSocket events via HTTP POST:

```typescript
interface AWSWebSocketEvent {
  requestContext: {
    routeKey: '$connect' | '$disconnect' | '$default' | string;
    eventType: 'CONNECT' | 'DISCONNECT' | 'MESSAGE';
    connectionId: string;
    connectedAt: number;
    domainName: string;
    stage: string;
    apiId: string;
    requestId: string;
    identity: { sourceIp: string; userAgent?: string };
    // MESSAGE only
    messageId?: string;
    // DISCONNECT only
    disconnectStatusCode?: number;
    disconnectReason?: string;
  };
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string> | null;
  body: string | null;
  isBase64Encoded: boolean;
}
```

Example request to your `$connect` endpoint:

```json
{
  "requestContext": {
    "routeKey": "$connect",
    "eventType": "CONNECT",
    "connectionId": "abc123xyz456=",
    "connectedAt": 1704067200000,
    "domainName": "localhost:3001",
    "stage": "local",
    "apiId": "local",
    "requestId": "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
    "identity": { "sourceIp": "127.0.0.1", "userAgent": "..." }
  },
  "headers": { "origin": "http://localhost:3000", ... },
  "queryStringParameters": { "token": "xxx", "conversationId": "123" },
  "body": null,
  "isBase64Encoded": false
}
```

### Sending Messages to Clients (postToConnection)

Use the Management API to send messages back to clients:

```bash
# Using curl
curl -X POST http://localhost:3001/@connections/{connectionId} \
  -H "Content-Type: application/json" \
  -d '{"type": "message", "data": "Hello!"}'
```

```java
// Using AWS SDK (Java)
ApiGatewayManagementApiClient client = ApiGatewayManagementApiClient.builder()
    .endpointOverride(URI.create("http://localhost:3001"))
    .region(Region.US_WEST_1)
    .credentialsProvider(StaticCredentialsProvider.create(
        AwsBasicCredentials.create("test", "test")))
    .build();

client.postToConnection(PostToConnectionRequest.builder()
    .connectionId(connectionId)
    .data(SdkBytes.fromUtf8String("{\"message\": \"Hello!\"}"))
    .build());
```

```javascript
// Using AWS SDK (JavaScript)
const client = new ApiGatewayManagementApiClient({
  endpoint: 'http://localhost:3001',
  region: 'us-west-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

await client.send(new PostToConnectionCommand({
  ConnectionId: connectionId,
  Data: Buffer.from(JSON.stringify({ message: 'Hello!' })),
}));
```

### Frontend Connection

```javascript
// Same code works for both local and production!
const wsUrl = process.env.NEXT_PUBLIC_WS_URL; // ws://localhost:3001 or wss://xxx.amazonaws.com

const ws = new WebSocket(`${wsUrl}?token=${token}&conversationId=${conversationId}`);

ws.onmessage = (event) => {
  console.log('Received:', event.data);
};
```

### Environment Configuration

Use the same codebase for local and production:

```yaml
# application.yml (Spring Boot)
aws:
  apigateway:
    callback: ${AWS_APIGATEWAY_CALLBACK:https://xxx.execute-api.us-west-1.amazonaws.com/prod}
```

```bash
# Local development
AWS_APIGATEWAY_CALLBACK=http://localhost:3001 ./mvnw spring-boot:run

# Production
AWS_APIGATEWAY_CALLBACK=https://xxx.execute-api.us-west-1.amazonaws.com/prod java -jar app.jar
```

## API Reference

### Management API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/@connections/{connectionId}` | Send message to connection (postToConnection) |
| GET | `/@connections/{connectionId}` | Get connection info |
| DELETE | `/@connections/{connectionId}` | Close connection |
| GET | `/health` | Health check |

### Health Check Response

```json
{
  "status": "ok",
  "connections": 5,
  "uptime": 3600.123
}
```

## Comparison with Alternatives

| Feature | aws-apigw-ws-emulator | LocalStack | serverless-offline |
|---------|---------------------|------------|-------------------|
| HTTP Integration | ✅ | ✅ (Pro only) | ❌ |
| Lambda Integration | ❌ | ✅ | ✅ |
| Free | ✅ | ❌ ($35/mo) | ✅ |
| Standalone | ✅ | ✅ | ❌ (needs SF) |
| postToConnection | ✅ | ✅ | ✅ |
| Easy Setup | ✅ One command | ⚠️ Complex | ⚠️ Complex |

## Programmatic Usage

```typescript
import { AWSWebSocketGateway } from 'aws-apigw-ws-emulator';

const gateway = new AWSWebSocketGateway({
  port: 3001,
  routes: {
    $connect: { uri: 'http://localhost:8080/ws/connect' },
    $disconnect: { uri: 'http://localhost:8080/ws/disconnect' },
    $default: { uri: 'http://localhost:8080/ws/default' },
  },
  verbose: true,
});

await gateway.start();

// Get connection count
console.log(`Active connections: ${gateway.getConnectionCount()}`);

// Graceful shutdown
await gateway.stop();
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.
