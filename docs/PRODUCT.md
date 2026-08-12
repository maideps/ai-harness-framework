# Product Overview

## Purpose

AI Harness Framework is a reusable project harness for engineering teams that want coding-agent sessions to be:

- restartable across sessions
- scoped to one verifiable feature at a time
- explicit about progress, decisions, and blockers
- portable across different application stacks

The product is the harness itself: instructions, state files, verification entrypoints, and templates that another development repository can adopt with minimal customization.

## Primary Users

- engineers using AI coding agents in real repositories
- teams standardizing multi-session implementation workflows
- maintainers creating new project templates with durable agent guidance

## Key User Flows

1. **Bootstrap a new project**
   - Copy or adapt the framework files into a target repository.
   - Customize `AGENTS.md`, `feature_list.json`, `init.sh`, and the docs for the target stack.
   - Run `./init.sh` and `make check` to confirm the harness is operational.

2. **Run an implementation session**
   - Read the root instructions and current state files.
   - Select exactly one active feature.
   - Implement changes, run verification, and record evidence before declaring completion.

3. **Resume work in a later session**
   - Start from `progress.md`, `feature_list.json`, `DECISIONS.md`, and `session-handoff.md`.
   - Recover the current objective without relying on chat history.
   - Continue from a clean, restartable repository state.

## Product Requirements

- The framework must remain generic enough to work for JavaScript, Python, Go, Rust, and similar dev projects.
- The repository must provide a canonical contract for:
  - feature tracking
  - session continuity
  - verification
  - architecture enforcement
  - end-of-session cleanup
- Verification should rely on tools commonly available in engineering environments and avoid unnecessary framework lock-in.

## Feature Roadmap

See `feature_list.json` for the current framework roadmap and verification gates.

## Non-Goals

- shipping a single opinionated application scaffold for one tech stack
- replacing project-specific architecture or product docs in adopting repositories
- embedding model-vendor-specific behavior as a hard requirement for the framework

## References

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design and constraints
- [DECISIONS.md](../DECISIONS.md) — Why we made key choices