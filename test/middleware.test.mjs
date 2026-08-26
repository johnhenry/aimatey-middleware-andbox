import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCodeBlocks, stripCodeBlocks, adaptPythonisms, autoAwait, createCodeExecutionMiddleware } from '../src/index.mjs';
import { toolsToCapabilities, toolsToPreamble } from '../src/tool-injector.mjs';
import { formatResults, resultsToToolCalls } from '../src/result-formatter.mjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * A minimal fake of andbox's Worker sandbox, faithful to the real
 * constraint that matters here: capabilities are only ever supplied at
 * `createSandbox({ capabilities })` time, and `host.call(name, ...)` inside
 * evaluated code can only reach whatever was captured at that point.
 */
function makeFakeAndbox() {
  const created = [];
  async function createSandbox(opts = {}) {
    const capabilities = opts.capabilities || {};
    created.push(opts);
    return {
      async evaluate(code, evalOpts = {}) {
        const host = {
          call: async (name, params) => {
            const fn = capabilities[name];
            if (!fn) throw new Error(`Unknown capability: ${name}`);
            return fn(params);
          },
        };
        const log = (...args) => evalOpts.onConsole?.('log', ...args.map(String));
        const fn = new AsyncFunction('host', 'console', `"use strict";\n${code}`);
        return fn(host, { log });
      },
      dispose: async () => {},
    };
  }
  return { createSandbox, created };
}

describe('adaptPythonisms', () => {
  it('converts True/False/None', () => {
    assert.equal(adaptPythonisms('x = True'), 'x = true');
    assert.equal(adaptPythonisms('y = False'), 'y = false');
    assert.equal(adaptPythonisms('z = None'), 'z = null');
  });

  it('converts f-strings to template literals', () => {
    assert.equal(adaptPythonisms('f"hello {name}"'), '`hello ${name}`');
  });
});

describe('autoAwait', () => {
  it('adds await before print()', () => {
    const result = autoAwait('print("hi")');
    assert.ok(result.includes('await print'));
  });

  it('does not double-await', () => {
    const result = autoAwait('await print("hi")');
    assert.ok(!result.includes('await await'));
  });

  it('adds await before browser_ calls', () => {
    const result = autoAwait('browser_fetch({url: "x"})');
    assert.ok(result.includes('await browser_fetch'));
  });
});

describe('toolsToCapabilities', () => {
  it('creates callable capabilities from tools', async () => {
    const tools = [{ name: 'add', description: 'Add numbers' }];
    const executeFn = async (name, params) => params.a + params.b;
    const caps = toolsToCapabilities(tools, executeFn);
    assert.equal(typeof caps.add, 'function');
    assert.equal(await caps.add({ a: 2, b: 3 }), 5);
  });
});

describe('toolsToPreamble', () => {
  it('generates function stubs', () => {
    const tools = [{ name: 'fetch_data' }, { name: 'save_file' }];
    const preamble = toolsToPreamble(tools);
    assert.ok(preamble.includes('async function fetch_data'));
    assert.ok(preamble.includes('async function save_file'));
    assert.ok(preamble.includes('async function print'));
  });
});

describe('formatResults', () => {
  it('formats successful results', () => {
    const results = [{ code: '1+1', output: '2' }];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('Result: 2'));
  });

  it('formats errors', () => {
    const results = [{ code: 'bad()', output: '', error: 'ReferenceError' }];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('error'));
    assert.ok(formatted.includes('ReferenceError'));
  });

  it('labels multiple blocks', () => {
    const results = [
      { code: 'a()', output: '1' },
      { code: 'b()', output: '2' },
    ];
    const formatted = formatResults(results);
    assert.ok(formatted.includes('Block 1'));
    assert.ok(formatted.includes('Block 2'));
  });

  it('truncates long results', () => {
    const longOutput = 'x'.repeat(5000);
    const results = [{ code: 'x', output: longOutput }];
    const formatted = formatResults(results, 100);
    assert.ok(formatted.length < longOutput.length);
    assert.ok(formatted.includes('truncated'));
  });
});

