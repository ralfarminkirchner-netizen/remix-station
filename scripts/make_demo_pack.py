#!/usr/bin/env python3
"""Erzeugt einen synthetisierten Demo-Pack (120 BPM) für die Soundbank."""
import os
import numpy as np
import wave

SR = 44100
BPM = 120
BEAT = 60.0 / BPM
BAR = 4 * BEAT
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'soundbank', 'Starter Pack')
os.makedirs(OUT, exist_ok=True)


def save(name, sig):
    sig = np.clip(sig, -1, 1)
    data = (sig * 32767).astype('<i2')
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f'  {name}  ({len(sig)/SR:.2f}s)')


def t(dur):
    return np.arange(int(SR * dur)) / SR


def kick(dur=0.35):
    x = t(dur)
    f = 150 * np.exp(-x * 18) + 45
    ph = np.cumsum(2 * np.pi * f / SR)
    s = np.sin(ph) * np.exp(-x * 12)
    s += 0.6 * np.sign(np.random.default_rng(1).standard_normal(len(x))) * np.exp(-x * 300) * 0.3
    return s * 0.95


def snare(dur=0.25):
    rng = np.random.default_rng(2)
    x = t(dur)
    n = rng.standard_normal(len(x)) * np.exp(-x * 22)
    tone = np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30)
    return (0.7 * n + 0.5 * tone) * 0.8


def clap(dur=0.3):
    rng = np.random.default_rng(3)
    x = t(dur)
    env = sum(np.exp(-np.maximum(x - d, 0) * 40) * (x >= d) for d in (0, 0.02, 0.045))
    return rng.standard_normal(len(x)) * env * 0.5


def hat(dur=0.08, open_=False):
    rng = np.random.default_rng(4)
    x = t(dur)
    n = rng.standard_normal(len(x))
    hp = np.diff(n, prepend=0)  # einfacher Hochpass
    return hp * np.exp(-x * (35 if open_ else 90)) * 0.6


def bass_note(freq, dur):
    x = t(dur)
    s = np.sin(2 * np.pi * freq * x) + 0.4 * np.sin(2 * np.pi * freq * 2 * x) + 0.2 * np.sin(2 * np.pi * freq * 3 * x)
    return s * np.exp(-x * 3) * 0.55


def pad_chord(freqs, dur):
    x = t(dur)
    s = np.zeros_like(x)
    for f in freqs:
        for det in (-4, 3):
            s += np.sin(2 * np.pi * (f + det * 0.15) * x + det)
    s /= (len(freqs) * 2)
    att = np.minimum(x / 0.4, 1.0)
    rel = np.clip((dur - x) / 0.5, 0, 1)
    lp = np.convolve(s, np.ones(400) / 400, mode='same')  # weichzeichnen
    return lp * att * rel * 1.4


def riser(dur=2.0):
    rng = np.random.default_rng(5)
    x = t(dur)
    n = rng.standard_normal(len(x))
    sweep = np.convolve(n, np.ones(int(50 + 4000 * x.mean())) / 1, mode='same')[: len(x)]
    tone = np.sin(2 * np.pi * (200 + 1800 * (x / dur) ** 2) * x)
    env = (x / dur) ** 1.5 * np.clip((dur - x) / 0.05, 0, 1)
    return (0.3 * sweep / np.max(np.abs(sweep) + 1e-9) + 0.4 * tone) * env * 0.7


def impact(dur=1.2):
    x = t(dur)
    f = 120 * np.exp(-x * 4) + 30
    s = np.sin(np.cumsum(2 * np.pi * f / SR)) * np.exp(-x * 4)
    rng = np.random.default_rng(6)
    s += rng.standard_normal(len(x)) * np.exp(-x * 60) * 0.5
    return s * 0.9


def perc(dur=0.12, freq=900):
    x = t(dur)
    return np.sin(2 * np.pi * freq * x) * np.exp(-x * 45) * 0.6


print('Loops (120 BPM):')
# Kick Loop: 4-to-the-floor, 1 Takt
kl = np.zeros(int(SR * BAR))
for i in range(4):
    k = kick()
    o = int(i * BEAT * SR)
    kl[o:o + len(k)] += k
save('kick loop 120bpm.wav', kl * 0.9)

# Hat Loop: 16tel, Offbeat-Akzente, 1 Takt
hl = np.zeros(int(SR * BAR))
for i in range(16):
    h = hat(0.16 if i % 4 == 2 else 0.06, open_=i % 4 == 2)
    o = int(i * BEAT / 4 * SR)
    hl[o:o + len(h)] += h * (1.0 if i % 2 else 0.55)
save('hats loop 120bpm.wav', hl * 0.8)

# Snare/Clap Loop: 2 & 4, 1 Takt
sl = np.zeros(int(SR * BAR))
for b, s in ((1, snare()), (3, clap())):
    o = int(b * BEAT * SR)
    sl[o:o + len(s)] += s
save('snare clap loop 120bpm.wav', sl * 0.85)

# Bass Loop: 8tel Bassline Am, 2 Takte
bl = np.zeros(int(SR * 2 * BAR))
notes = [55.0, 55.0, 65.41, 55.0, 82.41, 55.0, 65.41, 49.0] * 2  # A1-Pattern
for i, f in enumerate(notes):
    n = bass_note(f, BEAT / 2)
    o = int(i * BEAT / 2 * SR)
    bl[o:o + len(n)] += n
save('bass loop 120bpm.wav', bl * 0.85)

# Pad Loop: Am9 → F, 2 Takte
pl = np.zeros(int(SR * 2 * BAR))
am9 = pad_chord([220.0, 261.63, 329.63, 493.88], BAR)
fmaj = pad_chord([174.61, 220.0, 261.63, 329.63], BAR)
pl[: int(BAR * SR)] += am9
pl[int(BAR * SR): int(BAR * SR) + len(fmaj)] += fmaj
save('chords pad loop 120bpm.wav', pl * 0.7)

# Perc Loop: Synkopen, 1 Takt
pcl = np.zeros(int(SR * BAR))
for i, f in ((1, 900), (3, 700), (6, 1100), (10, 900), (11, 1300), (14, 700)):
    p = perc(0.12, f)
    o = int(i * BEAT / 4 * SR)
    pcl[o:o + len(p)] += p
save('perc loop 120bpm.wav', pcl * 0.8)

print('One-Shots:')
save('kick.wav', kick())
save('snare.wav', snare())
save('clap.wav', clap())
save('closed hat.wav', hat())
save('open hat.wav', hat(0.3, open_=True))
save('perc hit.wav', perc(0.15, 750))
save('fx riser.wav', riser())
save('fx impact.wav', impact())
print('Fertig.')
