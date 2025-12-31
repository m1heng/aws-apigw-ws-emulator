import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { TestContext, sleep } from './setup';

describe('Message Routing', () => {
  describe('$default route', () => {
    const ctx = new TestContext(14007, 14008);

    beforeAll(async () => {
      await ctx.setup();
    });

    afterAll(async () => {
      await ctx.teardown();
    });

    beforeEach(() => {
      ctx.backend.clear();
    });

    it('should route messages to $default', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send('hello world');
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);
      expect(events[0].body).toBe('hello world');

      ws.close();
    });

    it('should route non-JSON messages to $default', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send('not valid json {{{');
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);
      expect(events[0].body).toBe('not valid json {{{');

      ws.close();
    });

    it('should route JSON messages without action to $default', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ data: 'test' }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);

      ws.close();
    });

    it('should preserve full message body', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      const complexMessage = {
        type: 'chat',
        content: 'Hello!',
        metadata: {
          timestamp: Date.now(),
          nested: { deep: true },
        },
      };

      ws.send(JSON.stringify(complexMessage));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(JSON.parse(events[0].body!)).toEqual(complexMessage);

      ws.close();
    });
  });

  describe('Custom route selection', () => {
    const ctx = new TestContext(14009, 14010);

    beforeAll(async () => {
      await ctx.setup({
        port: 14009,
        routeSelectionExpression: '$request.body.action',
        routes: {
          $connect: { uri: `http://localhost:14010/connect` },
          $disconnect: { uri: `http://localhost:14010/disconnect` },
          $default: { uri: `http://localhost:14010/default` },
          join: { uri: `http://localhost:14010/join` },
          leave: { uri: `http://localhost:14010/leave` },
          sendMessage: { uri: `http://localhost:14010/sendMessage` },
        },
      });
    });

    afterAll(async () => {
      await ctx.teardown();
    });

    beforeEach(() => {
      ctx.backend.clear();
    });

    it('should route to custom route based on action field', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ action: 'join', roomId: '123' }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('join');
      expect(events.length).toBe(1);
      expect(events[0].requestContext.routeKey).toBe('join');

      ws.close();
    });

    it('should route different actions to different routes', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ action: 'join' }));
      ws.send(JSON.stringify({ action: 'leave' }));
      ws.send(JSON.stringify({ action: 'sendMessage', text: 'hi' }));
      await sleep(200);

      expect(ctx.backend.getEventsByRoute('join').length).toBe(1);
      expect(ctx.backend.getEventsByRoute('leave').length).toBe(1);
      expect(ctx.backend.getEventsByRoute('sendMessage').length).toBe(1);

      ws.close();
    });

    it('should fallback to $default for unknown action', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ action: 'unknownAction' }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);

      ws.close();
    });

    it('should fallback to $default for non-JSON', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send('plain text message');
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);

      ws.close();
    });

    it('should fallback to $default when action field is missing', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ type: 'something' }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);

      ws.close();
    });
  });

  describe('Nested route selection', () => {
    const ctx = new TestContext(14011, 14012);

    beforeAll(async () => {
      await ctx.setup({
        port: 14011,
        routeSelectionExpression: '$request.body.data.type',
        routes: {
          $connect: { uri: `http://localhost:14012/connect` },
          $disconnect: { uri: `http://localhost:14012/disconnect` },
          $default: { uri: `http://localhost:14012/default` },
          chat: { uri: `http://localhost:14012/chat` },
        },
      });
    });

    afterAll(async () => {
      await ctx.teardown();
    });

    beforeEach(() => {
      ctx.backend.clear();
    });

    it('should route based on nested path', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ data: { type: 'chat', message: 'hello' } }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('chat');
      expect(events.length).toBe(1);

      ws.close();
    });

    it('should fallback when nested path does not exist', async () => {
      const ws = await ctx.createConnection();
      await sleep(100);

      ws.send(JSON.stringify({ data: { noType: true } }));
      await sleep(100);

      const events = ctx.backend.getEventsByRoute('$default');
      expect(events.length).toBe(1);

      ws.close();
    });
  });
});
