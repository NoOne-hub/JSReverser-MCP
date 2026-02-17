/**
 * Type definitions for Code Collector module
 */

export interface CodeFile {
  url: string;
  content: string;
  size: number;
  type: 'inline' | 'external' | 'dynamic' | 'service-worker' | 'web-worker';
  loadTime?: number;
  metadata?: Record<string, unknown>;
}

export interface CollectCodeOptions {
  url: string;
  timeout?: number;
  includeInline?: boolean;
  includeServiceWorker?: boolean;
  includeWebWorker?: boolean;
  includeDynamic?: boolean;
  smartMode?: 'summary' | 'priority' | 'incremental' | 'full';
  compress?: boolean;
  streaming?: boolean;
  maxTotalSize?: number;
  maxFileSize?: number;
  priorities?: string[];
  dynamicWaitMs?: number;
}

export interface CollectCodeResult {
  files: CodeFile[];
  dependencies: DependencyGraph;
  totalSize: number;
  collectTime: number;
  summaries?: Array<{
    url: string;
    size: number;
    type: string;
    hasEncryption: boolean;
    hasAPI: boolean;
    hasObfuscation: boolean;
    functions: string[];
    imports: string[];
    preview: string;
  }>;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyNode {
  id: string;
  url: string;
  type: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: 'import' | 'require' | 'script';
}
