import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('Management API', () => {
  const ctx = new TestContext(14005, 14006);

  beforeAll(async () => {
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(() => {
    ctx.backend.clear();
  });

  describe('POST /@connections/{id} (postToConnection)', () => {
    it('should send message to connected client', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.requestContext.connectionId;

      // Collect messages from client
      const receivedMessages: string[] = [];
      ws.on('message', (data) => receivedMessages.push(data.toString()));

      // Send via management API
      const response = await fetch(
        `${ctx.httpUrl}/@connections/${connectionId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'greeting', message: 'Hello!' }),
        }
      );

      expect(response.status).toBe(200);

      await sleep(100);
      expect(receivedMessages.length).toBe(1);
      expect(JSON.parse(receivedMessages[0])).toEqual({
        type: 'greeting',
        message: 'Hello!',
      });

      ws.close();
    });

    it('should return 410 Gone for non-existent connection', async () => {
      const response = await fetch(
        `${ctx.httpUrl}/@connections/nonexistent123=`,
        {
          method: 'POST',
          body: 'test',
        }
      );

      expect(response.status).toBe(410);
      const body = await response.json();
      expect(body.message).toBe('Gone');
    });

    it('should return 410 Gone after connection closes', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.requestContext.connectionId;

      ws.close();
      await sleep(100);

      const response = await fetch(
        `${ctx.httpUrl}/@connections/${connectionId}`,
        {
          method: 'POST',
          body: 'test',
        }
      );

      expect(response.status).toBe(410);
    });
  });

  describe('GET /@connections/{id}', () => {
    it('should return connection info', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.requestContext.connectionId;

      const response = await fetch(
        `${ctx.httpUrl}/@connections/${connectionId}`
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.connectionId).toBe(connectionId);
      expect(body.connectedAt).toBeDefined();
      expect(body.lastActiveAt).toBeDefined();

      ws.close();
    });

    it('should return 410 Gone for non-existent connection', async () => {
      const response = await fetch(
        `${ctx.httpUrl}/@connections/nonexistent123=`
      );

      expect(response.status).toBe(410);
    });
  });

  describe('DELETE /@connections/{id}', () => {
    it('should close the connection', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.requestContext.connectionId;

      const closePromise = ctx.waitForClose(ws);

      const response = await fetch(
        `${ctx.httpUrl}/@connections/${connectionId}`,
        { method: 'DELETE' }
      );

      expect(response.status).toBe(204);

      const closeInfo = await closePromise;
      expect(closeInfo.code).toBe(1000);
    });

    it('should return 410 Gone for non-existent connection', async () => {
      const response = await fetch(
        `${ctx.httpUrl}/@connections/nonexistent123=`,
        { method: 'DELETE' }
      );

      expect(response.status).toBe(410);
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${ctx.httpUrl}/health`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.connections).toBeTypeOf('number');
      expect(body.uptime).toBeTypeOf('number');
    });

    it('should reflect correct connection count', async () => {
      const ws1 = await ctx.createConnection();
      const ws2 = await ctx.createConnection();
      await sleep(100);

      const response = await fetch(`${ctx.httpUrl}/health`);
      const body = await response.json();
      expect(body.connections).toBe(2);

      ws1.close();
      ws2.close();
    });
  });

  describe('Unsupported methods', () => {
    it('should return 405 for PUT on /@connections', async () => {
      const response = await fetch(
        `${ctx.httpUrl}/@connections/someconnection=`,
        { method: 'PUT' }
      );

      expect(response.status).toBe(405);
    });

    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${ctx.httpUrl}/unknown/path`);

      expect(response.status).toBe(404);
    });
  });
});
