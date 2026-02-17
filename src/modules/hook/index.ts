/**
 * Hook 模块公共导出
 */

// 核心构建器
export { HookCodeBuilder } from './HookCodeBuilder.js';
export type {
  HookTarget,
  CaptureOptions,
  ConditionConfig,
  StoreConfig,
  LifecycleCode,
  HookAction,
  BuilderConfig,
} from './HookCodeBuilder.js';

// 类型注册表
export { HookTypeRegistry } from './HookTypeRegistry.js';
export type { HookTypePlugin } from './HookTypeRegistry.js';

// Hook 管理器
export { HookManager } from './HookManager.js';
export type {
  HookCreateOptions,
  HookMeta,
  HookDataRecord,
  HookManagerStats,
} from './HookManager.js';

// AI Hook 生成器
export { AIHookGenerator } from './AIHookGenerator.js';
export type {
  AIHookRequest,
  AIHookTarget,
  AIHookBehavior,
  AIHookCondition,
  AIHookCustomCode,
  AIHookResult,
} from './AIHookGenerator.js';
