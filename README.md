# @johnhenry/aimatey-middleware-andbox

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Faimatey-middleware-andbox.svg)](https://www.npmjs.com/package/@johnhenry/aimatey-middleware-andbox)
[![CI](https://github.com/johnhenry/aimatey-middleware-andbox/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/aimatey-middleware-andbox/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Faimatey-middleware-andbox.svg)](LICENSE)

> **Note:** Previously published as `ai-matey-middleware-andbox@0.1.1`.

[aimatey](https://github.com/johnhenry/aimatey) middleware for code-based tool execution via the [andbox](https://github.com/johnhenry/andbox) sandbox.

LLMs that don't support native tool calling can still use tools by writing code. This middleware intercepts LLM responses, extracts fenced code blocks, adapts common Python-isms to JavaScript, and executes them in a sandboxed environment with tool stubs injected as callable functions.

## Install

```bash
npm install @johnhenry/aimatey-middleware-andbox
```

**Peer dependency:** This package requires `andbox` to be installed separately:

```bash
npm install andbox
```

## Usage

andbox only accepts `capabilities` (the functions reachable from sandboxed
code via `host.call(name, ...)`) at `createSandbox({ capabilities })` time --
there is no way to attach them later. So this middleware needs *either* the
andbox `createSandbox` factory itself (and it will create the sandbox for
you, wired to your tools), *or* an already-built sandbox that you created
with the capabilities already set. The factory form is recommended:

```js
import { createCodeExecutionMiddleware } from '@johnhenry/aimatey-middleware-andbox';
import { createSandbox } from 'andbox';

const tools = [
  { name: 'fetch_data', description: 'Fetch data from a URL', parameters: { url: { type: 'string' } } },
  { name: 'save_file', description: 'Save content to a file', parameters: { path: { type: 'string' }, content: { type: 'string' } } },
];

const middleware = createCodeExecutionMiddleware({
  createSandbox,       // andbox's factory -- the middleware calls this itself
  tools,
  executeToolFn: async (name, params) => {
    // Route to your actual tool implementations
    console.log(`Executing tool: ${name}`, params);
    return { success: true, output: 'done' };
  },
  maxResultLength: 4096,
  timeoutMs: 30000,
});

// Use with aimatey
// bridge.use(middleware);
```

If you need full control over the sandbox (custom `importMap`, `policy`,
`onConsole`, etc.), build it yourself with `toolsToCapabilities()` and pass
the instance as `sandbox` instead -- the middleware will use it as-is and
will **not** be able to add capabilities to it later:

```js
import { createCodeExecutionMiddleware, toolsToCapabilities } from '@johnhenry/aimatey-middleware-andbox';
import { createSandbox } from 'andbox';

const executeToolFn = async (name, params) => ({ success: true });
const sandbox = await createSandbox({
  capabilities: toolsToCapabilities(tools, executeToolFn),
  policy: { limits: { maxCalls: 50 } },
});

const middleware = createCodeExecutionMiddleware({ sandbox, tools, executeToolFn });
```

## API

### `createCodeExecutionMiddleware(options)`

Creates an aimatey middleware object with an `after` hook.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `createSandbox` | `(opts) => Sandbox \| Promise<Sandbox>` | one of `createSandbox`/`sandbox` required | andbox's `createSandbox` factory. The middleware creates (and caches) the sandbox itself, with capabilities wired from `tools`/`executeToolFn`. |
| `sandbox` | `Sandbox` | one of `createSandbox`/`sandbox` required | A pre-built andbox sandbox instance. Must already have been created with `capabilities: toolsToCapabilities(tools, executeToolFn)` -- capabilities cannot be added after creation. |
| `sandboxOptions` | `object` | `{}` | Extra options merged into `createSandbox()` when using the `createSandbox` factory (e.g. `importMap`, `policy`, `onConsole`). Any `capabilities` here are merged with (and can override) the tool-derived ones. |
| `tools` | `Array<{name, description?, parameters?}>` | *required* | Tool definitions |
| `executeToolFn` | `(name, params) => Promise<any>` | *required* | Function to execute tools |
| `maxResultLength` | `number` | `4096` | Max characters per result |
| `codeLanguages` | `string[]` | `['js','javascript','tool_code','python','py','']` | Languages to execute |
| `timeoutMs` | `number` | `30000` | Execution timeout in ms |

The middleware attaches the following properties to the response:

- `_codeResults` -- Array of `{code, output, error?}` for each executed block
- `_toolCalls` -- Synthetic tool call entries
- `_cleanText` -- Response text with code blocks stripped
- `_resultSummary` -- Formatted summary string

### `extractCodeBlocks(text)`

Extract fenced code blocks from text. Returns `Array<{lang, code}>`.

### `stripCodeBlocks(text)`

Remove all fenced code blocks from text.

### `adaptPythonisms(code)`

Convert Python patterns (`True`, `False`, `None`, f-strings) to JavaScript equivalents.

### `autoAwait(code, asyncFnPatterns?)`

Insert `await` before common async calls (`print()`, `browser_*()`, and custom patterns).

### `toolsToCapabilities(tools, executeToolFn)`

Convert tool definitions to an object of callable async functions.

### `toolsToPreamble(tools)`

Generate JavaScript code that declares function stubs for each tool.

### `formatResults(results, maxResultLength?)`

Format execution results as a summary string.

### `resultsToToolCalls(results)`

Convert results to synthetic tool call entries.

## Security model

This middleware routes LLM-authored code through andbox's Worker sandbox and
gates which host functions (`tools`) that code can call via `host.call()`.
**That capability gate is not a security boundary against adversarial LLM
output.** andbox's own README documents confirmed ways sandboxed code can
act outside what `capabilities` appears to allow -- see andbox's
[Security model](https://github.com/johnhenry/andbox#security-model)
section for the full list, in short:

- Worker-global APIs (`fetch`, `WebSocket`, `Worker`, `importScripts`,
  `indexedDB`) are directly reachable from sandboxed code regardless of
  which `capabilities` you supplied -- omitting a `fetch`-like tool does not
  block network access.
- The capability gate can be bypassed via the prototype chain
  (`host.call('constructor', ...)` resolves to the real global `Object`
  constructor).
- `sandboxImport()` will load and execute an arbitrary remote URL.
- A timeout stops message delivery to a killed Worker, not an in-flight
  host-side effect that capability call already triggered.

In other words: wiring `executeToolFn` into the sandbox (as this package now
does correctly) lets you *organize* which tools well-behaved LLM-generated
code can call, and gives you timeouts/rate limits for code you already
trust. It does **not** contain code that is deliberately trying to escape.
If you're executing output from an untrusted or adversarial model, pair this
middleware with OS-level isolation (a separate process/container with its
own network and filesystem restrictions) in addition to andbox's Worker
boundary -- do not rely on the tool-capability gate alone.

## License

MIT
