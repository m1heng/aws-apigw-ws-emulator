import http from 'http';
import { URL } from 'url';
import { WebSocket } from 'ws';
import { AWSWebSocketGateway } from '../../src/server';
import { AWSWebSocketEvent, GatewayConfig, IntegrationMode } from '../../src/types';

const GATEWAY_PORT = 13001;
const BACKEND_PORT = 13002;

export interface ReceivedEvent {
  routeKey: string;
  event: AWSWebSocketEvent;
  timestamp: Date;
}

/**
 * HTTP mode event - connectionId in headers, params in URL
 */
export interface HttpModeEvent {
  connectionId: string;
  eventType: string;
  routeKey: string;
  queryParams: Record<string, string>;
  body: string | null;
  headers: Record<string, string>;
}

export interface ReceivedHttpEvent {
  routeKey: string;
  event: HttpModeEvent;
  timestamp: Date;
}

export class MockBackend {
  private server: http.Server | null = null;
  public receivedEvents: ReceivedEvent[] = [];
  private connectStatusCode = 200;
  private eventWaiters: Map<string, (event: AWSWebSocketEvent) => void> = new Map();

  async start(port: number = BACKEND_PORT): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const event: AWSWebSocketEvent = JSON.parse(body);
            const routeKey = event.requestContext.routeKey;

            this.receivedEvents.push({
              routeKey,
              event,
              timestamp: new Date(),
            });

            // Notify waiters
            const waiter = this.eventWaiters.get(routeKey);
            if (waiter) {
              waiter(event);
              this.eventWaiters.delete(routeKey);
            }

            // Check if $connect should fail
            if (routeKey === '$connect' && this.connectStatusCode !== 200) {
              res.writeHead(this.connectStatusCode);
              res.end();
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ statusCode: 200 }));
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      });

      this.server.listen(port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  setConnectResponse(statusCode: number): void {
    this.connectStatusCode = statusCode;
  }

  resetConnectResponse(): void {
    this.connectStatusCode = 200;
  }

  getLastEvent(): AWSWebSocketEvent | undefined {
    return this.receivedEvents[this.receivedEvents.length - 1]?.event;
  }

  getEventsByRoute(routeKey: string): AWSWebSocketEvent[] {
    return this.receivedEvents
      .filter((e) => e.routeKey === routeKey)
      .map((e) => e.event);
  }

  waitForEvent(routeKey: string, timeout = 5000): Promise<AWSWebSocketEvent> {
    const startCount = this.getEventsByRoute(routeKey).length;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters.delete(routeKey);
        reject(new Error(`Timeout waiting for event: ${routeKey}`));
      }, timeout);

      // Poll for new events
      const checkInterval = setInterval(() => {
        const events = this.getEventsByRoute(routeKey);
        if (events.length > startCount) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          resolve(events[events.length - 1]);
        }
      }, 10);

      this.eventWaiters.set(routeKey, (event) => {
        clearInterval(checkInterval);
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  clear(): void {
    this.receivedEvents = [];
    this.connectStatusCode = 200;
    this.eventWaiters.clear();
  }
}

export class TestContext {
  public gateway: AWSWebSocketGateway | null = null;
  public backend: MockBackend;
  public gatewayPort: number;
  public backendPort: number;

  constructor(gatewayPort = GATEWAY_PORT, backendPort = BACKEND_PORT) {
    this.backend = new MockBackend();
    this.gatewayPort = gatewayPort;
    this.backendPort = backendPort;
  }

  async setup(configOverrides: Partial<GatewayConfig> = {}): Promise<void> {
    await this.backend.start(this.backendPort);

    this.gateway = new AWSWebSocketGateway({
      port: this.gatewayPort,
      stage: 'test',
      apiId: 'testapi',
      routes: {
        $connect: { uri: `http://localhost:${this.backendPort}/connect` },
        $disconnect: { uri: `http://localhost:${this.backendPort}/disconnect` },
        $default: { uri: `http://localhost:${this.backendPort}/default` },
      },
      idleTimeout: 600,
      hardTimeout: 7200,
      verbose: false,
      ...configOverrides,
    });

    await this.gateway.start();
  }

  async teardown(): Promise<void> {
    if (this.gateway) {
      await this.gateway.stop();
    }
    await this.backend.stop();
  }

  async createConnection(queryParams?: Record<string, string>): Promise<WebSocket> {
    const query = queryParams
      ? '?' + new URLSearchParams(queryParams).toString()
      : '';

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${this.gatewayPort}${query}`);

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  async waitForClose(ws: WebSocket, timeout = 5000): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for close'));
      }, timeout);

      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  get wsUrl(): string {
    return `ws://localhost:${this.gatewayPort}`;
  }

  get httpUrl(): string {
    return `http://localhost:${this.gatewayPort}`;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock backend for HTTP integration mode
 * Receives connectionId in headers, queryParams in URL
 */
export class MockHttpBackend {
  private server: http.Server | null = null;
  public receivedEvents: ReceivedHttpEvent[] = [];
  private connectStatusCode = 200;
  private eventWaiters: Map<string, (event: HttpModeEvent) => void> = new Map();

  async start(port: number = BACKEND_PORT): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        // Parse query parameters
        const queryParams: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          queryParams[key] = value;
        });

        // Parse headers
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') {
            headers[key.toLowerCase()] = value;
          }
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const connectionId = headers['connectionid'] || '';
          const eventType = headers['x-event-type'] || '';
          const routeKey = headers['x-route-key'] || this.getRouteKeyFromPath(url.pathname);

          const event: HttpModeEvent = {
            connectionId,
            eventType,
            routeKey,
            queryParams,
            body: body || null,
            headers,
          };

          this.receivedEvents.push({
            routeKey,
            event,
            timestamp: new Date(),
          });

          // Notify waiters
          const waiter = this.eventWaiters.get(routeKey);
          if (waiter) {
            waiter(event);
            this.eventWaiters.delete(routeKey);
          }

          // Check if $connect should fail
          if (routeKey === '$connect' && this.connectStatusCode !== 200) {
            res.writeHead(this.connectStatusCode);
            res.end();
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ statusCode: 200 }));
        });
      });

      this.server.listen(port, () => resolve());
    });
  }

  private getRouteKeyFromPath(pathname: string): string {
    if (pathname.includes('connect') && !pathname.includes('disconnect')) {
      return '$connect';
    }
    if (pathname.includes('disconnect')) {
      return '$disconnect';
    }
    return '$default';
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  setConnectResponse(statusCode: number): void {
    this.connectStatusCode = statusCode;
  }

  resetConnectResponse(): void {
    this.connectStatusCode = 200;
  }

  getLastEvent(): HttpModeEvent | undefined {
    return this.receivedEvents[this.receivedEvents.length - 1]?.event;
  }

  getEventsByRoute(routeKey: string): HttpModeEvent[] {
    return this.receivedEvents
      .filter((e) => e.routeKey === routeKey)
      .map((e) => e.event);
  }

  waitForEvent(routeKey: string, timeout = 5000): Promise<HttpModeEvent> {
    const startCount = this.getEventsByRoute(routeKey).length;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters.delete(routeKey);
        reject(new Error(`Timeout waiting for event: ${routeKey}`));
      }, timeout);

      // Poll for new events
      const checkInterval = setInterval(() => {
        const events = this.getEventsByRoute(routeKey);
        if (events.length > startCount) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          resolve(events[events.length - 1]);
        }
      }, 10);

      this.eventWaiters.set(routeKey, (event) => {
        clearInterval(checkInterval);
        clearTimeout(timer);
        resolve(event);
      });
    });
  }

  clear(): void {
    this.receivedEvents = [];
    this.connectStatusCode = 200;
    this.eventWaiters.clear();
  }
}

