import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('Connection Lifecycle', () => {
  const ctx = new TestContext(14003, 14004);

  beforeAll(async () => {
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(async () => {
    ctx.backend.clear();
    // Wait for any lingering connections to close
    await sleep(100);
  });

  describe('$connect', () => {
    it('should successfully connect and trigger $connect callback', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(1);
      expect(events[0].requestContext.eventType).toBe('CONNECT');

      ws.close();
    });

    it('should forward query parameters to backend', async () => {
      const ws = await ctx.createConnection({
        token: 'my-secret-token',
        userId: '12345',
      });
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.queryStringParameters).toEqual({
        token: 'my-secret-token',
        userId: '12345',
      });

      ws.close();
    });

    it('should forward headers to backend', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.headers).toBeDefined();
      expect(event.headers['host']).toContain('localhost');

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
    it('should trigger $disconnect when client closes normally', async () => {
      ctx.backend.clear(); // Clear any previous events
      const ws = await ctx.createConnection();
      await sleep(100);
      ws.close(1000, 'bye');
      await ctx.backend.waitForEvent('$disconnect');

      const events = ctx.backend.getEventsByRoute('$disconnect');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[events.length - 1].requestContext.eventType).toBe('DISCONNECT');
    });

    it('should preserve same connectionId across connect and disconnect', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const connectEvent = ctx.backend.getEventsByRoute('$connect')[0];
      const connectionId = connectEvent.requestContext.connectionId;

      ws.close();
      await ctx.backend.waitForEvent('$disconnect');

      const disconnectEvent = ctx.backend.getEventsByRoute('$disconnect')[0];
      expect(disconnectEvent.requestContext.connectionId).toBe(connectionId);
    });
  });

  describe('Multiple Connections', () => {
    it('should handle multiple concurrent connections', async () => {
      const connections = await Promise.all([
        ctx.createConnection({ id: '1' }),
        ctx.createConnection({ id: '2' }),
        ctx.createConnection({ id: '3' }),
      ]);

      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(3);

      // All connectionIds should be unique
      const connectionIds = events.map((e) => e.requestContext.connectionId);
      const uniqueIds = new Set(connectionIds);
      expect(uniqueIds.size).toBe(3);

      // Clean up
      connections.forEach((ws) => ws.close());
    });

    it('should isolate messages to correct connections', async () => {
      const ws1 = await ctx.createConnection({ id: '1' });
      const ws2 = await ctx.createConnection({ id: '2' });
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      const id1 = events.find((e) => e.queryStringParameters?.id === '1')
        ?.requestContext.connectionId;
      const id2 = events.find((e) => e.queryStringParameters?.id === '2')
        ?.requestContext.connectionId;

      // Send message from ws1
      ws1.send('message from ws1');
      await sleep(100);

      const msgEvent = ctx.backend.getEventsByRoute('$default')[0];
      expect(msgEvent.requestContext.connectionId).toBe(id1);
      expect(msgEvent.body).toBe('message from ws1');

      ws1.close();
      ws2.close();
    });
  });

  describe('Connection Info', () => {
    it('should track connection count changes', async () => {
      const ws1 = await ctx.createConnection();
      await sleep(100);
      const countAfterFirst = ctx.gateway?.getConnectionCount() || 0;
      expect(countAfterFirst).toBeGreaterThanOrEqual(1);

      const ws2 = await ctx.createConnection();
      await sleep(100);
      const countAfterSecond = ctx.gateway?.getConnectionCount() || 0;
      expect(countAfterSecond).toBe(countAfterFirst + 1);

      ws1.close();
      await sleep(100);
      expect(ctx.gateway?.getConnectionCount()).toBe(countAfterSecond - 1);

      ws2.close();
      await sleep(100);
      expect(ctx.gateway?.getConnectionCount()).toBe(countAfterSecond - 2);
    });
  });
});
