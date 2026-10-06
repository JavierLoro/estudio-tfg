import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.ts';
import type { CompileResult } from '../compile.ts';
import type { ChangeEvent } from '../events.ts';

export default async function eventsRoutes(app: FastifyInstance, { ctx }: { ctx: Ctx }) {
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n: conectado\n\n');
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onChange = (e: ChangeEvent) => send('change', e);
    const onCompile = (r: CompileResult) => send('compile', r);
    const onSettings = (v: unknown) => send('settings', v);
    ctx.bus.on('change', onChange);
    ctx.bus.on('compile', onCompile);
    ctx.bus.on('settings', onSettings);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const cleanup = () => {
      clearInterval(ping);
      ctx.bus.off('change', onChange);
      ctx.bus.off('compile', onCompile);
      ctx.bus.off('settings', onSettings);
    };
    req.raw.on('close', cleanup);
    res.on('close', cleanup);
  });
}
