// Tiny synthesized effects keep the project asset-free and avoid an audio library.
export function createGameAudio(toggleButton) {
  let context;
  let enabled = true;

  function tone(frequency, duration, waveform = 'sine', volume = 0.035, delay = 0) {
    if (!enabled) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    context ??= new AudioContextClass();
    if (context.state === 'suspended') context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + delay;
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }

  toggleButton.addEventListener('click', () => {
    enabled = !enabled;
    toggleButton.textContent = `Sound: ${enabled ? 'on' : 'off'}`;
    toggleButton.setAttribute('aria-pressed', String(enabled));
  });

  return {
    jump() { tone(390, 0.11, 'triangle', 0.025); },
    land() { tone(125, 0.09, 'sine', 0.04); },
    switch() {
      tone(520, 0.24, 'sine', 0.045);
      tone(780, 0.38, 'triangle', 0.035, 0.11);
    },
    bridge() {
      tone(110, 0.72, 'sawtooth', 0.018);
      tone(220, 0.62, 'triangle', 0.025, 0.16);
    },
    complete() {
      [523, 659, 784, 1046].forEach((frequency, index) => {
        tone(frequency, 0.55, 'sine', 0.035, index * 0.12);
      });
    },
    error() {
      tone(190, 0.16, 'square', 0.025);
      tone(145, 0.2, 'triangle', 0.025, 0.12);
    },
  };
}
