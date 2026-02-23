import type {ToolDefinition} from './ToolDefinition.js';
import type {ToolCategory} from './categories.js';

export interface JSHookToolDefinition extends ToolDefinition {
  requiresAI?: boolean;
  requiresBrowser?: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, JSHookToolDefinition>();
  private readonly aliases = new Map<string, string>();

  register(tool: JSHookToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool name conflict: ${tool.name}`);
    }
    if (this.aliases.has(tool.name)) {
      throw new Error(`Tool name conflicts with alias: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    for (const alias of tool.aliases ?? []) {
      if (alias === tool.name) {
        continue;
      }
      if (this.tools.has(alias) || this.aliases.has(alias)) {
        throw new Error(`Tool alias conflict: ${alias}`);
      }
      this.aliases.set(alias, tool.name);
    }
  }

  registerMany(tools: JSHookToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): JSHookToolDefinition | undefined {
    const canonical = this.aliases.get(name) ?? name;
    return this.tools.get(canonical);
  }

  getByCategory(category: ToolCategory): JSHookToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.annotations.category === category,
    );
  }

  values(): JSHookToolDefinition[] {
    return Array.from(this.tools.values());
  }

  aliasesFor(name: string): string[] {
    return Array.from(this.aliases.entries())
      .filter(([, canonical]) => canonical === name)
      .map(([alias]) => alias);
  }

  aliasEntries(): Array<{alias: string; canonical: string}> {
    return Array.from(this.aliases.entries()).map(([alias, canonical]) => ({alias, canonical}));
  }

  validateName(name: string): boolean {
    return !this.tools.has(name) && !this.aliases.has(name);
  }
}