/**
 * Test context for HTTP integration mode
 */
export class HttpTestContext {
  public gateway: AWSWebSocketGateway | null = null;
  public backend: MockHttpBackend;
  public gatewayPort: number;
  public backendPort: number;

  constructor(gatewayPort = GATEWAY_PORT, backendPort = BACKEND_PORT) {
    this.backend = new MockHttpBackend();
    this.gatewayPort = gatewayPort;
    this.backendPort = backendPort;
  }

  async setup(configOverrides: Partial<GatewayConfig> = {}): Promise<void> {
    await this.backend.start(this.backendPort);

    this.gateway = new AWSWebSocketGateway({
      port: this.gatewayPort,
      stage: 'test',
      apiId: 'testapi',
      integrationMode: 'http',
      routes: {
        $connect: { uri: `http://localhost:${this.backendPort}/connect` },
        $disconnect: { uri: `http://localhost:${this.backendPort}/disconnect` },
        $default: { uri: `http://localhost:${this.backendPort}/default` },
      },
      idleTimeout: 600,
      hardTimeout: 7200,
      verbose: false,
      ...configOverrides,
    });

    await this.gateway.start();
  }

  async teardown(): Promise<void> {
    if (this.gateway) {
      await this.gateway.stop();
    }
    await this.backend.stop();
  }

  async createConnection(queryParams?: Record<string, string>): Promise<WebSocket> {
    const query = queryParams
      ? '?' + new URLSearchParams(queryParams).toString()
      : '';

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${this.gatewayPort}${query}`);

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  async waitForClose(ws: WebSocket, timeout = 5000): Promise<{ code: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout waiting for close'));
      }, timeout);

      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  get wsUrl(): string {
    return `ws://localhost:${this.gatewayPort}`;
  }

  get httpUrl(): string {
    return `http://localhost:${this.gatewayPort}`;
  }
}
