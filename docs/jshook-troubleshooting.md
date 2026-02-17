# JSHook Troubleshooting

## Gemini CLI not found

- Symptom: AI tools fail with CLI not available.
- Fix: Install Gemini CLI and set `GEMINI_CLI_PATH` in `.env` if needed.

## Browser connection failed

- Symptom: `collect_code` or page tools cannot connect to browser.
- Fix: ensure remote debugging is available (`REMOTE_DEBUGGING_PORT`, default `9222`) or set `REMOTE_DEBUGGING_URL`.

## Stealth injection did not apply

- Symptom: `navigator.webdriver` still visible.
- Fix: run `inject_stealth` before navigation-heavy actions and ensure page reload/new page is created.

## AI provider not configured

- Symptom: AI-based tools fail immediately.
- Fix: set one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or configure Gemini API/CLI.
