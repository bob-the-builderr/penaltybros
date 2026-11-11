# ⚽ Penalty Bros

> **"A 1v1 penalty shootout of nerve and mind games. Pick a corner. Read your rival."**
> Skill is not twitch aiming. It is out-guessing the opponent under pressure.

Penalty Bros is a lightweight, responsive browser-based 1v1 penalty shootout game built from scratch with TypeScript, Vite, HTML5 Canvas 2D, and procedural Web Audio API.

---

## 🎮 Game Modes

1. **Quick Match vs AI**
   - **Rookie**: Casual exploration (~80% random), ignores history.
   - **Pro**: Tracks frequency of your past picks, mixes favored zones with adjacent coverage.
   - **Mind-Reader**: Detects patterns (repeats, alternating 2-cycles, post-save shifts), counter-reads your habits, and exploits predictable tendencies while maintaining ~20-25% unpredictability.
2. **Local 2-Player (Pass & Play)**
   - Turn-based hidden picks on a single device with a discrete "Pass the Device" screen so neither player can see the other's pick before the cinematic reveal.
3. **🌐 Online 1v1 Globally (PartyKit WebSockets)**
   - **Quick Match**: Instant matchmaking with any player online worldwide.
   - **Private Rooms**: 4-letter room codes (e.g. `PK42`) with 1-click shareable links (`?room=PK42`).
   - **Simultaneous Secret Commit-Reveal**: Neither player's pick is revealed to the rival until both have committed or the 10-second timer expires.
   - **Rematch System**: Quick rematch voting between matches.
   - **Disconnect Protection**: 15-second grace period with auto-forfeit if an opponent disconnects.

---

## 🧠 Core Gameplay (Penaltymen Style)

- **3 Options Only**:
  - **Left** (Dive Left)
  - **Center** (Stay)
  - **Right** (Dive Right)
- **1-Click Instant Action**:
  - Single tap or click immediately locks in your move — zero friction, no multi-step confirm dialogs.
- **Round Resolution**:
  - **Same Side**: Keeper saves it! (`SAVED`)
  - **Different Side**: Ball in the back of the net! (`GOAL`)
- **10-Second Countdown**:
  - 10 seconds per kick with tension warning in the final 3 seconds.
- **High-Stakes Momentum**:
  - When reaching match point, high-stakes banners trigger: **SCORE TO WIN** or **SAVE TO SURVIVE**.
  - Sudden death tie-breaking with sub-bass heartbeat audio.

---

## ⌨️ Controls & Accessibility

- **Keyboard Support**:
  - **Left**: `Left Arrow`, `A`, or `1`
  - **Center**: `Up Arrow`, `Spacebar`, `W`, or `2`
  - **Right**: `Right Arrow`, `D`, or `3`
  - **Close Modals**: `Escape` key
- **Touch & Mouse**:
  - 3 large responsive bottom buttons (Left / Center / Right) or direct click on the left, center, or right third of the goal canvas.
- **Color-Blind Friendly**:
  - Result indicators utilize distinct shapes and icons (`✓` for goal, `✗` for saved) in addition to colors.
- **Reduced Motion**:
  - Setting available to toggle off camera shake and flash effects.
- **Color-Blind Friendly**:
  - Result indicators utilize distinct shapes and icons (`✓` for goal, `✗` for miss/save) in addition to colors.
- **Reduced Motion**:
  - Setting available to toggle off camera shake and flash effects.

---

## 🔊 Procedural Web Audio API

Zero external audio files required! Synthesized purely via Web Audio API:
- **Ball Strike**: Deep pitch-drop kick thud + leather transient snap.
- **Net Bulge**: Bandpass filtered fluttering swoosh.
- **Post Clang**: Dual high-frequency metallic chime (840Hz & 1310Hz).
- **Keeper Dive**: Lowpass swept displacement whoosh.
- **Glove Slap**: Leather impact snap.
- **Referee Whistle**: Dual modulated sine waves with 32Hz vibrato.
- **Stadium Roar & Groan**: Multi-layered crowd swell and disappointed descending sigh.
- **Heartbeat**: 55Hz sub-bass double-thump.

---

## 🛠️ Tech Stack & Architecture

- **Language & Build**: TypeScript + Vite (Vanilla TS)
- **Rendering**: Procedural HTML5 Canvas 2D with 3D perspective goal, spring-bulge net physics, animated players, ball arc with ground shadow, and particle systems.
- **Bundle Size**: Under **80 kB** uncompressed (~21 kB gzipped), far below the 1 MB budget.

### Project Structure

```
penaltybros/
├── public/
│   ├── favicon.svg          # Procedural soccer ball SVG icon
│   └── og.png               # 1200x630 Open Graph preview image
├── src/
│   ├── types/
│   │   └── game.ts          # Core data models, zones, player state, resolutions
│   ├── logic/
│   │   ├── resolution.ts    # Corner miss chance, fingertip saves, nerve deltas
│   │   ├── clinch.ts        # Early clinch detection & sudden death logic
│   │   └── match.ts         # Match state machine, turn cycle, tells
│   ├── ai/
│   │   └── opponent.ts      # Rookie, Pro, and Mind-Reader AI models
│   ├── audio/
│   │   └── sound.ts         # Procedural Web Audio API sound synthesizer
│   ├── render/
│   │   └── stadium.ts       # Canvas 2D stadium, goal, net physics, keeper/shooter
│   ├── storage/
│   │   └── storage.ts       # localStorage settings & lifetime statistics
│   ├── ui/
│   │   └── app.ts           # Screen manager (title, toss, match, result, modals)
│   ├── tests/
│   │   └── game.test.ts     # Unit tests for round resolution, clinch, AI
│   ├── main.ts              # Entry point
│   └── style.css            # Responsive dark stadium styling
├── index.html               # Meta theme-color #0B1220 & OG tags
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- npm

### Installation
```bash
npm install
```

### Running Locally (Dev Server)
```bash
npm run dev
```
Open `http://localhost:5173` in your browser. You can play vs AI, Pass & Play, or open two tabs to test **Online 1v1** matchmaking and shareable room links!

### Running Tests
```bash
npm test
```

### Deploying to Vercel (100% Free, Zero Servers)
1. Push this project to GitHub.
2. In [Vercel](https://vercel.com), click **Add New Project** and import the repository.
3. Click **Deploy**.
4. In **Settings → Domains**, add your custom domain (`penaltybros.com`).

Everything (single-player, local 2-player, and global 1v1 online multiplayer) runs directly through Vercel with **zero external backend servers** to maintain or pay for!

