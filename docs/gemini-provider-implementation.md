# Gemini Provider Implementation

## Overview

This document describes the implementation of the GeminiProvider for the js-reverse-mcp project, which supports both API mode (with API key) and CLI mode (using gemini-cli command).

## Features

### Dual Mode Support

The GeminiProvider supports two modes of operation:

1. **API Mode**: Uses Google's Gemini API directly (requires API key)
2. **CLI Mode**: Uses the `gemini-cli` command-line tool (no API key required)

### Automatic Fallback

If API mode is requested but no API key is provided, the provider automatically falls back to CLI mode.

## Implementation Details

### File Structure

```
src/
├── services/
│   ├── AIService.ts           # Base AI service interface
│   ├── GeminiProvider.ts      # Gemini provider implementation (NEW)
│   ├── OpenAIProvider.ts      # OpenAI provider
│   └── AnthropicProvider.ts   # Anthropic provider
└── utils/
    └── config.ts              # Configuration management (UPDATED)

tests/
├── setup.js                   # Test setup (NEW)
├── unit/
│   └── services/
│       └── GeminiProvider.test.ts  # Unit tests (NEW)
└── manual/
    └── test-gemini-provider.ts     # Manual test script (NEW)
```

### Key Components

#### GeminiProvider Class

Located in `src/services/GeminiProvider.ts`, implements the `AIProvider` interface:

```typescript
interface GeminiConfig {
  apiKey?: string;
  cliPath?: string;
  useAPI?: boolean;
  model?: string;
}

class GeminiProvider implements AIProvider {
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>
  async analyzeImage(imageInput: string, prompt: string, isFilePath?: boolean): Promise<string>
}
```

**Features:**
- Automatic mode selection based on configuration
- CLI availability detection
- Message formatting for CLI input
- CLI command execution with timeout
- Error handling and formatting

#### Configuration Integration

Updated `src/utils/config.ts` to support Gemini configuration:

```typescript
// Environment variables
GEMINI_API_KEY=...           # Optional: API key for API mode
GEMINI_CLI_PATH=gemini-cli   # Optional: Path to gemini-cli command
GEMINI_MODEL=gemini-2.0-flash-exp  # Optional: Model name
DEFAULT_LLM_PROVIDER=gemini  # Set Gemini as default provider
```

The `createAIService()` function now supports creating Gemini provider instances.

## Usage

### Configuration

#### CLI Mode (No API Key Required)

1. Install gemini-cli:
   ```bash
   npm install -g @google/generative-ai-cli
   ```

2. Set environment variables in `.env`:
   ```env
   DEFAULT_LLM_PROVIDER=gemini
   GEMINI_CLI_PATH=gemini-cli
   ```

#### API Mode (Requires API Key)

Set environment variables in `.env`:
```env
DEFAULT_LLM_PROVIDER=gemini
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-2.0-flash-exp
```

### Programmatic Usage

```typescript
import { GeminiProvider } from './services/GeminiProvider.js';
import { AIService } from './services/AIService.js';

// CLI mode
const cliProvider = new GeminiProvider({
  cliPath: 'gemini-cli',
  useAPI: false,
});

// API mode
const apiProvider = new GeminiProvider({
  apiKey: 'your-api-key',
  useAPI: true,
});

// Create AI service
const aiService = new AIService(cliProvider);

// Use the service
const response = await aiService.chat([
  { role: 'user', content: 'Hello, Gemini!' }
]);
```

### Using with Config System

```typescript
import { createAIService } from './utils/config.js';

// Automatically creates the appropriate provider based on environment variables
const aiService = createAIService();

if (aiService) {
  const response = await aiService.chat([
    { role: 'user', content: 'Analyze this code...' }
  ]);
}
```

## CLI Mode Details

### How It Works

1. **Availability Check**: On initialization, checks if `gemini-cli` command is available
2. **Message Formatting**: Converts AIMessage array to CLI-compatible format
3. **Command Execution**: Spawns `gemini-cli` process with appropriate arguments
4. **Output Parsing**: Parses and cleans CLI output
5. **Error Handling**: Handles CLI errors, timeouts, and missing installations

### CLI Command Format

```bash
gemini-cli [--model MODEL] [--temperature TEMP] [--max-tokens TOKENS] [--image PATH] PROMPT
```

### Timeout

CLI commands have a 60-second timeout to prevent hanging.

## API Mode Details

### Current Status

API mode is currently not implemented. When called, it throws:
```
Error: Gemini API mode not yet implemented. Please use CLI mode or install gemini-cli.
```

### Future Implementation

API mode will use Google's official Gemini API SDK when implemented.

## Error Handling

### CLI Not Available

```typescript
{
  message: 'gemini-cli is not available. Please install it:\n' +
           '  npm install -g @google/generative-ai-cli\n' +
           'Or set GEMINI_API_KEY to use API mode.'
}
```

### CLI Execution Failure

```typescript
{
  message: 'gemini-cli exited with code 1\nError: [stderr output]'
}
```

### Timeout

```typescript
{
  message: 'gemini-cli execution timed out after 60 seconds'
}
```

## Testing

### Unit Tests

Located in `tests/unit/services/GeminiProvider.test.ts`:

- Constructor initialization tests
- Mode selection tests
- Error handling tests
- CLI availability tests

Run with:
```bash
npm test
```

### Manual Tests

Located in `tests/manual/test-gemini-provider.ts`:

- Integration with config system
- CLI availability check
- Mode fallback behavior

Run with:
```bash
node --experimental-strip-types tests/manual/test-gemini-provider.ts
```

## Requirements Validation

This implementation satisfies the following requirements:

- **4.4**: Support for Gemini provider
- **4.5**: CLI mode support when API key not configured
- **4.7**: Automatic fallback to CLI mode
- **5.1**: CLI availability detection
- **5.2**: Clear error messages when CLI not available
- **5.3**: CLI command execution via subprocess
- **5.4**: Correct parameter passing to CLI
- **5.5**: Output parsing and standard format return
- **5.6**: Error and timeout handling

## Future Enhancements

1. **API Mode Implementation**: Implement full API mode using Google's SDK
2. **Image Analysis**: Complete image analysis support for CLI mode
3. **Streaming Support**: Add streaming response support
4. **Advanced CLI Options**: Support more CLI options (temperature, top-p, etc.)
5. **Response Caching**: Cache CLI responses to improve performance
6. **Retry Logic**: Add retry logic for transient CLI failures

## Troubleshooting

### CLI Not Found

**Problem**: `gemini-cli is not available`

**Solution**: Install gemini-cli globally:
```bash
npm install -g @google/generative-ai-cli
```

### CLI Timeout

**Problem**: `gemini-cli execution timed out`

**Solution**: 
- Check network connection
- Try with a simpler prompt
- Increase timeout in code if needed

### API Mode Not Working

**Problem**: `Gemini API mode not yet implemented`

**Solution**: Use CLI mode instead by not setting `GEMINI_API_KEY` or setting `useAPI: false`

## References

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Design Document](../../.kiro/specs/jshook-integration/design.md)
- [Requirements Document](../../.kiro/specs/jshook-integration/requirements.md)
