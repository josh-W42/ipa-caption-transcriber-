import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ringBuffer';

describe('RingBuffer', () => {
  it('reads back what was written', () => {
    const rb = new RingBuffer(10);
    rb.write(Float32Array.from([1, 2, 3]));
    expect(Array.from(rb.readLast(3))).toEqual([1, 2, 3]);
    expect(rb.length).toBe(3);
  });

  it('returns only what exists when asked for more than was written', () => {
    const rb = new RingBuffer(10);
    rb.write(Float32Array.from([1, 2]));
    expect(Array.from(rb.readLast(5))).toEqual([1, 2]);
  });

  it('overwrites oldest samples once capacity is exceeded', () => {
    const rb = new RingBuffer(4);
    rb.write(Float32Array.from([1, 2, 3, 4, 5, 6]));
    expect(rb.length).toBe(4);
    expect(Array.from(rb.readLast(4))).toEqual([3, 4, 5, 6]);
  });

  it('reads correctly across the wrap point', () => {
    const rb = new RingBuffer(5);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.write(Float32Array.from([4, 5, 6, 7])); // wraps
    expect(Array.from(rb.readLast(5))).toEqual([3, 4, 5, 6, 7]);
  });

  it('handles a single write larger than capacity', () => {
    const rb = new RingBuffer(3);
    rb.write(Float32Array.from([1, 2, 3, 4, 5]));
    expect(Array.from(rb.readLast(3))).toEqual([3, 4, 5]);
  });

  it('readAll returns everything in order', () => {
    const rb = new RingBuffer(100);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.write(Float32Array.from([4, 5]));
    expect(Array.from(rb.readAll())).toEqual([1, 2, 3, 4, 5]);
  });

  it('clear resets length without reallocating', () => {
    const rb = new RingBuffer(5);
    rb.write(Float32Array.from([1, 2, 3]));
    rb.clear();
    expect(rb.length).toBe(0);
    expect(Array.from(rb.readAll())).toEqual([]);
    rb.write(Float32Array.from([9]));
    expect(Array.from(rb.readAll())).toEqual([9]);
  });
});
