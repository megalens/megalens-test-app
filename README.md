# MegaLens Test App

A deliberately vulnerable Express.js API for testing multi-engine AI code review.

Built to validate [MegaLens MCP](https://megalens.ai) across Claude Code, Cursor Agent, Codex CLI, and GitHub Copilot.

## What's inside

`server.js` is a 240-line user management + file storage API with **15+ intentional security vulnerabilities** spanning SQL injection, command injection, RCE, SSRF, path traversal, IDOR, race conditions, and more.

**Do not deploy to production.** This is a testing target.

## Run

```bash
npm install
node server.js   # http://localhost:3456
```

## Case Study: Single Model vs Multi-Engine Review

We reviewed `server.js` two ways through Cursor Agent CLI:

### Cursor Agent solo (Claude Opus, single model)

One prompt, one model. Found **20 vulnerabilities:**

| Severity | Count |
|----------|-------|
| Critical | 12 |
| High | 4 |
| Medium | 3 |
| Low | 1 |

Caught all the obvious issues: SQL injection (5 locations), command injection, SSRF, path traversal, IDOR, privilege escalation, hardcoded JWT secret.

### Cursor Agent + MegaLens MCP (Grok 4.1 Fast, DeepSeek V3.2, Gemini 3.1 Pro, GPT 5.4)

Same file, one extra MCP tool call. Found **46 vulnerabilities:**

| Severity | Count |
|----------|-------|
| Critical | 9 |
| High | 9 |
| Medium | 28 |

MegaLens ran four models from different companies on this file: Grok 4.1 Fast, DeepSeek V3.2, Gemini 3.1 Pro and GPT 5.4.

### The delta: 26 additional findings

Issues that the single model missed but MegaLens caught:

- **JWT username path traversal** in upload directory construction (forged JWT claim)
- **Webhook connections hang forever** (no timeout or error handler on outbound HTTP)
- **Synchronous file I/O** blocking the event loop under load
- **Missing CORS configuration**
- **Password data in error messages** (clear-text leak via SQLite errors)
- **JWT algorithm confusion** (algorithm unspecified in `jwt.sign`)
- **Predictable API keys** (`base64(username:timestamp)` is not entropy)
- **Missing rate limiting** on authentication endpoints
- **No database transactions** in money transfers (concurrent double-spend)
- **Registration input validation** completely absent
- **User enumeration** via distinct login error messages

### Why multi-engine matters

When only one model flags something the others missed, that is where to look closer. Disagreements between models surface risks that one model alone will miss.

### Performance

| Metric | Value |
|--------|-------|
| Models | Grok 4.1 Fast, DeepSeek V3.2, Gemini 3.1 Pro, GPT 5.4 |
| Total time | 238s (4.0 min) |
| Total cost | $0.31 (BYOK via OpenRouter) |

## Review outputs

- [`results/cursor-solo-review.txt`](results/cursor-solo-review.txt) - Cursor Agent solo findings
- The MegaLens findings table and a setup status printout were removed on 23 September 2026 because they showed internal role labels. The findings are summarized above.

## Try it yourself

1. Clone this repo
2. Install MegaLens MCP in your IDE ([setup guide](https://megalens.ai/extensions/mcp))
3. Run `megalens_debate` with `skill: "security_audit"` on `server.js`
4. Compare your IDE's solo findings vs MegaLens multi-engine results

## License

MIT
