export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted = false;
  private volume = 0.7;
  private heartbeatInterval: number | null = null;

  constructor(initialMuted = false, initialVolume = 0.7) {
    this.isMuted = initialMuted;
    this.volume = initialVolume;
  }

  private initCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
        muted ? 0 : this.volume,
        this.ctx.currentTime
      );
    }
    if (muted) {
      this.stopHeartbeat();
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  public isMuteActive(): boolean {
    return this.isMuted;
  }

  // --- Procedural Sounds ---

  /**
   * Powerful kick strike thud + transient leather contact
   */
  public playKick(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);

    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.15);

    // Click / leather transient
    this.playNoiseBurst(0.03, 300, 800, 0.4);
  }

  /**
   * Goal net bulging swoosh
   */
  public playNet(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.35);
    filter.Q.value = 2.0;

    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.6, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + 0.4);
  }

  /**
   * Metallic post / crossbar clang
   */
  public playPost(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const freqs = [840, 1310, 2150];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const amp = i === 0 ? 0.7 : 0.35;
      gain.gain.setValueAtTime(amp, t);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.85);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(t);
      osc.stop(t + 0.9);
    });
  }

  /**
   * Keeper dive air whoosh
   */
  public playDive(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(1100, t + 0.12);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.02, t);
    gain.gain.linearRampToValueAtTime(0.45, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + 0.3);
  }

  /**
   * Glove impact on save / fingertip deflection
   */
  public playSave(isFingertip = false): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isFingertip ? 420 : 260, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);

    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.1);

    this.playNoiseBurst(0.04, 500, 1800, 0.35);
  }

  /**
   * Authentic soccer referee whistle (classic triple whistle for Full Time: pip - pip - PEEEEEP!)
   */
  public playWhistle(fullTime = true): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    if (fullTime) {
      // Official full-time whistle pattern: short, short, long
      this.blowSingleWhistle(ctx.currentTime, 0.12, 0.35);
      this.blowSingleWhistle(ctx.currentTime + 0.19, 0.12, 0.35);
      this.blowSingleWhistle(ctx.currentTime + 0.38, 0.55, 0.45);
      this.playGoalCheer();
    } else {
      this.blowSingleWhistle(ctx.currentTime, 0.22, 0.38);
    }
  }

  private blowSingleWhistle(startTime: number, duration: number, volume: number): void {
    const ctx = this.initCtx();
    if (!ctx) return;

    // Dual-tone whistle chamber frequencies (Fox 40 classic: ~2150Hz and ~2380Hz)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(2150, startTime);
    osc2.frequency.setValueAtTime(2380, startTime);

    // Whistle pea-trill (rapid pressure modulation ~24 Hz)
    const trill = ctx.createOscillator();
    const trillGain = ctx.createGain();
    trill.frequency.setValueAtTime(24, startTime);
    trillGain.gain.setValueAtTime(140, startTime);
    trill.connect(osc1.frequency);
    trill.connect(osc2.frequency);

    // Human breath rise and fall envelope
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.025);
    gain.gain.setValueAtTime(volume * 0.9, startTime + duration - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain!);

    trill.start(startTime);
    osc1.start(startTime);
    osc2.start(startTime);

    trill.stop(startTime + duration);
    osc1.stop(startTime + duration);
    osc2.stop(startTime + duration);

    // Airy turbulent breath layer
    this.playWhistleAirBreath(startTime, duration, volume * 0.25);
  }

  private playWhistleAirBreath(startTime: number, duration: number, volume: number): void {
    const ctx = this.initCtx();
    if (!ctx) return;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2250, startTime);
    filter.Q.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(startTime);
    noise.stop(startTime + duration);
  }

  /**
   * Stadium crowd roar / cheer on goal
   */
  public playGoalCheer(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const duration = 2.4;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
    filter.frequency.exponentialRampToValueAtTime(700, t + duration);
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.8, t + 0.4);
    gain.gain.setValueAtTime(0.75, t + 1.2);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + duration);
  }

  /**
   * Stadium crowd groan / sigh on save or miss
   */
  public playGroan(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const duration = 1.3;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(260, t + duration);
    filter.Q.value = 2.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.linearRampToValueAtTime(0.55, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + duration);
  }

  /**
   * Heartbeat thump (sub-bass double thump)
   */
  public playHeartbeatThump(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;

    // First beat
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(62, t);
    osc1.frequency.exponentialRampToValueAtTime(32, t + 0.1);
    gain1.gain.setValueAtTime(0.85, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc1.connect(gain1);
    gain1.connect(this.masterGain!);
    osc1.start(t);
    osc1.stop(t + 0.12);

    // Second beat (slightly softer)
    const t2 = t + 0.16;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(54, t2);
    osc2.frequency.exponentialRampToValueAtTime(30, t2 + 0.12);
    gain2.gain.setValueAtTime(0.65, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.13);
    osc2.connect(gain2);
    gain2.connect(this.masterGain!);
    osc2.start(t2);
    osc2.stop(t2 + 0.14);
  }

  public startHeartbeat(bpm = 88): void {
    if (this.heartbeatInterval !== null) return;
    const intervalMs = (60 / bpm) * 1000;
    this.playHeartbeatThump();
    this.heartbeatInterval = window.setInterval(() => {
      this.playHeartbeatThump();
    }, intervalMs);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Crisp UI click / zone selection
   */
  public playClick(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, t);
    osc.frequency.exponentialRampToValueAtTime(450, t + 0.03);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.04);
  }

  /**
   * Coin toss chime / spin
   */
  public playToss(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.linearRampToValueAtTime(2200, t + 0.4);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.5);
  }

  /**
   * Timeout warning buzzer
   */
  public playBuzzer(): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain!);

    osc.start(t);
    osc.stop(t + 0.32);
  }

  private playNoiseBurst(duration: number, lowFreq: number, highFreq: number, volume: number): void {
    const ctx = this.initCtx();
    if (!ctx || this.isMuted) return;

    const t = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime((lowFreq + highFreq) / 2, t);
    filter.Q.value = 1.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + duration);
  }
}

export const sound = new SoundManager();

