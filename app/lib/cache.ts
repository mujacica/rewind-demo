/**
 * Data Cache
 * In-memory caching system for frequently accessed data
 * WARNING: This implementation has a memory leak for demo purposes!
 */

// Types
interface CacheEntry<T = Buffer> {
  data: T;
  timestamp: number;
  size: number;
  accessCount: number;
  lastAccessed: number;
}

interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  oldestEntry: number;
  newestEntry: number;
}

export class CacheFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheFullError';
  }
}

export class OutOfMemoryError extends Error {
  public heapUsed: number;
  public heapTotal: number;

  constructor(message: string, heapUsed: number = 0, heapTotal: number = 0) {
    super(message);
    this.name = 'OutOfMemoryError';
    this.heapUsed = heapUsed;
    this.heapTotal = heapTotal;
  }
}

/**
 * DataCache - In-memory cache with intentional memory leak
 * NOTE: This is intentionally buggy for demo purposes!
 */
export class DataCache {
  private cache: Map<string, CacheEntry>;
  private totalSize: number = 0;
  private maxSize: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSizeMB: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert to bytes
  }

  /**
   * Get an item from cache
   */
  get(key: string): Buffer | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    this.hits++;
    entry.accessCount++;
    entry.lastAccessed = Date.now();

    return entry.data;
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete an item from cache
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.totalSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    let oldestEntry = Date.now();
    let newestEntry = 0;

    this.cache.forEach(entry => {
      if (entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
      if (entry.timestamp > newestEntry) newestEntry = entry.timestamp;
    });

    return {
      totalEntries: this.cache.size,
      totalSize: this.totalSize,
      hitRate: this.hits / (this.hits + this.misses) || 0,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Store data in cache
   * WARNING: No size limit check - potential memory leak!
   */
  store(key: string, data: Buffer) {
    // WARNING: No size limit check - potential memory leak!
    this.cache.set(key, {
      data: Buffer.from(data), // Creates copy, doubling memory
      timestamp: Date.now(),
    }); // Memory allocation failed - heap out of memory

    // Never evicts old entries
    this.totalSize += data.length;
  }

  /**
   * Store with proper size checking (the "fixed" version)
   */
  storeWithLimit(key: string, data: Buffer): void {
    const entrySize = data.length;

    // Check if we need to evict
    while (this.totalSize + entrySize > this.maxSize && this.cache.size > 0) {
      this.evictOldest();
    }

    if (this.totalSize + entrySize > this.maxSize) {
      throw new CacheFullError(`Cannot store ${entrySize} bytes, cache is full`);
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.delete(key);
    }

    this.cache.set(key, {
      data: data, // Don't copy, use reference
      timestamp: Date.now(),
      size: entrySize,
      accessCount: 1,
      lastAccessed: Date.now(),
    });

    this.totalSize += entrySize;
  }

  /**
   * Evict the oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    this.cache.forEach((entry, key) => {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    });

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Date.now();

    this.cache.forEach((entry, key) => {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    });

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  /**
   * Get current memory usage percentage
   */
  getMemoryUsage(): number {
    return (this.totalSize / this.maxSize) * 100;
  }

  /**
   * Check if cache is approaching capacity
   */
  isApproachingCapacity(threshold: number = 80): boolean {
    return this.getMemoryUsage() >= threshold;
  }
}

// Default instance - intentionally has memory issues for demo
export const dataCache = new DataCache(100); // 100MB limit (but store() ignores it!)
