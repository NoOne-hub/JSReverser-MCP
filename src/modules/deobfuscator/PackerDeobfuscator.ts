/**
 * Packer反混淆器
 * 专门用于处理Dean Edwards' Packer混淆的JavaScript代码
 * 
 * Packer特征：
 * 1. eval(function(p,a,c,k,e,d){...})(...) 模式
 * 2. 使用62进制或更高进制编码
 * 3. 字符串数组存储
 * 4. 自解压缩逻辑
 * 
 * 参考资料：
 * - Dean Edwards' Packer: http://dean.edwards.name/packer/
 * - 在线解包工具: https://matthewfl.com/unPacker.html
 */

import { logger } from '../../utils/logger.js';

/**
 * Packer反混淆选项
 */
export interface PackerDeobfuscatorOptions {
  code: string;
  maxIterations?: number;  // 最大解包迭代次数
}

/**
 * Packer反混淆结果
 */
export interface PackerDeobfuscatorResult {
  code: string;
  success: boolean;
  iterations: number;
  warnings: string[];
}

/**
 * Packer反混淆器
 */
export class PackerDeobfuscator {
  /**
   * 检测是否为Packer混淆
   */
  static detect(code: string): boolean {
    // 检测典型的Packer模式
    const packerPattern = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;
    return packerPattern.test(code);
  }

  /**
   * 反混淆Packer代码
   */
  async deobfuscate(options: PackerDeobfuscatorOptions): Promise<PackerDeobfuscatorResult> {
    const { code, maxIterations = 5 } = options;

    logger.info('📦 开始Packer反混淆...');

    const warnings: string[] = [];
    let currentCode = code;
    let iterations = 0;

    try {
      // 循环解包，直到不再是Packer格式
      while (PackerDeobfuscator.detect(currentCode) && iterations < maxIterations) {
        const unpacked = this.unpack(currentCode);

        if (!unpacked || unpacked === currentCode) {
          warnings.push('解包失败或已达到最终状态');
          break;
        }

        currentCode = unpacked;
        iterations++;
        logger.info(`📦 完成第 ${iterations} 次解包`);
      }

      logger.info(`✅ Packer反混淆完成，共 ${iterations} 次迭代`);

      return {
        code: currentCode,
        success: true,
        iterations,
        warnings,
      };
    } catch (error) {
      logger.error('Packer反混淆失败', error);
      return {
        code: currentCode,
        success: false,
        iterations,
        warnings: [...warnings, String(error)],
      };
    }
  }

  /**
   * 解包单次Packer混淆
   */
  private unpack(code: string): string {
    // 1. 提取Packer参数
    const match = code.match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*{([\s\S]*?)}\s*\((.*?)\)\s*\)/
    );

    if (!match || !match[2]) {
      return code;
    }

    const args = match[2];

    // 2. 解析参数
    const params = this.parsePackerParams(args);
    if (!params) {
      return code;
    }

    // 3. 执行解包
    try {
      const unpacked = this.executeUnpacker(params);
      return unpacked || code;
    } catch (error) {
      logger.warn('解包执行失败', error);
      return code;
    }
  }

  /**
   * 解析Packer参数
   */
  private parsePackerParams(argsString: string): {
    p: string;
    a: number;
    c: number;
    k: string[];
    e: Function;
    d: Function;
  } | null {
    try {
      // 使用Function构造器安全地解析参数
      // eslint-disable-next-line no-new-func
      const parseFunc = new Function(`return [${argsString}];`);
      const params = parseFunc();

      if (params.length < 4) {
        return null;
      }

      return {
        p: params[0] || '',
        a: params[1] || 0,
        c: params[2] || 0,
        k: (params[3] || '').split('|'),
        e: params[4] || function (c: any) { return c; },
        d: params[5] || function () { return ''; },
      };
    } catch {
      return null;
    }
  }

  /**
   * 执行解包器
   */
  private executeUnpacker(
    params: { p: string; a: number; c: number; k: string[]; e: Function; d: Function }
  ): string {
    const { p, a, k } = params;
    let { c } = params;

    // 标准Packer解包逻辑
    let result = p;

    // 替换所有编码的标识符
    while (c--) {
      const replacement = k[c];
      if (replacement) {
        const pattern = new RegExp('\\b' + this.base(c, a) + '\\b', 'g');
        result = result.replace(pattern, replacement);
      }
    }

    return result;
  }

  /**
   * 进制转换（Packer使用的编码方式）
   */
  private base(num: number, radix: number): string {
    const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    if (num === 0) {
      return '0';
    }

    let result = '';
    while (num > 0) {
      result = digits[num % radix] + result;
      num = Math.floor(num / radix);
    }

    return result || '0';
  }

  /**
   * 美化解包后的代码
   */
  beautify(code: string): string {
    // 简单的代码美化
    let result = code;

    // 添加换行
    result = result.replace(/;/g, ';\n');
    result = result.replace(/{/g, '{\n');
    result = result.replace(/}/g, '\n}\n');

    // 移除多余的空行
    result = result.replace(/\n\n+/g, '\n\n');

    return result.trim();
  }
}

