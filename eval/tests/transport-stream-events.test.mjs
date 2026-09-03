import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStreamEvent, StreamEventType } from '../../server/src/engine/stream/agent_stream_protocol.js';
import { bindTransportStreamAbort } from '../../server/src/transport/http_server.js';
import { createTransportStream } from '../../server/src/transport/stream_events.js';

test('HTTP eval streams ignore request completion and abort on response disconnect', () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  const controller = new AbortController();
  const unbind = bindTransportStreamAbort(req, res, controller);

  req.emit('close');
  assert.equal(controller.signal.aborted, false);
  res.emit('close');
  assert.equal(controller.signal.aborted, true);
  unbind();
});

test('transport failure creates a complete turn when the route emitted nothing', () => {
  const events = [];
  const stream = createTransportStream((event) => events.push(event), { threadId: 'thread-1' });
  stream.fail('boom');

  assert.deepEqual(events.map((event) => event.type), [
    'turn/started',
    'item/started',
    'item/completed',
    'turn/completed',
  ]);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4]);
  assert.equal(new Set(events.map((event) => event.turn_id)).size, 1);
  assert.equal(events[1].item_id, 'transport:error');
  assert.equal(events[2].payload.item.content, 'boom');
  assert.equal(events[3].payload.turn.status, 'failed');
});

test('transport failure continues the route turn and sequence', () => {
  const events = [];
  const stream = createTransportStream((event) => events.push(event), { threadId: 'thread-1' });
  stream.emit(createStreamEvent({
    type: StreamEventType.TURN_STARTED,
    threadId: 'thread-1',
    turnId: 'turn-1',
    seq: 7,
    payload: { turn: { id: 'turn-1', status: 'inProgress', startedAt: 100, items: [] } },
  }));
  stream.fail('route failed');

  assert.deepEqual(events.map((event) => event.type), [
    'turn/started',
    'item/started',
    'item/completed',
    'turn/completed',
  ]);
  assert.deepEqual(events.map((event) => event.seq), [7, 8, 9, 10]);
  assert.equal(events.every((event) => event.turn_id === 'turn-1'), true);
  assert.equal(events.at(-1).payload.turn.error.message, 'route failed');
});

test('transport does not emit a second terminal state after turn completion', () => {
  const events = [];
  const stream = createTransportStream((event) => events.push(event), { threadId: 'thread-1' });
  stream.emit(createStreamEvent({
    type: StreamEventType.TURN_COMPLETED,
    threadId: 'thread-1',
    turnId: 'turn-1',
    seq: 4,
    payload: { turn: { id: 'turn-1', status: 'completed', items: [] } },
  }));

  assert.deepEqual(stream.fail('late failure'), []);
  assert.equal(events.length, 1);
});

test('transport recognizes the real JSON-RPC terminal envelope', () => {
  const events = [];
  const stream = createTransportStream((event) => events.push(event), { threadId: 'thread-1' });
  stream.emit({
    jsonrpc: '2.0',
    method: 'turn/completed',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      turn: { id: 'turn-1', status: 'completed' },
      _meta: { seq: 9 },
    },
  });

  assert.deepEqual(stream.fail('late failure'), []);
  assert.equal(events.length, 1);
});
