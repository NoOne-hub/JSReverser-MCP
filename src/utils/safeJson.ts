/**
 * 安全的 JSON 操作工具
 *
 * 功能：
 * - 处理循环引用
 * - 处理 BigInt
 * - 处理特殊对象（Error、RegExp、Date等）
 * - 提供友好的错误处理
 */

/**
 * 安全的 JSON.stringify
 *
 * @param data 要序列化的数据
 * @param space 缩进空格数（可选）
 * @param maxDepth 最大深度（默认10，防止深层嵌套）
 * @returns JSON 字符串，失败时返回错误描述
 */
export function safeStringify(data: any, space?: number, maxDepth = 10): string {
  const seen = new WeakSet();
  let depth = 0;

  const replacer = (key: string, value: any): any => {
    // 处理 undefined
    if (value === undefined) {
      return '[undefined]';
    }

    // 处理 BigInt
    if (typeof value === 'bigint') {
      return `[BigInt: ${value.toString()}]`;
    }

    // 处理函数
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }

    // 处理 Symbol
    if (typeof value === 'symbol') {
      return `[Symbol: ${value.toString()}]`;
    }

    // 处理特殊对象
    if (value instanceof Error) {
      return {
        __type: 'Error',
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    if (value instanceof RegExp) {
      return {
        __type: 'RegExp',
        source: value.source,
        flags: value.flags,
      };
    }

    if (value instanceof Date) {
      return {
        __type: 'Date',
        value: value.toISOString(),
      };
    }

    // 处理对象和数组
    if (value !== null && typeof value === 'object') {
      // 深度限制
      depth++;
      if (depth > maxDepth) {
        depth--;
        return '[Max depth exceeded]';
      }

      // 循环引用检测
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);

      // 正常返回
      const result = value;
      depth--;
      return result;
    }

    return value;
  };

  try {
    return JSON.stringify(data, replacer, space);
  } catch (error) {
    // 如果还是失败，返回错误描述
    return `[Serialization Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * 安全的 JSON.parse
 *
 * @param text JSON 字符串
 * @returns 解析后的对象，失败时返回 null
 */
export function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}
