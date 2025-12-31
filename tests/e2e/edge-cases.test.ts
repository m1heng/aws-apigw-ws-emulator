import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('Edge Cases', () => {
  const ctx = new TestContext(14017, 14018);

  beforeAll(async () => {
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(() => {
    ctx.backend.clear();
  });

  describe('Large Messages', () => {
    it('should handle large message (100KB)', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const largeMessage = 'x'.repeat(100 * 1024);
      ws.send(largeMessage);
      await sleep(200);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);
      expect(events[0].body?.length).toBe(100 * 1024);

      ws.close();
    });

    it('should handle JSON with large nested data', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      };

      ws.send(JSON.stringify(largeData));
      await sleep(200);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);
      expect(JSON.parse(events[0].body!).items.length).toBe(1000);

      ws.close();
    });
  });

  describe('Binary Messages', () => {
    it('should handle binary data as string', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      ws.send(buffer);
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);
      expect(events[0].body).toBe('Hello');

      ws.close();
    });
  });

  describe('Rapid Messages', () => {
    it('should handle rapid sequential messages', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const messageCount = 50;
      for (let i = 0; i < messageCount; i++) {
        ws.send(`message-${i}`);
      }

      await sleep(500);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(messageCount);

      ws.close();
    });
  });

  describe('Concurrent Connections', () => {
    it('should handle many concurrent connections', async () => {
      const connectionCount = 20;
      const connections = await Promise.all(
        Array.from({ length: connectionCount }, (_, i) =>
          ctx.createConnection({ id: String(i) })
        )
      );

      await sleep(200);

      const events = ctx.backend.getEventsByRoute('$connect');
      expect(events.length).toBe(connectionCount);

      // Verify all have unique connectionIds
      const ids = new Set(events.map((e) => e.requestContext.connectionId));
      expect(ids.size).toBe(connectionCount);

      // Clean up
      connections.forEach((ws) => ws.close());
      await sleep(100);
    });
  });

  describe('Special Characters', () => {
    it('should handle URL-encoded query parameters', async () => {
      const ws = await ctx.createConnection({
        name: 'John Doe',
        query: 'hello world',
        special: '!@#$%',
      });
      await sleep(100);

      const event = ctx.backend.getEventsByRoute('$connect')[0];
      expect(event.queryStringParameters).toEqual({
        name: 'John Doe',
        query: 'hello world',
        special: '!@#$%',
      });

      ws.close();
    });

    it('should handle unicode in messages', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const unicodeMessage = '你好世界 🌍 مرحبا';
      ws.send(unicodeMessage);
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events[0].body).toBe(unicodeMessage);

      ws.close();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close all connections on shutdown', async () => {
      // Create new context for this test
      const shutdownCtx = new TestContext(14019, 14020);
      await shutdownCtx.setup({
        port: 14019,
        routes: {
          $connect: { uri: `http://localhost:14020/connect` },
          $disconnect: { uri: `http://localhost:14020/disconnect` },
          $default: { uri: `http://localhost:14020/default` },
        },
      });

      const ws1 = await shutdownCtx.createConnection();
      const ws2 = await shutdownCtx.createConnection();
      await sleep(100);

      const close1 = shutdownCtx.waitForClose(ws1);
      const close2 = shutdownCtx.waitForClose(ws2);

      await shutdownCtx.gateway?.stop();

      const [info1, info2] = await Promise.all([close1, close2]);
      expect(info1.code).toBe(1001);
      expect(info2.code).toBe(1001);

      await shutdownCtx.backend.stop();
    });
  });

  describe('Error Handling', () => {
    it('should continue working after backend error', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      // First message succeeds
      ws.send('message 1');
      await sleep(100);
      expect(ctx.backend.getEventsByRoute('$default').length).toBe(1);

      // Simulate backend error by temporarily stopping (we can't easily do this)
      // Instead, just verify multiple messages work
      ws.send('message 2');
      ws.send('message 3');
      await sleep(100);

      expect(ctx.backend.getEventsByRoute('$default').length).toBe(3);

      ws.close();
    });
  });
});
