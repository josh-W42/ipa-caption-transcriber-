import { report } from './ui';

/**
 * R4 — do we actually need cross-origin isolation?
 *
 * The cheapest outcome for the whole project is discovering we never did: WebGPU
 * does not require it, only multithreaded WASM does. If the model probes pass
 * under WebGPU with crossOriginIsolated === false, COOP/COEP leaves the design
 * and R2 evaporates with it.
 */
export async function probeIsolation(): Promise<void> {
  report('R4 crossOriginIsolated', 'info', String(self.crossOriginIsolated));

  report(
    'R4 SharedArrayBuffer',
    'info',
    typeof SharedArrayBuffer !== 'undefined' ? 'available' : 'NOT available',
  );

  report('R4 hardwareConcurrency', 'info', `${navigator.hardwareConcurrency} logical cores`);

  const gpu = (navigator as any).gpu;
  if (!gpu) {
    report('R4 WebGPU', 'fail', 'navigator.gpu absent — WASM fallback only. Expect slow inference.');
    return;
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      report('R4 WebGPU', 'fail', 'navigator.gpu present but requestAdapter() returned null.');
      return;
    }

    const info = adapter.info ?? {};
    const detail = [
      `vendor: ${info.vendor ?? '?'}`,
      `architecture: ${info.architecture ?? '?'}`,
      `description: ${info.description ?? '?'}`,
      `fp16 (shader-f16): ${adapter.features?.has?.('shader-f16') ? 'yes' : 'no'}`,
      `maxBufferSize: ${(adapter.limits?.maxBufferSize / 1e6).toFixed(0)} MB`,
      `maxStorageBufferBindingSize: ${(adapter.limits?.maxStorageBufferBindingSize / 1e6).toFixed(0)} MB`,
    ].join('\n');

    report('R4 WebGPU', 'pass', detail);

    // q4f16 and fp16 dtypes need shader-f16. Without it, int8 (318MB) is the floor.
    if (!adapter.features?.has?.('shader-f16')) {
      report(
        'R4 fp16 support',
        'info',
        'No shader-f16 — q4f16/fp16 dtypes unavailable. Smallest usable becomes q4 (242MB) or int8 (318MB).',
      );
    }
  } catch (err) {
    report('R4 WebGPU', 'fail', String(err));
  }
}
