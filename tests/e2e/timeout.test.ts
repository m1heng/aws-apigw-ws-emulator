import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('Timeout Management', () => {
  describe('Idle Timeout', () => {
    const ctx = new TestContext(14013, 14014);

    beforeAll(async () => {
      await ctx.setup({
        port: 14013,
        idleTimeout: 1, // 1 second
        hardTimeout: 10, // 10 seconds
        routes: {
          $connect: { uri: `http://localhost:14014/connect` },
          $disconnect: { uri: `http://localhost:14014/disconnect` },
          $default: { uri: `http://localhost:14014/default` },
        },
      });
    });

    afterAll(async () => {
      await ctx.teardown();
    });

    beforeEach(() => {
      ctx.backend.clear();
    });

    it('should close connection after idle timeout', async () => {
      const ws = await ctx.createConnection();
      const closePromise = ctx.waitForClose(ws, 3000);

      const closeInfo = await closePromise;
      expect(closeInfo.code).toBe(1001);
    });

    it('should reset idle timeout on message', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      // Send message after 600ms to reset timeout
      await sleep(600);
      ws.send('keep alive');

      // Wait another 600ms - should still be connected if timeout was reset
      await sleep(600);

      // Connection should still be open
      expect(ws.readyState).toBe(ws.OPEN);

      // Now wait for timeout
      const closeInfo = await ctx.waitForClose(ws, 2000);
      expect(closeInfo.code).toBe(1001);
    });
  });

  describe('Hard Timeout', () => {
    const ctx = new TestContext(14015, 14016);

    beforeAll(async () => {
      await ctx.setup({
        port: 14015,
        idleTimeout: 10, // 10 seconds
        hardTimeout: 2, // 2 seconds
        routes: {
          $connect: { uri: `http://localhost:14016/connect` },
          $disconnect: { uri: `http://localhost:14016/disconnect` },
          $default: { uri: `http://localhost:14016/default` },
        },
      });
    });

    afterAll(async () => {
      await ctx.teardown();
    });

    beforeEach(() => {
      ctx.backend.clear();
    });

    it('should close connection after hard timeout regardless of activity', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      // Keep sending messages
      const interval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send('keep alive');
        }
      }, 500);

      const closeInfo = await ctx.waitForClose(ws, 4000);
      clearInterval(interval);

      expect(closeInfo.code).toBe(1001);
    });

    it('hard timeout should not be reset by activity', async () => {
      const startTime = Date.now();
      const ws = await ctx.createConnection();

      // Send message to prove activity doesn't reset hard timeout
      await sleep(500);
      ws.send('activity');

      const closeInfo = await ctx.waitForClose(ws, 4000);
      const elapsed = Date.now() - startTime;

      // Should close around 2 seconds (hard timeout), not later
      expect(elapsed).toBeLessThan(3000);
      expect(closeInfo.code).toBe(1001);
    });
  });
});
