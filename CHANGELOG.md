# Changelog

> Previously published as `ai-matey-middleware-andbox`, last unscoped version `0.1.1`.

## Unreleased

- Repoint the `andbox` peer dependency at `@johnhenry/andbox` (`>=0.0.0`),
  matching andbox's own adoption into the `@johnhenry` npm scope
  (johnhenry/andbox#2). Update README/JSDoc install and import examples to
  match.

## 0.1.0 (2026-03-15)

- Initial release
- Code block extraction from LLM responses
- Python-to-JS adaptation (True/False/None, f-strings)
- Auto-await insertion for async tool calls
- Tool-to-preamble stub generation
- Result formatting and synthetic tool call creation
- `createCodeExecutionMiddleware()` for ai.matey integration
