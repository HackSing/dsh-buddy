import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../whoami-standard/zero-tool-bootstrap.mjs'

function register(config) {
  const listeners = {}
  const hookOptions = {}
  const warns = []
  const ctx = {
    on(event, callback, options) {
      listeners[event] = callback
      hookOptions[event] = options
    },
    logger: {
      warn(message) {
        warns.push(message)
      },
    },
  }
  apply(ctx, config)
  assert.equal(typeof listeners['system-prompt/assemble'], 'function')
  return { listeners, hookOptions, warns }
}

function assemble(listener, events, tools, header = {}, id = 's') {
  return listener(
    undefined,
    { agent: { session: { id, events, header } } },
    async () => ({ system: 'minimal persona', tools }),
  )
}

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'zero-tool-bootstrap')
})

test('includeSubagents: true keeps subagents in the zero-tool anchor phase', async () => {
  const { listeners } = register({ includeSubagents: true })
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
  const result = await assemble(listeners['system-prompt/assemble'], [], tools, { delegationDepth: 1 })
  assert.deepEqual(result.tools, [])
})

test('includeSubagents: true lets a subagent promote to the resident catalog after the anchor reply', async () => {
  const { listeners } = register({ includeSubagents: true })
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }, { name: 'grep' }]
  const result = await assemble(
    listeners['system-prompt/assemble'],
    [{ type: 'assistant/message', data: {} }],
    tools,
    { delegationDepth: 1 },
  )
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash'])
})

test('without includeSubagents subagents stay promoted from their first request', async () => {
  const { listeners } = register()
  const tools = [{ name: 'bash' }, { name: 'read' }, { name: 'edit' }]
  const result = await assemble(listeners['system-prompt/assemble'], [], tools, { delegationDepth: 1 })
  assert.deepEqual(result.tools.map((tool) => tool.name), ['bash'])
})
