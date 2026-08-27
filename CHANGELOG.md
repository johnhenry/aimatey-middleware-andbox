# Changelog

> Previously published as `ai-matey-middleware-andbox`, last unscoped version `0.1.1`.

## Unreleased

- Fix: `createCodeExecutionMiddleware` now actually wires `executeToolFn` into
  the sandbox's capabilities, so `host.call('toolName', ...)` from
  LLM-authored code reaches real tool functions instead of always failing
  with "Unknown capability". Adds a `createSandbox` factory option so the
  middleware can create a correctly-configured sandbox itself; a pre-built
  `sandbox` instance is still supported but must be created with
  capabilities already wired. (#3)
- Docs: corrected the README usage example (previously showed a sandbox
  created with no capabilities, which never worked) and added an honest
  "Security model" section cross-referencing andbox's own security
  documentation instead of implying the tool-capability gate is a security
  boundary.

## 0.1.0 (2026-03-15)

- Initial release
- Code block extraction from LLM responses
- Python-to-JS adaptation (True/False/None, f-strings)
- Auto-await insertion for async tool calls
- Tool-to-preamble stub generation
- Result formatting and synthetic tool call creation
- `createCodeExecutionMiddleware()` for ai.matey integration
