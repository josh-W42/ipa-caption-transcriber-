import type { FromWorker } from './worker';

export interface LoadProgress {
  file: string;
  progress: number;
}

/**
 * Promise-based wrapper around the ASR worker.
 *
 * Audio buffers are transferred rather than copied. Transferring NEUTERS the source
 * buffer, so callers must hand over a copy when they still need the samples.
 */
export class AsrClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>();
  private readyResolve?: (info: ReadyInfo) => void;
  private readyReject?: (e: Error) => void;

  onProgress?: (p: LoadProgress) => void;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
    this.worker.onerror = (e) => {
      const err = new Error(`ASR worker failed: ${e.message}`);
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
        this.readyResolve?.({ device: msg.device, loadSeconds: msg.loadSeconds });
        break;
      case 'result': {
        this.pending.get(msg.id)?.resolve({ text: msg.text, seconds: msg.seconds });
        this.pending.delete(msg.id);
        break;
      }
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

  load(model?: string): Promise<ReadyInfo> {
    const p = new Promise<ReadyInfo>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.worker.postMessage({ type: 'load', model });
    return p;
  }

  /** Transfers `audio` — the caller's copy is neutered afterwards. */
  transcribe(audio: Float32Array): Promise<Result> {
    const id = this.nextId++;
    const p = new Promise<Result>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
    return p;
  }

  dispose(): void {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('ASR client disposed')));
    this.pending.clear();
  }
}

export interface ReadyInfo {
  device: string;
  loadSeconds: number;
}

export interface Result {
  text: string;
  seconds: number;
}
