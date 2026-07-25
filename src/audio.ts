let audioCtx: AudioContext | null = null;

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playClickSound() {
  try {
    const ctx = getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // A premium, modern UI "thock" or tap sound (like a high-quality app)
    osc.type = 'sine';
    // Very rapid pitch drop creates a subtle physical 'tap' feel
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.02);

    // Fast, punchy volume decay
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.setTargetAtTime(0.001, ctx.currentTime, 0.01);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch (e) {
    // Silently ignore if audio context can't be created (e.g. before user interaction)
  }
}
