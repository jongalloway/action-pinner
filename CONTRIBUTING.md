# Contributing to action-pinner

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/jongalloway/action-pinner.git
cd action-pinner
npm install
npm run build
```

## Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run the checks:

```bash
npm run lint    # Type-check (tsc --noEmit)
npm run build   # Compile TypeScript
npm test        # Run tests (Vitest)
```

4. Open a pull request against `main`

## Code Style

- TypeScript with strict mode
- No runtime dependencies beyond what's in `package.json`
- Tests live in `tests/` and use Vitest

## Reporting Issues

Open an issue at [github.com/jongalloway/action-pinner/issues](https://github.com/jongalloway/action-pinner/issues). Include:

- What you expected vs. what happened
- Steps to reproduce
- Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
