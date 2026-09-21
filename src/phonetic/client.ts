import type { FromWorker } from './worker';
import type { DecodedPhone } from './ctc';

export interface PhoneticReady {
  device: string;
  loadSeconds: number;
  vocabSize: number;
}

export interface PhoneticResult {
  phones: DecodedPhone[];
  seconds: number;
  msPerFrame: number;
}

/**
 * Promise-based wrapper around the phoneme worker.
 *
 * Mirrors AsrClient deliberately, including the transfer semantics: audio buffers are
 * transferred rather than copied, which NEUTERS the caller's copy. Pass a copy when
 * the samples are still needed — and note that the ASR and phoneme workers both want
 * the same audio, so at least one of them must be given a copy.
 */
export class PhoneticClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: PhoneticResult) => void; reject: (e: Error) => void }
  >();
  private readyResolve?: (info: PhoneticReady) => void;
  private readyReject?: (e: Error) => void;

  onProgress?: (p: { file: string; progress: number }) => void;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      const err = new Error(`phoneme worker failed: ${e.message}`);
      this.readyReject?.(err);
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  private handle(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.onProgress?.({ file: msg.file, progress: msg.progress });
        break;
      case 'ready':
        this.readyResolve?.({
          device: msg.device,
          loadSeconds: msg.loadSeconds,
          vocabSize: msg.vocabSize,
        });
        break;
      case 'result':
        this.pending
          .get(msg.id)
          ?.resolve({ phones: msg.phones, seconds: msg.seconds, msPerFrame: msg.msPerFrame });
        this.pending.delete(msg.id);
        break;
      case 'error': {
        const err = new Error(msg.message);
        if (msg.id != null) {
          this.pending.get(msg.id)?.reject(err);
          this.pending.delete(msg.id);
        } else {
          this.readyReject?.(err);
        }
        break;
      }
    }
  }

  load(): Promise<PhoneticReady> {
    const p = new Promise<PhoneticReady>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker.postMessage({ type: 'load' });
    return p;
  }

  /** Transfers `audio` — the caller's copy is neutered afterwards. */
  transcribe(audio: Float32Array): Promise<PhoneticResult> {
    const id = this.nextId++;
    const p = new Promise<PhoneticResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    return p;
  }

  dispose(): void {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('phonetic client disposed')));
    this.pending.clear();
  }
}
