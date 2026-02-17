/**
 * 反混淆模块公共导出
 */

// 主管线
export { Deobfuscator } from './Deobfuscator.js';
export type { DeobfuscateFullOptions } from './Deobfuscator.js';

// 子模块
export { AdvancedDeobfuscator } from './AdvancedDeobfuscator.js';
export type { AdvancedDeobfuscateOptions, AdvancedDeobfuscateResult } from './AdvancedDeobfuscator.js';

export { JSVMPDeobfuscator } from './JSVMPDeobfuscator.js';

export { ASTOptimizer } from './ASTOptimizer.js';

export {
  PackerDeobfuscator,
  AAEncodeDeobfuscator,
  URLEncodeDeobfuscator,
  UniversalUnpacker,
} from './PackerDeobfuscator.js';
export type { PackerDeobfuscatorOptions, PackerDeobfuscatorResult } from './PackerDeobfuscator.js';
