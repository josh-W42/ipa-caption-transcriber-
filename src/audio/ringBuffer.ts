/**
 * Fixed-capacity circular buffer of audio samples.
 *
 * Capacity bounds memory during long recordings. This holds only the trailing window
 * the live pass needs — the full-recording pass on stop reads from a separate growing
 * buffer.
 */
export class RingBuffer {
  private buf: Float32Array;
  private writeIdx = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('capacity must be positive');
    this.buf = new Float32Array(capacity);
  }

  get length(): number {
    return this.filled;
  }

  write(samples: Float32Array): void {
    if (samples.length === 0) return;

    // A write larger than capacity: only the tail can survive.
    const src =
      samples.length > this.capacity
        ? samples.subarray(samples.length - this.capacity)
        : samples;

    const firstChunk = Math.min(src.length, this.capacity - this.writeIdx);
    this.buf.set(src.subarray(0, firstChunk), this.writeIdx);
    if (firstChunk < src.length) {
      this.buf.set(src.subarray(firstChunk), 0);
    }

    this.writeIdx = (this.writeIdx + src.length) % this.capacity;
    this.filled = Math.min(this.filled + src.length, this.capacity);
  }

  /** The most recent `n` samples, in chronological order. */
  readLast(n: number): Float32Array {
    const count = Math.min(n, this.filled);
    const out = new Float32Array(count);
    if (count === 0) return out;

    const start = (this.writeIdx - count + this.capacity) % this.capacity;
    const firstChunk = Math.min(count, this.capacity - start);
    out.set(this.buf.subarray(start, start + firstChunk), 0);
    if (firstChunk < count) {
      out.set(this.buf.subarray(0, count - firstChunk), firstChunk);
    }
    return out;
  }

  readAll(): Float32Array {
    return this.readLast(this.filled);
  }

  clear(): void {
    this.writeIdx = 0;
    this.filled = 0;
  }
}
