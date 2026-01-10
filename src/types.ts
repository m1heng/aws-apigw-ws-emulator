import { WebSocket } from 'ws';

// ============================================================================
// AWS WebSocket Event Types
// ============================================================================

export interface AWSIdentity {
  sourceIp: string;
  userAgent?: string;
}

export interface AWSRequestContext {
  routeKey: string;
  eventType: 'CONNECT' | 'DISCONNECT' | 'MESSAGE';
  extendedRequestId: string;
  requestTime: string;
  messageDirection: 'IN';
  stage: string;
  connectedAt: number;
  requestTimeEpoch: number;
  identity: AWSIdentity;
  requestId: string;
  domainName: string;
  connectionId: string;
  apiId: string;
  // MESSAGE only
  messageId?: string;
  // DISCONNECT only
  disconnectStatusCode?: number;
  disconnectReason?: string;
}

export interface AWSWebSocketEvent {
  requestContext: AWSRequestContext;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
  isBase64Encoded: boolean;
}

// ============================================================================
// Gateway Configuration Types
// ============================================================================

/**
 * Integration mode for backend communication:
 * - 'lambda_proxy': Send full AWS Lambda event as JSON body (default)
 *   - connectionId in body.requestContext.connectionId
 *   - Suitable for Lambda-style backends
 *
 * - 'http': Send connectionId and context in HTTP headers
 *   - connectionId in header 'connectionId'
 *   - queryStringParameters forwarded as URL params
 *   - Message body sent directly (not wrapped)
 *   - Suitable for traditional HTTP backends
 */
export type IntegrationMode = 'lambda_proxy' | 'http';

export interface RouteIntegration {
  uri: string;
}

export interface GatewayConfig {
  port: number;
  stage: string;
  apiId: string;
  domainName: string;
  integrationMode: IntegrationMode;
  routeSelectionExpression?: string;
  routes: Record<string, RouteIntegration>;
  idleTimeout: number;
  hardTimeout: number;
  verbose: boolean;
}

export const DEFAULT_CONFIG: GatewayConfig = {
  port: 3001,
  stage: 'local',
  apiId: 'local',
  domainName: '',
  integrationMode: 'lambda_proxy',
  routes: {
    $connect: { uri: 'http://localhost:8080/ws/connect' },
    $disconnect: { uri: 'http://localhost:8080/ws/disconnect' },
    $default: { uri: 'http://localhost:8080/ws/default' },
  },
  idleTimeout: 600,
  hardTimeout: 7200,
  verbose: false,
};

// ============================================================================
// Connection Types
// ============================================================================

export interface Connection {
  id: string;
  ws: WebSocket;
  connectedAt: Date;
  lastActivityAt: Date;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  sourceIp: string;
  userAgent: string;
}