describe('resultsToToolCalls', () => {
  it('creates tool call entries', () => {
    const results = [{ code: '1+1', output: '2' }];
    const calls = resultsToToolCalls(results);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, '_code_exec');
    assert.ok(calls[0]._result.success);
    assert.equal(calls[0]._result.output, '2');
  });
});

describe('createCodeExecutionMiddleware', () => {
  it('wires executeToolFn into the sandbox so host.call() reaches the real tool function', async () => {
    const { createSandbox, created } = makeFakeAndbox();
    const calls = [];
    const executeToolFn = async (name, params) => {
      calls.push({ name, params });
      return { sum: params.a + params.b };
    };

    const middleware = createCodeExecutionMiddleware({
      createSandbox,
      tools: [{ name: 'add', description: 'Add two numbers' }],
      executeToolFn,
    });

    const response = {
      content: [
        'Let me add those numbers:',
        '```js',
        'const r = await add({ a: 2, b: 3 });',
        'print(r.sum);',
        '```',
      ].join('\n'),
    };

    const result = await middleware.after(response);

    // The real tool function was actually invoked with the right args --
    // this is the core behavior that was previously broken ("Unknown capability").
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'add', params: { a: 2, b: 3 } });

    assert.equal(result._codeResults.length, 1);
    assert.equal(result._codeResults[0].error, undefined);
    assert.ok(result._codeResults[0].output.includes('5'));

    // The sandbox was created with a capabilities map derived from tools/executeToolFn.
    assert.equal(created.length, 1);
    assert.equal(typeof created[0].capabilities.add, 'function');
  });

  it('rejects unknown tool calls with "Unknown capability" instead of silently succeeding', async () => {
    const { createSandbox } = makeFakeAndbox();
    const executeToolFn = async () => ({ ok: true });

    const middleware = createCodeExecutionMiddleware({
      createSandbox,
      tools: [{ name: 'known_tool' }],
      executeToolFn,
    });

    const response = {
      content: '```js\nawait host.call("not_a_real_tool", {});\n```',
    };

    const result = await middleware.after(response);
    assert.equal(result._codeResults[0].error, 'Unknown capability: not_a_real_tool');
  });

  it('reuses a pre-built sandbox instance as-is when `sandbox` is passed directly', async () => {
    const calls = [];
    const executeToolFn = async (name, params) => { calls.push(params); return 'ok'; };
    const capabilities = toolsToCapabilities([{ name: 'ping' }], executeToolFn);

    const { createSandbox } = makeFakeAndbox();
    const sandbox = await createSandbox({ capabilities });

    const middleware = createCodeExecutionMiddleware({
      sandbox,
      tools: [{ name: 'ping' }],
      executeToolFn,
    });

    const response = { content: '```js\nawait ping({ hello: "world" });\n```' };
    await middleware.after(response);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { hello: 'world' });
  });

  it('throws a clear error when neither sandbox nor createSandbox is provided', () => {
    assert.throws(
      () => createCodeExecutionMiddleware({ tools: [], executeToolFn: async () => {} }),
      /requires either a pre-built `sandbox`|createSandbox/
    );
  });
});

describe('index re-exports', () => {
  it('exports all public API', async () => {
    const mod = await import('../src/index.mjs');
    assert.equal(typeof mod.createCodeExecutionMiddleware, 'function');
    assert.equal(typeof mod.extractCodeBlocks, 'function');
    assert.equal(typeof mod.stripCodeBlocks, 'function');
    assert.equal(typeof mod.adaptPythonisms, 'function');
    assert.equal(typeof mod.autoAwait, 'function');
    assert.equal(typeof mod.toolsToCapabilities, 'function');
    assert.equal(typeof mod.toolsToPreamble, 'function');
    assert.equal(typeof mod.formatResults, 'function');
    assert.equal(typeof mod.resultsToToolCalls, 'function');
  });
});
