import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('AWS Format Conformance', () => {
  const ctx = new TestContext(14001, 14002);

  beforeAll(async () => {
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(() => {
    ctx.backend.clear();
  });

  describe('$connect event structure', () => {
    it('should include all required requestContext fields', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event).toBeDefined();

      const rc = event.requestContext;

      // Required fields per AWS spec
      expect(rc.routeKey).toBe('$connect');
      expect(rc.eventType).toBe('CONNECT');
      expect(rc.extendedRequestId).toBeDefined();
      expect(rc.requestTime).toBeDefined();
      expect(rc.messageDirection).toBe('IN');
      expect(rc.stage).toBe('test');
      expect(rc.connectedAt).toBeTypeOf('number');
      expect(rc.requestTimeEpoch).toBeTypeOf('number');
      expect(rc.identity).toBeDefined();
      expect(rc.identity.sourceIp).toBeDefined();
      expect(rc.requestId).toBeDefined();
      expect(rc.domainName).toBeDefined();
      expect(rc.connectionId).toBeDefined();
      expect(rc.apiId).toBe('testapi');

      ws.close();
    });

    it('should have null body for $connect', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.body).toBeNull();

      ws.close();
    });

    it('should include headers object', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.headers).toBeTypeOf('object');
      expect(event.headers).not.toBeNull();

      ws.close();
    });

    it('should include multiValueHeaders object', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.multiValueHeaders).toBeTypeOf('object');
      expect(event.multiValueHeaders).not.toBeNull();

      // Each value should be an array
      for (const [key, value] of Object.entries(event.multiValueHeaders)) {
        expect(Array.isArray(value)).toBe(true);
        expect(value.length).toBeGreaterThan(0);
      }

      ws.close();
    });

    it('should have isBase64Encoded as false', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.isBase64Encoded).toBe(false);

      ws.close();
    });
  });

  describe('$disconnect event structure', () => {
    it('should include disconnectStatusCode and disconnectReason', async () => {
      const ws = await ctx.createConnection();
      await sleep(200); // Wait for connection to fully establish
      ws.close(1000, 'Normal closure');
      await ctx.backend.waitForEvent('$disconnect');

      const event = ctx.backend.getEventsByRoute('$disconnect')[0];
      expect(event).toBeDefined();

      const rc = event.requestContext;
      expect(rc.routeKey).toBe('$disconnect');
      expect(rc.eventType).toBe('DISCONNECT');
      expect(rc.disconnectStatusCode).toBeTypeOf('number');
      expect(rc.disconnectReason).toBeDefined();
    });

    it('should have null body for $disconnect', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);
      ws.close();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$disconnect')[0];
      expect(event.body).toBeNull();
    });
  });

  describe('MESSAGE event structure', () => {
    it('should include messageId for MESSAGE events', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);
      ws.send('test message');
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$default')[0];
      expect(event).toBeDefined();

      const rc = event.requestContext;
      expect(rc.routeKey).toBe('$default');
      expect(rc.eventType).toBe('MESSAGE');
      expect(rc.messageId).toBeDefined();
      expect(rc.messageId).toBeTypeOf('string');

      ws.close();
    });

    it('should preserve message body', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const testMessage = JSON.stringify({ action: 'test', data: 'hello' });
      ws.send(testMessage);
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$default')[0];
      expect(event.body).toBe(testMessage);

      ws.close();
    });
  });

  describe('requestTime format', () => {
    it('should match AWS format: DD/Mon/YYYY:HH:MM:SS +0000', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      const requestTime = event.requestContext.requestTime;

      // Format: 09/Feb/2024:18:11:43 +0000
      const regex = /^\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2} \+0000$/;
      expect(requestTime).toMatch(regex);

      ws.close();
    });
  });

  describe('timestamps', () => {
    it('connectedAt should be milliseconds timestamp', async () => {
      const before = Date.now();
      const ws = await ctx.createConnection();
      await sleep(100);
      const after = Date.now();

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      const connectedAt = event.requestContext.connectedAt;

      expect(connectedAt).toBeGreaterThanOrEqual(before);
      expect(connectedAt).toBeLessThanOrEqual(after);

      ws.close();
    });

    it('requestTimeEpoch should be milliseconds timestamp', async () => {
      const before = Date.now();
      const ws = await ctx.createConnection();
      await sleep(100);
      const after = Date.now();

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      const requestTimeEpoch = event.requestContext.requestTimeEpoch;

      expect(requestTimeEpoch).toBeGreaterThanOrEqual(before);
      expect(requestTimeEpoch).toBeLessThanOrEqual(after);

      ws.close();
    });
  });

  describe('queryStringParameters', () => {
    it('should be null when no query params', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.queryStringParameters).toBeNull();

      ws.close();
    });

    it('should contain params when provided', async () => {
      const ws = await ctx.createConnection({ token: 'abc123', id: '456' });
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.queryStringParameters).toEqual({
        token: 'abc123',
        id: '456',
      });

      ws.close();
    });
  });

  describe('identity', () => {
    it('should include sourceIp', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.requestContext.identity.sourceIp).toBeDefined();
      expect(event.requestContext.identity.sourceIp).toBeTypeOf('string');

      ws.close();
    });
  });

  describe('connectionId format', () => {
    it('should end with =', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.requestContext.connectionId).toMatch(/=$/);

      ws.close();
    });

    it('should be unique per connection', async () => {
      const ws1 = await ctx.createConnection();
      await sleep(50);
      const ws2 = await ctx.createConnection();
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(2);
      expect(events[0].requestContext.connectionId).not.toBe(
        events[1].requestContext.connectionId
      );

      ws1.close();
      ws2.close();
    });
  });
});
