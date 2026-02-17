# Tests

This directory contains tests for the js-reverse-mcp project.

## Directory Structure

```
tests/
├── setup.js                 # Test setup and configuration
├── unit/                    # Unit tests
│   └── services/           # Service layer tests
│       └── GeminiProvider.test.ts
├── integration/             # Integration tests
│   └── gemini-cli.integration.test.ts
├── manual/                  # Manual test scripts
│   └── test-gemini-provider.ts
└── README.md               # This file
```

## Running Tests

### Unit Tests

Run all unit tests:
```bash
npm test
```

Run tests without rebuilding:
```bash
npm run test:only:no-build
```

Run only specific tests (marked with `.only`):
```bash
npm run test:only
```

### Integration Tests

Integration tests verify the actual behavior of components with real dependencies:

```bash
# Run all tests including integration tests
npm test

# Run only integration tests
npm test -- tests/integration/
```

**Note:** Integration tests for Gemini CLI require `gemini-cli` to be installed:
```bash
npm install -g @google/generative-ai-cli
```

If `gemini-cli` is not available, those tests will be skipped with a warning.

### Manual Tests

Manual tests are standalone scripts that can be run directly:

```bash
# Test GeminiProvider
node --experimental-strip-types tests/manual/test-gemini-provider.ts
```

## Writing Tests

### Unit Tests

Unit tests use Node.js built-in test runner. Example:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MyModule', () => {
  it('should do something', () => {
    assert.strictEqual(1 + 1, 2);
  });
});
```

### Test Organization

- Place unit tests in `tests/unit/` mirroring the source structure
- Place integration tests in `tests/integration/`
- Use `.test.ts` suffix for test files
- Use `.integration.test.ts` suffix for integration test files
- Group related tests using `describe` blocks
- Use descriptive test names with `it` blocks

### Unit vs Integration Tests

**Unit Tests:**
- Test individual components in isolation
- Use mocks and stubs for dependencies
- Fast execution
- No external dependencies required

**Integration Tests:**
- Test components with real dependencies
- Verify actual behavior with external systems
- May require setup (e.g., installing CLI tools)
- Tests may be skipped if dependencies are unavailable

## Test Coverage

The project aims for 80% test coverage. Run tests with coverage:

```bash
npm test
```

## CI/CD

Tests are automatically run on every commit in the CI pipeline.
