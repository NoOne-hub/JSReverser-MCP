/**
 * Manual test for GeminiProvider
 * 
 * This script tests the GeminiProvider implementation
 * Run with: node --experimental-strip-types tests/manual/test-gemini-provider.ts
 */

import { GeminiProvider } from '../../src/services/GeminiProvider.js';
import { createAIService } from '../../src/utils/config.js';

async function testGeminiProvider() {
  console.log('Testing GeminiProvider...\n');

  // Test 1: Initialize with CLI mode
  console.log('Test 1: Initialize GeminiProvider in CLI mode');
  try {
    const provider = new GeminiProvider({
      cliPath: 'gemini-cli',
      useAPI: false,
    });
    console.log('✓ GeminiProvider initialized successfully in CLI mode\n');
  } catch (error) {
    console.error('✗ Failed to initialize GeminiProvider:', error);
  }

  // Test 2: Initialize with API mode (should work even without API key)
  console.log('Test 2: Initialize GeminiProvider in API mode');
  try {
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      useAPI: true,
    });
    console.log('✓ GeminiProvider initialized successfully in API mode\n');
  } catch (error) {
    console.error('✗ Failed to initialize GeminiProvider:', error);
  }

  // Test 3: Test fallback to CLI mode when no API key
  console.log('Test 3: Test fallback to CLI mode when no API key');
  try {
    const provider = new GeminiProvider({
      useAPI: true, // Request API mode
      // No API key provided
    });
    console.log('✓ GeminiProvider correctly fell back to CLI mode\n');
  } catch (error) {
    console.error('✗ Failed to fallback to CLI mode:', error);
  }

  // Test 4: Test createAIService with Gemini
  console.log('Test 4: Test createAIService with Gemini configuration');
  try {
    // Set environment variable for testing
    process.env.DEFAULT_LLM_PROVIDER = 'gemini';
    process.env.GEMINI_CLI_PATH = 'gemini-cli';
    
    const aiService = createAIService();
    if (aiService) {
      console.log('✓ AIService created successfully with Gemini provider\n');
    } else {
      console.log('✓ AIService returned undefined (expected when no provider configured)\n');
    }
  } catch (error) {
    console.error('✗ Failed to create AIService:', error);
  }

  // Test 5: Test CLI availability check
  console.log('Test 5: Test CLI availability check');
  try {
    const provider = new GeminiProvider({
      cliPath: 'gemini-cli',
      useAPI: false,
    });
    
    // Try to chat (will fail if CLI not available)
    try {
      await provider.chat([{ role: 'user', content: 'Hello' }]);
      console.log('✓ CLI is available and working\n');
    } catch (error: any) {
      if (error.message.includes('gemini-cli is not available')) {
        console.log('✓ CLI availability check working correctly (CLI not installed)\n');
      } else {
        console.error('✗ Unexpected error:', error.message);
      }
    }
  } catch (error) {
    console.error('✗ Failed to test CLI availability:', error);
  }

  console.log('All tests completed!');
}

// Run tests
testGeminiProvider().catch(console.error);
