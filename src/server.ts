import http from 'http';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GatewayConfig,
  Connection,
  AWSWebSocketEvent,
  AWSRequestContext,
  DEFAULT_CONFIG,
} from './types';
import { logger } from './logger';

interface DisconnectOptions {
  disconnectStatusCode: number;
  disconnectReason: string;
}

export class AWSWebSocketGateway {
  private config: GatewayConfig;
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private connections: Map<string, Connection> = new Map();
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Set domainName if not specified
    if (!this.config.domainName) {
      this.config.domainName = `localhost:${this.config.port}`;
    }
    logger.setVerbose(this.config.verbose);

    this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', this.handleConnection.bind(this));
  }

  // ============================================================================
  // HTTP Request Handling (Management API)
  // ============================================================================

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const method = req.method || 'GET';

    // Health check
    if (method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          connections: this.connections.size,
          uptime: process.uptime(),
        })
      );
      logger.http('GET', '/health', 200);
      return;
    }

    // Management API: /@connections/{connectionId}
    const match = url.pathname.match(/^\/@connections\/(.+)$/);
    if (match) {
      const connectionId = decodeURIComponent(match[1]);
      this.handleManagementApi(method, connectionId, req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not Found' }));
    logger.http(method, url.pathname, 404);
  }

  private handleManagementApi(
    method: string,
    connectionId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const connection = this.connections.get(connectionId);

    // GET - Get connection info
    if (method === 'GET') {
      if (connection) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            connectionId,
            connectedAt: connection.connectedAt.toISOString(),
            lastActiveAt: connection.lastActivityAt.toISOString(),
          })
        );
        logger.http('GET', `/@connections/${connectionId}`, 200);
      } else {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Gone', connectionId }));
        logger.http('GET', `/@connections/${connectionId}`, 410);
      }
      return;
    }

    // DELETE - Close connection
    if (method === 'DELETE') {
      if (connection && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close(1000, 'Closed by management API');
        res.writeHead(204);
        res.end();
        logger.http('DELETE', `/@connections/${connectionId}`, 204);
      } else {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Gone', connectionId }));
        logger.http('DELETE', `/@connections/${connectionId}`, 410);
      }
      return;
    }

    // POST - Send message (postToConnection)
    if (method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.send(body);
          connection.lastActivityAt = new Date();
          res.writeHead(200);
          res.end();
          logger.http('POST', `/@connections/${connectionId}`, 200);
          logger.debug(`Sent ${body.length} bytes to ${connectionId}`);
        } else {
          res.writeHead(410, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Gone', connectionId }));
          logger.http('POST', `/@connections/${connectionId}`, 410);
        }
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Method Not Allowed' }));
    logger.http(method, `/@connections/${connectionId}`, 405);
  }

  // ============================================================================
  // WebSocket Connection Handling
  // ============================================================================

  private handleConnection(ws: WebSocket, req: http.IncomingMessage) {
    const url = new URL(req.url || '/', `http://localhost:${this.config.port}`);
    const connectionId = this.generateConnectionId();

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
      } else if (Array.isArray(value)) {
        headers[key.toLowerCase()] = value[0];
      }
    }

    // Extract client info
    const sourceIp = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || '';

    const connection: Connection = {
      id: connectionId,
      ws,
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      queryParams,
      headers,
      sourceIp,
      userAgent,
    };

    this.connections.set(connectionId, connection);
    this.setupTimeouts(connectionId);

    logger.ws('CONNECT', connectionId, `ip: ${sourceIp}`);

    // Call $connect route
    this.callBackend('$connect', connection, null).then((success) => {
      if (!success) {
        logger.warn(`$connect callback failed for ${connectionId}, closing connection`);
        ws.close(1011, 'Backend connect failed');
      }
    });

    // Handle messages
    ws.on('message', (data) => {
      const message = data.toString();
      connection.lastActivityAt = new Date();
      this.resetIdleTimeout(connectionId);

      logger.ws(
        'MESSAGE',
        connectionId,
        `${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`
      );

      // Route selection (P2: custom routes)
      const routeKey = this.selectRoute(message);
      this.callBackend(routeKey, connection, message);
    });

    // Handle close
    ws.on('close', (code, reason) => {
      const reasonStr = reason.toString();
      logger.ws('DISCONNECT', connectionId, `code: ${code}`);

      this.callBackend('$disconnect', connection, null, {
        disconnectStatusCode: code,
        disconnectReason: reasonStr,
      });

      this.clearTimeouts(connectionId);
      this.connections.delete(connectionId);
    });

    // Handle error
    ws.on('error', (error) => {
      logger.error(`WebSocket error for ${connectionId}:`, error.message);
    });
  }

  // ============================================================================
  // Route Selection (P2)
  // ============================================================================

  private selectRoute(message: string): string {
    if (!this.config.routeSelectionExpression) {
      return '$default';
    }

    try {
      const parsed = JSON.parse(message);
      const match = this.config.routeSelectionExpression.match(/^\$request\.body\.(.+)$/);
      if (match) {
        const path = match[1].split('.');
        let value: unknown = parsed;
        for (const key of path) {
          if (value && typeof value === 'object' && key in value) {
            value = (value as Record<string, unknown>)[key];
          } else {
            return '$default';
          }
        }
        if (typeof value === 'string' && this.config.routes[value]) {
          return value;
        }
      }
    } catch {
      // Non-JSON message, use $default
    }

    return '$default';
  }

  // ============================================================================
  // AWS Event Building
  // ============================================================================

  private buildRequestContext(
    connection: Connection,
    routeKey: string,
    eventType: 'CONNECT' | 'DISCONNECT' | 'MESSAGE',
    options?: DisconnectOptions & { messageId?: string }
  ): AWSRequestContext {
    const now = new Date();
    const requestId = this.generateRequestId();

    const context: AWSRequestContext = {
      routeKey,
      eventType,
      extendedRequestId: requestId,
      requestTime: this.formatRequestTime(now),
      messageDirection: 'IN',
      stage: this.config.stage,
      connectedAt: connection.connectedAt.getTime(),
      requestTimeEpoch: now.getTime(),
      identity: {
        sourceIp: connection.sourceIp,
        userAgent: connection.userAgent,
      },
      requestId,
      domainName: this.config.domainName,
      connectionId: connection.id,
      apiId: this.config.apiId,
    };

    // MESSAGE-specific fields
    if (eventType === 'MESSAGE') {
      context.messageId = options?.messageId || this.generateMessageId();
    }

    // DISCONNECT-specific fields
    if (eventType === 'DISCONNECT' && options) {
      context.disconnectStatusCode = options.disconnectStatusCode;
      context.disconnectReason = options.disconnectReason;
    }

    return context;
  }

  private buildMultiValueHeaders(headers: Record<string, string>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = [value];
    }
    return result;
  }

  private buildLambdaEvent(
    connection: Connection,
    routeKey: string,
    eventType: 'CONNECT' | 'DISCONNECT' | 'MESSAGE',
    body: string | null,
    options?: DisconnectOptions
  ): AWSWebSocketEvent {
    return {
      requestContext: this.buildRequestContext(connection, routeKey, eventType, options),
      headers: connection.headers,
      multiValueHeaders: this.buildMultiValueHeaders(connection.headers),
      queryStringParameters:
        Object.keys(connection.queryParams).length > 0 ? connection.queryParams : null,
      body,
      isBase64Encoded: false,
    };
  }

  private formatRequestTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    return (
      `${pad(date.getUTCDate())}/${months[date.getUTCMonth()]}/${date.getUTCFullYear()}:` +
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
    );
  }

  // ============================================================================
  // Backend Communication
  // ============================================================================

  private async callBackend(
    routeKey: string,
    connection: Connection,
    body: string | null,
    disconnectOptions?: DisconnectOptions
  ): Promise<boolean> {
    // Get event type from route key
    const eventType = this.getEventType(routeKey);

    // Get route integration
    const integration = this.config.routes[routeKey] || this.config.routes['$default'];
    if (!integration) {
      logger.warn(`No integration found for route: ${routeKey}`);
      return false;
    }

    // Build AWS Lambda event
    const event = this.buildLambdaEvent(
      connection,
      routeKey,
      eventType,
      body,
      disconnectOptions
    );

    try {
      const response = await fetch(integration.uri, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      logger.debug(`${routeKey} callback: ${response.status}`);
      return response.ok;
    } catch (error) {
      logger.error(`${routeKey} callback failed:`, (error as Error).message);
      return false;
    }
  }

  private getEventType(routeKey: string): 'CONNECT' | 'DISCONNECT' | 'MESSAGE' {
    switch (routeKey) {
      case '$connect':
        return 'CONNECT';
      case '$disconnect':
        return 'DISCONNECT';
      default:
        return 'MESSAGE';
    }
  }

  // ============================================================================
  // Timeout Management
  // ============================================================================

  private setupTimeouts(connectionId: string) {
    this.resetIdleTimeout(connectionId);

    // Hard timeout
    const hardTimer = setTimeout(() => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        logger.warn(`Hard timeout reached for ${connectionId}`);
        connection.ws.close(1001, 'Hard timeout');
      }
    }, this.config.hardTimeout * 1000);

    this.timeoutTimers.set(`${connectionId}:hard`, hardTimer);
  }

  private resetIdleTimeout(connectionId: string) {
    const idleKey = `${connectionId}:idle`;
    const existingTimer = this.timeoutTimers.get(idleKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const idleTimer = setTimeout(() => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        logger.warn(`Idle timeout reached for ${connectionId}`);
        connection.ws.close(1001, 'Idle timeout');
      }
    }, this.config.idleTimeout * 1000);

    this.timeoutTimers.set(idleKey, idleTimer);
  }

  private clearTimeouts(connectionId: string) {
    const idleTimer = this.timeoutTimers.get(`${connectionId}:idle`);
    const hardTimer = this.timeoutTimers.get(`${connectionId}:hard`);
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    this.timeoutTimers.delete(`${connectionId}:idle`);
    this.timeoutTimers.delete(`${connectionId}:hard`);
  }

  // ============================================================================
  // ID Generation
  // ============================================================================

  private generateConnectionId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result + '=';
  }

  private generateRequestId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private generateMessageId(): string {
    return this.generateConnectionId();
  }

  // ============================================================================
  // Server Lifecycle
  // ============================================================================

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, () => {
        logger.banner({
          port: this.config.port,
          stage: this.config.stage,
        });
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.connections.forEach((connection) => {
        connection.ws.close(1001, 'Server shutting down');
      });
      this.connections.clear();

      this.timeoutTimers.forEach((timer) => clearTimeout(timer));
      this.timeoutTimers.clear();

      this.wss.close(() => {
        this.httpServer.close(() => {
          logger.info('Server stopped');
          resolve();
        });
      });
    });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