/**
 * AAEncode反混淆器
 * 处理颜文字编码的JavaScript
 */
export class AAEncodeDeobfuscator {
  /**
   * 检测是否为AAEncode
   */
  static detect(code: string): boolean {
    // AAEncode使用颜文字字符
    return code.includes('゜-゜') || code.includes('ω゜') || code.includes('o゜)');
  }

  /**
   * 反混淆AAEncode代码
   */
  async deobfuscate(code: string): Promise<string> {
    logger.info('😊 开始AAEncode反混淆...');

    try {
      // AAEncode本质上是可执行的JavaScript
      // 使用Function构造器执行并获取结果
      // eslint-disable-next-line no-new-func
      const decoded = new Function(`return (${code})`)();

      logger.info('✅ AAEncode反混淆完成');
      return decoded;
    } catch (error) {
      logger.error('AAEncode反混淆失败', error);
      return code;
    }
  }
}

/**
 * URLEncode反混淆器
 * 处理URL编码的JavaScript
 */
export class URLEncodeDeobfuscator {
  /**
   * 检测是否为URLEncode
   */
  static detect(code: string): boolean {
    // 检测大量的%编码
    const percentCount = (code.match(/%[0-9A-Fa-f]{2}/g) || []).length;
    return percentCount > 10;
  }

  /**
   * 反混淆URLEncode代码
   */
  async deobfuscate(code: string): Promise<string> {
    logger.info('🔗 开始URLEncode反混淆...');

    try {
      const decoded = decodeURIComponent(code);
      logger.info('✅ URLEncode反混淆完成');
      return decoded;
    } catch (error) {
      logger.error('URLEncode反混淆失败', error);
      return code;
    }
  }
}

/**
 * 通用解包器
 * 自动检测并应用合适的反混淆器
 */
export class UniversalUnpacker {
  private packerDeobfuscator = new PackerDeobfuscator();
  private aaencodeDeobfuscator = new AAEncodeDeobfuscator();
  private urlencodeDeobfuscator = new URLEncodeDeobfuscator();

  /**
   * 自动检测并反混淆
   */
  async deobfuscate(code: string): Promise<{
    code: string;
    type: string;
    success: boolean;
  }> {
    logger.info('🔍 自动检测混淆类型...');

    // 1. 检测Packer
    if (PackerDeobfuscator.detect(code)) {
      logger.info('检测到: Packer混淆');
      const result = await this.packerDeobfuscator.deobfuscate({ code });
      return {
        code: result.code,
        type: 'Packer',
        success: result.success,
      };
    }

    // 2. 检测AAEncode
    if (AAEncodeDeobfuscator.detect(code)) {
      logger.info('检测到: AAEncode混淆');
      const decoded = await this.aaencodeDeobfuscator.deobfuscate(code);
      return {
        code: decoded,
        type: 'AAEncode',
        success: decoded !== code,
      };
    }

    // 3. 检测URLEncode
    if (URLEncodeDeobfuscator.detect(code)) {
      logger.info('检测到: URLEncode混淆');
      const decoded = await this.urlencodeDeobfuscator.deobfuscate(code);
      return {
        code: decoded,
        type: 'URLEncode',
        success: decoded !== code,
      };
    }

    logger.info('未检测到已知的混淆类型');
    return {
      code,
      type: 'Unknown',
      success: false,
    };
  }
}

