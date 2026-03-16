# ai-matey-middleware-andbox

[ai.matey](https://github.com/johnhenry/ai.matey) middleware for code-based tool execution via the [andbox](https://github.com/johnhenry/andbox) sandbox.

LLMs that don't support native tool calling can still use tools by writing code. This middleware intercepts LLM responses, extracts fenced code blocks, adapts common Python-isms to JavaScript, and executes them in a sandboxed environment with tool stubs injected as callable functions.

## Install

```bash
npm install ai-matey-middleware-andbox
```

**Peer dependency:** This package requires `andbox` to be installed separately:

```bash
npm install andbox
```

## Usage

```js
import { createCodeExecutionMiddleware } from 'ai-matey-middleware-andbox';
import { createSandbox } from 'andbox';

const sandbox = createSandbox();

const tools = [
  { name: 'fetch_data', description: 'Fetch data from a URL', parameters: { url: { type: 'string' } } },
  { name: 'save_file', description: 'Save content to a file', parameters: { path: { type: 'string' }, content: { type: 'string' } } },
];

const middleware = createCodeExecutionMiddleware({
  sandbox,
  tools,
  executeToolFn: async (name, params) => {
    // Route to your actual tool implementations
    console.log(`Executing tool: ${name}`, params);
    return { success: true, output: 'done' };
  },
  maxResultLength: 4096,
  timeoutMs: 30000,
});

// Use with ai.matey
// bridge.use(middleware);
```

## API

### `createCodeExecutionMiddleware(options)`

Creates an ai.matey middleware object with an `after` hook.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sandbox` | `Sandbox` | *required* | An andbox sandbox instance |
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

## License

MIT
