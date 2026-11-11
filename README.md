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

## 🧠 Mind-Game Mechanics

- **6-Zone Goal Grid**: Top/Bottom $\times$ Left/Center/Right (`TL`, `TC`, `TR`, `BL`, `BC`, `BR`).
- **Round Resolution**:
  - **Same Zone**: Guaranteed save (`SAVE!`).
  - **Different Zones**: Goal (`GOAL!`).
  - **High Corners (`TL` / `TR`)**: Aiming for top corners carries a miss risk (post clang or over the bar), which escalates under low Nerve.
  - **Adjacent Dive Fingertip Save**: A keeper diving into a zone adjacent to the shot has a chance to execute an acrobatic fingertip deflection.
- **Nerve Meter (0–100)**:
  - Drains on timeouts (-15), missed shots (-14), and conceded goals (-12).
  - Climbs on saves (+15) and goals scored (+12).
  - When Nerve drops below 30, the gauge turns red, shakes, screen vignette activates, and heartbeat audio pounds.
- **Tells & Glances**:
  - Before each kick, the rival exhibits subtle body language (leaning or glancing towards a zone).
  - Tells are ~60% honest.
- **Bluff / Feint (2 per match)**:
  - Activating a Feint tricks the rival by displaying a false lean or tell in the opposite direction.
- **Momentum & Streak Pressure**:
  - Dynamic UI banners celebrate streaks ("ON FIRE: 2 SAVES IN A ROW!", "ICE COLD: 3 GOALS!").
  - Entering Sudden Death dims the stadium into a tense heartbeat vignette.

---

## ⌨️ Controls & Accessibility

- **Keyboard Support**:
  - **Zone Selection**: Arrow keys (`Up` / `Down` / `Left` / `Right`) or number keys `1`–`6` or `Q-W-E` / `A-S-D`.
  - **Confirm Action**: `Space` or `Enter` (`SHOOT` / `DIVE`).
  - **Bluff / Feint**: `F` key.
  - **Close Modals**: `Escape` key.
- **Touch & Mouse**:
  - Touch targets minimum 48px, responsive layout from 360px portrait phones up to desktop.
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

#### Single-Player & Local Modes:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

#### Online 1v1 Multiplayer (PartyKit Local Dev):
Open two terminals:

**Terminal 1 (Multiplayer Edge WebSocket Server):**
```bash
npm run party:dev
```
Starts PartyKit server on `http://localhost:1999`.

**Terminal 2 (Vite Web App):**
```bash
npm run dev
```
Open `http://localhost:5173` in two browser tabs or windows to test instant 1v1 online matchmaking and private room code links!

### Deploying Globally

#### Deploying PartyKit Multiplayer Server:
```bash
npm run party:deploy
```
This deploys `party/server.ts` to Cloudflare Workers edge nodes globally via PartyKit.

#### Building Client Web App:
```bash
npm run build
```
Generates production build in `dist/` (ready to host on Vercel, Netlify, GitHub Pages, or Cloudflare Pages). Pass `VITE_PARTYKIT_HOST=<your-partykit-subdomain>.partykit.dev` if hosting the frontend on a separate domain.

