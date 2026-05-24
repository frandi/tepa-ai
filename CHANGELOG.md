# Changelog

All notable changes to the `@tepa/*` packages are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All published `@tepa/*` packages are released together under a shared version line.

## [0.2.0] - 2026-05-24

First coordinated release since 0.1.1 (2026-03-17). Includes breaking changes to
the model configuration shape and the logger interface, plus a new optional
observability adapter package.

### Added

- **`@tepa/observability-llmvantage` (new package)** — optional adapter that
  bridges Tepa provider logs with [llmvantage](https://www.npmjs.com/package/llmvantage)
  for cost tracking and cross-SDK observability. `llmvantage` is an optional
  peer dependency.
- **Cache token and pricing fields** on LLM types (`@tepa/types`), enabling
  accurate cost reporting in provider logs and downstream consumers.
- **Executor tier split (low / high)** in pipeline configuration, with per-phase
  model selection (`@tepa/core`).
- **Per-role reasoning effort** in model config; forwarded by the OpenAI and
  Gemini providers (`@tepa/types`, `@tepa/provider-openai`,
  `@tepa/provider-gemini`).
- **Pluggable `TepaLogger` interface** replacing the previous verbosity-tier
  system (`@tepa/core`, `@tepa/types`).
- **`TepaLogMeta.decorative` flag** so cosmetic log lines can be skipped on
  non-console channels (e.g. file/JSON sinks).
- **Provider-owned model catalog** with configurable `allowedModels`
  (`@tepa/provider-core` and each provider package).
- **`preventDefault()` event system** and improved default pipeline logging.
- New model entries:
  - `claude-opus-4-7` (`@tepa/provider-anthropic`)
  - `gpt-5.4-mini` (`@tepa/provider-openai`)
  - `gemini-3.5-flash` (`@tepa/provider-gemini`)
- Clearer "missing API key" error messages and Windows-compatible demo scripts.

### Changed

- **BREAKING** — Executor configuration reshaped around low/high tiers and
  per-phase model selection. Existing `config.yaml` files using the old
  single-executor shape need to migrate. See `docs/05-configuration.md`.
- **BREAKING** — Verbosity tiers replaced by the `TepaLogger` interface.
  Consumers passing a verbosity number must now provide a logger implementation
  (or rely on the default console logger).
- **BREAKING** — LLM type additions (cache tokens, pricing) change the shape
  returned by providers; custom providers implementing `@tepa/provider-core`
  must populate the new fields.
- Docs reframed Tepa as a runtime harness for AI agents and updated the
  configuration and API reference for the new executor tiers.

### Fixed

- Per-model token attribution and double-counted evaluation budget.
- Gemini provider tool-use handling.

### Internal

- Per-session pino file logging in demo apps.
- `study-plan` demo switched from Anthropic to OpenAI provider.
- `student-progress` demo retuned to `gemini-3.5-flash` with per-role reasoning
  and wired up cost summaries.
- `api-client-gen` demo cycles reduced by pinning the task contract and
  hardening `http_request`.
- Prettier formatting applied across docs, packages, and demos.

### Packages released

All published at `0.2.0`:

- `@tepa/core`
- `@tepa/types`
- `@tepa/tools`
- `@tepa/provider-core`
- `@tepa/provider-anthropic`
- `@tepa/provider-openai`
- `@tepa/provider-gemini`
- `@tepa/observability-llmvantage` *(first publish)*

## [0.1.1] - 2026-03-17

Previous release. Changelog not retroactively reconstructed; see git history
between the initial publish and `0.1.1` tag for details.

[0.2.0]: https://github.com/frandi/tepa-ai/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/frandi/tepa-ai/releases/tag/v0.1.1
