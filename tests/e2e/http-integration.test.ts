import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { HttpTestContext, sleep } from './setup';

describe('HTTP Integration Mode', () => {
  const ctx = new HttpTestContext(15001, 15002);

  beforeAll(async () => {
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(async () => {
    ctx.backend.clear();
    await sleep(100);
  });

  describe('$connect', () => {
    it('should send connectionId in header', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(1);
      expect(events[0].connectionId).toBeTruthy();
      expect(events[0].connectionId).toMatch(/^[a-zA-Z0-9]+=$/);

      ws.close();
    });

    it('should send eventType in header', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.eventType).toBe('CONNECT');

      ws.close();
    });

    it('should send routeKey in header', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.routeKey).toBe('$connect');

      ws.close();
    });

    it('should forward query parameters in URL', async () => {
      const ws = await ctx.createConnection({
        token: 'my-secret-token',
        userId: '12345',
      });
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.queryParams).toEqual({
        token: 'my-secret-token',
        userId: '12345',
      });

      ws.close();
    });

    it('should include API Gateway headers', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.headers['x-amzn-apigateway-api-id']).toBe('testapi');
      expect(event.headers['x-amzn-apigateway-stage']).toBe('test');

      ws.close();
    });

    it('should close connection when backend returns error', async () => {
      ctx.backend.setConnectResponse(500);

      const ws = await ctx.createConnection();
      const closeInfo = await ctx.waitForClose(ws);

      expect(closeInfo.code).toBe(1011);

      ctx.backend.resetConnectResponse();
    });
  });

  describe('$disconnect', () => {
    it('should send disconnect with connectionId in header', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.connectionId;

      ws.close(1000, 'bye');
      await ctx.backend.waitForEvent('$disconnect');

      const disconnectEvent = ctx.backend.getEventsByRoute('$disconnect')[0];
      expect(disconnectEvent.connectionId).toBe(connectionId);
      expect(disconnectEvent.eventType).toBe('DISCONNECT');
    });

    it('should include disconnect status code in headers', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.close(1000, 'normal closure');
      await ctx.backend.waitForEvent('$disconnect');

      const event = ctx.backend.getEventsByRoute('$disconnect')[0];
      expect(event.headers['x-disconnect-status-code']).toBe('1000');
      expect(event.headers['x-disconnect-reason']).toBe('normal closure');
    });
  });

  describe('$default (messages)', () => {
    it('should send message body directly (not wrapped)', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send('{"action": "test", "data": "hello"}');
      await ctx.backend.waitForEvent('$default');

      const event = ctx.backend.getEventsByRoute('$default')[0];
      expect(event.body).toBe('{"action": "test", "data": "hello"}');

      ws.close();
    });

    it('should send connectionId in header for messages', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.connectionId;

      ws.send('test message');
      await ctx.backend.waitForEvent('$default');

      const msgEvent = ctx.backend.getEventsByRoute('$default')[0];
      expect(msgEvent.connectionId).toBe(connectionId);
      expect(msgEvent.eventType).toBe('MESSAGE');

      ws.close();
    });

    it('should handle multiple messages', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send('message 1');
      ws.send('message 2');
      ws.send('message 3');
      await sleep(200);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(3);
      expect(events[0].body).toBe('message 1');
      expect(events[1].body).toBe('message 2');
      expect(events[2].body).toBe('message 3');

      ws.close();
    });
  });

  describe('postToConnection (Management API)', () => {
    it('should send message to client via /@connections endpoint', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.connectionId;

      // Set up message receiver
      const receivedMessages: string[] = [];
      ws.on('message', (data) => {
        receivedMessages.push(data.toString());
      });

      // Send message via Management API
      const response = await fetch(
        `${ctx.httpUrl}/@connections/${encodeURIComponent(connectionId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'hello', data: 'world' }),
        }
      );

      expect(response.status).toBe(200);
      await sleep(100);

      expect(receivedMessages.length).toBe(1);
      expect(JSON.parse(receivedMessages[0])).toEqual({ type: 'hello', data: 'world' });

      ws.close();
    });
  });

  describe('Multiple Connections', () => {
    it('should assign unique connectionIds', async () => {
      const ws1 = await ctx.createConnection({ id: '1' });
      const ws2 = await ctx.createConnection({ id: '2' });
      const ws3 = await ctx.createConnection({ id: '3' });
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(3);

      const connectionIds = events.map((e) => e.connectionId);
      const uniqueIds = new Set(connectionIds);
      expect(uniqueIds.size).toBe(3);

      ws1.close();
      ws2.close();
      ws3.close();
    });

    it('should route messages to correct connectionId', async () => {
      const ws1 = await ctx.createConnection({ id: '1' });
      const ws2 = await ctx.createConnection({ id: '2' });
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      const id1 = events.find((e) => e.queryParams.id === '1')?.connectionId;

      ws1.send('from ws1');
      await sleep(100);

      const msgEvent = ctx.backend.getEventsByRoute('$default')[0];
      expect(msgEvent.connectionId).toBe(id1);
      expect(msgEvent.body).toBe('from ws1');

      ws1.close();
      ws2.close();
    });
  });
});
