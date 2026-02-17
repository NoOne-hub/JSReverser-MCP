import type {ToolDefinition} from './ToolDefinition.js';
import type {ToolCategory} from './categories.js';

export interface JSHookToolDefinition extends ToolDefinition {
  requiresAI?: boolean;
  requiresBrowser?: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, JSHookToolDefinition>();

  register(tool: JSHookToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool name conflict: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: JSHookToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): JSHookToolDefinition | undefined {
    return this.tools.get(name);
  }

  getByCategory(category: ToolCategory): JSHookToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.annotations.category === category,
    );
  }

  values(): JSHookToolDefinition[] {
    return Array.from(this.tools.values());
  }

  validateName(name: string): boolean {
    return !this.tools.has(name);
  }
}
