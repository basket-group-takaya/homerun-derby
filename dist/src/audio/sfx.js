/**
 * All sound, synthesised. PROMPT.md 1 forbids fetching audio, so there are no
 * files here — every noise is built from oscillators and noise buffers.
 *
 * The bat crack is three layers stacked, not one sound:
 *   1. a ~2 ms broadband transient, high-passed. This is the "crack" itself and
 *      it is what tells the ear the collision was hard.
 *   2. a band-passed noise body around 700-1000 Hz decaying over ~70 ms. This is
 *      the wood ringing, and it is what makes it a BAT rather than a gunshot.
 *   3. a low sine thump near 150 Hz. This is what you feel rather than hear.
 * Contact quality only changes the mix and the filter cutoffs, so mishits and
 * middled balls are recognisably the same object being struck differently —
 * which is exactly what docs/REFERENCE-HB2.md 2-2 says the genre lives on.
 *
 * Nothing here reads or writes game state (PROMPT.md 2).
 */
const NOISE_SECONDS = 2;
export const createSfx = () => {
    let ctx = null;
    let master = null;
    let noise = null;
    let muted = false;
    const ensure = () => {
        if (ctx)
            return ctx;
        const Ctor = window.AudioContext
            ?? window.webkitAudioContext;
        if (!Ctor)
            return null;
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(ctx.destination);
        const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
        noise = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = noise.getChannelData(0);
        // slightly pink: a one-pole average of white noise. Pure white is hissy and
        // reads as digital; the low-frequency tilt is what makes a crowd a crowd.
        let last = 0;
        for (let i = 0; i < frames; i++) {
            const w = Math.random() * 2 - 1;
            last = last * 0.72 + w * 0.28;
            data[i] = w * 0.55 + last * 1.6;
        }
        return ctx;
    };
    const noiseSource = (c) => {
        const src = c.createBufferSource();
        if (noise)
            src.buffer = noise;
        src.loop = true;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        return src;
    };
    /** One shaped burst of noise. Returns when it will have finished. */
    const noiseBurst = (c, at, o) => {
        if (!master)
            return;
        const src = noiseSource(c);
        const filter = c.createBiquadFilter();
        filter.type = o.type;
        filter.frequency.setValueAtTime(o.freq, at);
        if (o.sweepTo !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), at + o.attack + o.decay);
        }
        filter.Q.value = o.q;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + o.attack);
        g.gain.exponentialRampToValueAtTime(0.0001, at + o.attack + o.decay);
        src.connect(filter);
        filter.connect(g);
        g.connect(master);
        src.start(at);
        src.stop(at + o.attack + o.decay + 0.02);
    };
    const tone = (c, at, o) => {
        if (!master)
            return;
        const osc = c.createOscillator();
        osc.type = o.type;
        osc.frequency.setValueAtTime(o.freq, at);
        if (o.to !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), at + o.attack + o.decay);
        }
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + o.attack);
        g.gain.exponentialRampToValueAtTime(0.0001, at + o.attack + o.decay);
        osc.connect(g);
        g.connect(master);
        osc.start(at);
        osc.stop(at + o.attack + o.decay + 0.02);
    };
    return {
        /** Browsers refuse to start audio without a gesture. Call from an input handler. */
        unlock() {
            const c = ensure();
            if (c && c.state === 'suspended')
                void c.resume();
        },
        setMuted(m) {
            muted = m;
            if (master)
                master.gain.value = m ? 0 : 0.85;
        },
        isMuted() { return muted; },
        isReady() { return ctx !== null && ctx.state === 'running'; },
        /**
         * Bat meets ball. `strength` in 0..1 scales loudness and brightness, so a
         * 160 km/h ball off the end of the bat and a 175 km/h one off the middle do
         * not sound the same even though both are "contact".
         */
        crack(quality, strength) {
            const c = ensure();
            if (!c)
                return;
            const t = c.currentTime + 0.001;
            const s = Math.min(1, Math.max(0, strength));
            // mix per quality: [transient, body, thump, body centre Hz, brightness Hz]
            const mix = {
                just: [0.62, 0.42, 0.50, 980, 5200],
                good: [0.42, 0.38, 0.40, 820, 3800],
                poor: [0.16, 0.30, 0.34, 520, 2000],
                jammed: [0.12, 0.34, 0.46, 380, 1400],
                foul: [0.46, 0.22, 0.20, 1250, 6000],
            };
            const m = mix[quality];
            const loud = 0.55 + 0.45 * s;
            // 1. the crack
            noiseBurst(c, t, {
                type: 'highpass', freq: m[4], q: 0.7,
                gain: m[0] * loud, attack: 0.0009, decay: 0.020,
            });
            // 2. the wood
            noiseBurst(c, t + 0.0008, {
                type: 'bandpass', freq: m[3], q: 2.4,
                gain: m[1] * loud, attack: 0.002, decay: quality === 'jammed' ? 0.11 : 0.070,
            });
            // 3. the thump
            tone(c, t, {
                type: 'sine', freq: 168, to: 96,
                gain: m[2] * loud * 0.7, attack: 0.003, decay: 0.10,
            });
            if (quality === 'just') {
                // a short bright ring on top: this is the part players chase
                tone(c, t + 0.001, {
                    type: 'triangle', freq: 1560, to: 900, gain: 0.16 * loud, attack: 0.002, decay: 0.13,
                });
            }
        },
        /** Bat through empty air. */
        whiff() {
            const c = ensure();
            if (!c)
                return;
            const t = c.currentTime + 0.001;
            noiseBurst(c, t, {
                type: 'bandpass', freq: 420, q: 1.1, sweepTo: 2600,
                gain: 0.22, attack: 0.055, decay: 0.085,
            });
        },
        /** Ball into the catcher's mitt on a taken pitch. */
        mitt() {
            const c = ensure();
            if (!c)
                return;
            const t = c.currentTime + 0.001;
            noiseBurst(c, t, { type: 'lowpass', freq: 1400, q: 0.9, gain: 0.30, attack: 0.001, decay: 0.055 });
            tone(c, t, { type: 'sine', freq: 132, to: 78, gain: 0.22, attack: 0.002, decay: 0.075 });
        },
        /** Ball landing in the seats or on the grass. */
        thud(homeRun) {
            const c = ensure();
            if (!c)
                return;
            const t = c.currentTime + 0.001;
            noiseBurst(c, t, {
                type: 'lowpass', freq: homeRun ? 900 : 620, q: 0.8,
                gain: homeRun ? 0.34 : 0.24, attack: 0.002, decay: 0.16,
            });
            tone(c, t, { type: 'sine', freq: 96, to: 52, gain: 0.28, attack: 0.004, decay: 0.20 });
        },
        /**
         * The crowd. `level` 0..1 sets how many people are shouting, `seconds` how
         * long it takes to die away. Two band-passed layers with different rates so
         * it churns rather than sitting still like a hiss.
         */
        crowd(level, seconds) {
            const c = ensure();
            if (!c || !master)
                return;
            const t = c.currentTime + 0.001;
            const v = Math.min(1, Math.max(0, level));
            for (const [freq, q, share, rate] of [
                [560, 0.9, 0.55, 0.85], [1500, 1.4, 0.30, 1.25],
            ]) {
                const src = noiseSource(c);
                src.playbackRate.value = rate;
                const filter = c.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = freq;
                filter.Q.value = q;
                const g = c.createGain();
                const peak = Math.max(0.0002, 0.30 * v * share);
                g.gain.setValueAtTime(0.0001, t);
                g.gain.exponentialRampToValueAtTime(peak, t + 0.10 + 0.20 * (1 - v));
                g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
                src.connect(filter);
                filter.connect(g);
                g.connect(master);
                src.start(t);
                src.stop(t + seconds + 0.05);
            }
        },
        /** UI tick. Used for telops and menu movement. */
        blip(freq = 880, gain = 0.10) {
            const c = ensure();
            if (!c)
                return;
            tone(c, c.currentTime + 0.001, {
                type: 'square', freq, to: freq * 1.5, gain, attack: 0.004, decay: 0.055,
            });
        },
        /** Rising fanfare for a milestone. Three notes, no samples. */
        fanfare() {
            const c = ensure();
            if (!c)
                return;
            const t0 = c.currentTime + 0.01;
            [0, 0.085, 0.17].forEach((d, i) => {
                tone(c, t0 + d, {
                    type: 'triangle', freq: [523.25, 659.25, 783.99][i] ?? 523.25,
                    gain: 0.17, attack: 0.006, decay: i === 2 ? 0.36 : 0.13,
                });
            });
        },
    };
};
//# sourceMappingURL=sfx.js.map