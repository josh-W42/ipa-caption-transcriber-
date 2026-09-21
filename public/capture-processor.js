/**
 * AudioWorklet capture processor.
 *
 * Plain JS in public/ rather than bundled TS: AudioWorklet modules load by URL at
 * runtime and must already be valid JS, and this file is small enough that losing
 * typechecking costs little compared to fighting the bundler over it.
 *
 * Runs on the audio render thread, so it stays allocation-light and does no work
 * beyond forwarding frames. All buffering happens on the main thread.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      // Copy: the audio thread reuses this buffer after process() returns.
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
