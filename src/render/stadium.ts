import type { Zone, OutcomeType } from '../types/game';

export interface RevealParams {
  shooterZone: Zone;
  keeperZone: Zone;
  outcome: OutcomeType;
  isFingertip: boolean;
  onImpact?: () => void;
  onComplete?: () => void;
}

interface Point2D {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity?: number;
}

export class StadiumRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width = 800;
  private height = 600;
  private dpr = 1;

  // Animation state
  private animationFrameId: number | null = null;
  private lastTime = 0;
  private stateTime = 0;

  // Game/Visual State
  private reducedMotion = false;
  private isHumanKeeper = false;
  private cameraShake = 0;
  private screenFlash = 0;

  // Tell animation
  private currentTellZone: Zone | null = null;

  // Reveal Animation
  private isRevealing = false;
  private revealProgress = 0; // 0 to 1
  private revealDuration = 1.1; // seconds
  private revealParams: RevealParams | null = null;
  private impactTriggered = false;

  // Net Bulge Physics
  private netBulge = { x: 0, y: 0, intensity: 0 };

  // Particles
  private particles: Particle[] = [];

  // Goal geometry cache in canvas pixels
  private goal = {
    left: 150,
    right: 650,
    top: 130,
    bottom: 390,
    depthOffset: 50,
  };

  // Ball & player positions
  private spotPos: Point2D = { x: 400, y: 490 };
  private ballPos: Point2D = { x: 400, y: 490 };
  private ballScale = 1.0;
  private ballRotation = 0;

  // Keeper state
  private keeperPos: Point2D = { x: 400, y: 360 };
  private keeperLean = 0; // -1 to 1

  // Shooter state
  private shooterPos: Point2D = { x: 400, y: 550 };
  private shooterLegSwing = 0;

  // Colors
  private shooterJerseyColor = '#EF4444';
  private keeperJerseyColor = '#3B82F6';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not get 2D canvas context');
    this.ctx = context;

    this.handleResize();
    window.addEventListener('resize', this.onWindowResize);
    this.startLoop();
  }

  private onWindowResize = () => {
    this.handleResize();
  };

  public destroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  public setNerve(_p1: number, _p2: number): void {
    // Nerve removed
  }

  public setPlayerColors(shooter: string, keeper: string): void {
    this.shooterJerseyColor = shooter;
    this.keeperJerseyColor = keeper;
  }

  public setIsHumanKeeper(isHuman: boolean): void {
    this.isHumanKeeper = isHuman;
  }

  public setTell(zone: Zone | null): void {
    this.currentTellZone = zone;
  }

  public handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(320, Math.floor(rect.width || 800));
    this.height = Math.max(260, Math.floor(rect.height || 600));

    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.resetTransform();
    this.ctx.scale(this.dpr, this.dpr);

    this.updateGeometry();
  }

  private updateGeometry(): void {
    const w = this.width;
    const h = this.height;

    // Responsive Goal calculations
    const goalWidth = Math.min(w * 0.72, 540);
    const goalHeight = Math.min(h * 0.45, 230);
    const centerX = w * 0.5;
    const goalTop = Math.max(h * 0.16, 50);

    this.goal = {
      left: centerX - goalWidth * 0.5,
      right: centerX + goalWidth * 0.5,
      top: goalTop,
      bottom: goalTop + goalHeight,
      depthOffset: Math.min(goalWidth * 0.12, 50),
    };

    this.spotPos = {
      x: centerX,
      y: Math.min(h * 0.86, this.goal.bottom + 120),
    };

    if (!this.isRevealing) {
      this.ballPos = { ...this.spotPos };
      this.ballScale = 1.0;
      this.keeperPos = {
        x: centerX,
        y: this.goal.bottom - 10,
      };
      this.shooterPos = {
        x: centerX + (w > 500 ? 30 : 20),
        y: this.spotPos.y + 40,
      };
    }
  }

  public resetToSpot(): void {
    this.isRevealing = false;
    this.revealProgress = 0;
    this.revealParams = null;
    this.impactTriggered = false;
    this.cameraShake = 0;
    this.screenFlash = 0;
    this.keeperLean = 0;
    this.shooterLegSwing = 0;
    this.currentTellZone = null;
    this.netBulge = { x: 0, y: 0, intensity: 0 };
    this.updateGeometry();
  }

  public startReveal(params: RevealParams): void {
    this.isRevealing = true;
    this.revealProgress = 0;
    this.revealParams = params;
    this.impactTriggered = false;
    this.keeperLean = 0;
    this.shooterLegSwing = 0;
    this.currentTellZone = null;
    this.updateGeometry();
  }

  public getZoneCoordinates(zone: Zone): Point2D {
    const { left, right, top, bottom } = this.goal;
    const w = right - left;
    const h = bottom - top;

    const xMap = {
      L: left + w * 0.18,
      C: left + w * 0.5,
      R: left + w * 0.82,
    };
    const yMap = {
      T: top + h * 0.28,
      B: top + h * 0.72,
    };

    const row = zone[0] as 'T' | 'B';
    const col = zone[1] as 'L' | 'C' | 'R';

    return {
      x: xMap[col],
      y: yMap[row],
    };
  }

  private startLoop(): void {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.update(dt);
      this.render();
      this.animationFrameId = requestAnimationFrame(frame);
    };
    this.animationFrameId = requestAnimationFrame(frame);
  }

  private update(dt: number): void {
    this.stateTime += dt;

    // Decay camera shake & screen flash
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 25);
    }
    if (this.screenFlash > 0) {
      this.screenFlash = Math.max(0, this.screenFlash - dt * 2.5);
    }

    // Net bulge spring return
    if (this.netBulge.intensity > 0) {
      this.netBulge.intensity = Math.max(0, this.netBulge.intensity - dt * 3.5);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
    }

    // Keep keeper completely upright and centered before shooting (zero tilt)
    if (!this.isRevealing) {
      this.keeperLean = 0;
    }

    // Reveal Animation
    if (this.isRevealing && this.revealParams) {
      // Slow-motion effect during fingertip saves or post clangs
      let timeRate = 1.0;
      if (!this.reducedMotion && this.revealParams.isFingertip && this.revealProgress > 0.45 && this.revealProgress < 0.75) {
        timeRate = 0.45; // slow-mo!
      }

      this.revealProgress += (dt * timeRate) / this.revealDuration;

      const p = Math.min(1, this.revealProgress);
      const targetZoneCoord = this.getZoneCoordinates(this.revealParams.shooterZone);

      // Shooter run up (0.0 to 0.25)
      if (p < 0.25) {
        const runP = p / 0.25;
        this.shooterPos.y = this.spotPos.y + 40 - runP * 35;
        this.shooterPos.x = this.spotPos.x + 20 - runP * 16;
        this.shooterLegSwing = Math.sin(runP * Math.PI) * 0.7;
      } else {
        this.shooterLegSwing = 0.8;
      }

      const shooterDir = this.revealParams.shooterZone.endsWith('L')
        ? 'left'
        : this.revealParams.shooterZone.endsWith('R')
        ? 'right'
        : 'middle';

      const keeperDir = this.revealParams.keeperZone.endsWith('L')
        ? 'left'
        : this.revealParams.keeperZone.endsWith('R')
        ? 'right'
        : 'middle';

      const isSaved = this.revealParams.outcome === 'save' || this.revealParams.outcome === 'fingertip_save';
      const goalW = this.goal.right - this.goal.left;
      const goalH = this.goal.bottom - this.goal.top;

      // Ball strike and flight (p: 0.25 to 0.75)
      if (p >= 0.25 && p < 0.75) {
        const flightP = (p - 0.25) / 0.5; // 0 to 1
        const easeFlight = flightP * (2 - flightP); // ease out

        // Spawn turf particles at ball strike
        if (p < 0.28 && this.particles.length === 0) {
          this.spawnTurfParticles();
        }

        let destX = this.spotPos.x;
        let destY = this.goal.top + goalH * 0.45;

        if (shooterDir === 'left') {
          destX = this.goal.left + goalW * 0.20;
          destY = this.goal.top + goalH * 0.42;
        } else if (shooterDir === 'right') {
          destX = this.goal.left + goalW * 0.80;
          destY = this.goal.top + goalH * 0.42;
        } else {
          destX = this.spotPos.x;
          destY = isSaved ? this.goal.bottom - 60 : this.goal.top + goalH * 0.38;
        }

        // Handle misses that go off target or hit the post
        if (this.revealParams.outcome === 'miss_off_target') {
          destY = this.goal.top - 60;
          destX = shooterDir === 'left' ? this.goal.left - 45 : shooterDir === 'right' ? this.goal.right + 45 : this.spotPos.x;
        } else if (this.revealParams.outcome === 'miss_post') {
          destX = shooterDir === 'left' ? this.goal.left : this.goal.right;
          destY = this.goal.top + 10;
        }

        // Parabolic arc (height elevation)
        const arcHeight = Math.sin(easeFlight * Math.PI) * 45;

        this.ballPos.x = this.spotPos.x + (destX - this.spotPos.x) * easeFlight;
        this.ballPos.y = this.spotPos.y + (destY - this.spotPos.y) * easeFlight - arcHeight;

        // Depth perspective scale: ball shrinks as it flies away
        this.ballScale = 1.0 - easeFlight * 0.38;
        this.ballRotation += dt * 18;
      }

      // Keeper Dive Timing:
      // While shooter runs up (p < 0.22), keeper is centered in ready position
      if (p < 0.22) {
        this.keeperLean = 0;
        this.keeperPos.x = this.spotPos.x;
        this.keeperPos.y = this.goal.bottom - 10;
      } else {
        const diveP = Math.min(1, (p - 0.22) / 0.45);
        const easeDive = 1 - Math.pow(1 - diveP, 3); // cubic ease out

        const startX = this.spotPos.x;
        const startY = this.goal.bottom - 10;

        let targetX = startX;
        let targetY = startY;
        let diveDirection = 0;

        if (keeperDir === 'left') {
          // Clean dive to the Left: moves left and body leans left
          targetX = this.goal.left + goalW * 0.28;
          targetY = startY - 14;
          diveDirection = -1;
        } else if (keeperDir === 'right') {
          // Clean dive to the Right: moves right and body leans right
          targetX = this.goal.left + goalW * 0.72;
          targetY = startY - 14;
          diveDirection = 1;
        } else {
          // Stay Center on screen: ZERO horizontal movement, ZERO tilt, just a ready hop!
          targetX = startX;
          targetY = startY - Math.sin(easeDive * Math.PI) * 12;
          diveDirection = 0;
        }

        this.keeperPos.x = startX + (targetX - startX) * easeDive;
        this.keeperPos.y = startY + (targetY - startY) * easeDive;
        this.keeperLean = diveDirection * easeDive * 0.95;
      }

      // Impact trigger at p = 0.72
      if (p >= 0.72 && !this.impactTriggered) {
        this.impactTriggered = true;
        if (this.revealParams.onImpact) {
          this.revealParams.onImpact();
        }

        if (this.revealParams.outcome === 'goal') {
          this.netBulge = {
            x: targetZoneCoord.x,
            y: targetZoneCoord.y,
            intensity: 1.0,
          };
          this.cameraShake = 5;
          this.spawnNetParticles(targetZoneCoord.x, targetZoneCoord.y);
        } else if (this.revealParams.outcome === 'save' || this.revealParams.outcome === 'fingertip_save') {
          this.cameraShake = 7;
          this.spawnSaveSparks(this.ballPos.x, this.ballPos.y);
        } else if (this.revealParams.outcome === 'miss_post') {
          this.cameraShake = 10;
          this.screenFlash = 0.5;
          this.spawnSaveSparks(this.ballPos.x, this.ballPos.y, '#FFE600');
        }
      }

      // After impact rebound (p >= 0.75)
      if (p >= 0.75) {
        if (this.revealParams.outcome === 'save' || this.revealParams.outcome === 'fingertip_save') {
          // Ball cleanly rebounds off keeper gloves
          this.ballPos.y += dt * 100;
          const bounceDir = keeperDir === 'left' ? -1 : keeperDir === 'right' ? 1 : 0;
          this.ballPos.x += bounceDir * dt * 80;
        } else if (this.revealParams.outcome === 'miss_post') {
          // Ricochet away violently
          this.ballPos.y += dt * 140;
          this.ballPos.x += (targetZoneCoord.x > this.spotPos.x ? 1 : -1) * dt * 160;
        }
      }

      // Complete
      if (this.revealProgress >= 1.0) {
        if (this.revealParams.onComplete) {
          const cb = this.revealParams.onComplete;
          this.revealParams.onComplete = undefined;
          cb();
        }
      }
    }
  }

  private spawnTurfParticles(): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < 18; i++) {
      this.particles.push({
        x: this.spotPos.x + (Math.random() * 14 - 7),
        y: this.spotPos.y + (Math.random() * 8 - 4),
        vx: (Math.random() - 0.5) * 160,
        vy: -Math.random() * 120 - 40,
        size: Math.random() * 3 + 2,
        color: Math.random() > 0.4 ? '#4ADE80' : '#22C55E',
        alpha: 1,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.3,
        gravity: 380,
      });
    }
  }

  private spawnNetParticles(x: number, y: number): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: x + (Math.random() * 16 - 8),
        y: y + (Math.random() * 16 - 8),
        vx: (Math.random() - 0.5) * 90,
        vy: (Math.random() - 0.5) * 90,
        size: Math.random() * 2.5 + 1.5,
        color: '#E2E8F0',
        alpha: 0.9,
        life: 0,
        maxLife: 0.5,
      });
    }
  }

  private spawnSaveSparks(x: number, y: number, color = '#00F0FF'): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 160;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 3.5 + 1.5,
        color,
        alpha: 1,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.25,
      });
    }
  }

  // --- RENDERING ---

  private render(): void {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();

    // Camera Shake
    if (this.cameraShake > 0 && !this.reducedMotion) {
      const shakeX = (Math.random() - 0.5) * this.cameraShake;
      const shakeY = (Math.random() - 0.5) * this.cameraShake;
      ctx.translate(shakeX, shakeY);
    }

    // 1. Stadium Sky & Floodlight Atmosphere
    this.drawSkyAndStadium(w, h);

    // 2. Pitch & Lines
    this.drawPitch(w, h);

    // 3. Goal Frame & Net Mesh
    this.drawGoalAndNet();

    // 4. Goalkeeper
    this.drawGoalkeeper();

    // 5. Ball & Shadow
    this.drawBall();

    // 6. Shooter (Foreground)
    this.drawShooter();

    // 7. Particles
    this.drawParticles();

    // 8. Low Nerve Tension Vignette & Screen Flash
    this.drawVignetteAndEffects(w, h);

    ctx.restore();
  }

  private drawSkyAndStadium(w: number, h: number): void {
    const ctx = this.ctx;

    // Dark stadium sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    skyGrad.addColorStop(0, '#060B14');
    skyGrad.addColorStop(0.6, '#0B1220');
    skyGrad.addColorStop(1, '#111D33');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h * 0.6);

    // Stadium crowd silhouette
    ctx.fillStyle = '#080E1A';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.38);
    for (let x = 0; x <= w; x += 30) {
      const wave = Math.sin((x + this.stateTime * 15) * 0.05) * 4;
      ctx.lineTo(x, h * 0.36 + wave);
    }
    ctx.lineTo(w, h * 0.55);
    ctx.lineTo(0, h * 0.55);
    ctx.closePath();
    ctx.fill();

    // Distant crowd specs / stadium flashlights
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 40; i++) {
      const px = (i * 37) % w;
      const py = h * 0.28 + ((i * 19) % Math.floor(h * 0.12));
      const pulse = 0.5 + 0.5 * Math.sin(this.stateTime * 3 + i);
      ctx.beginPath();
      ctx.arc(px, py, 1.2 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Floodlight Pylons (Left & Right)
    this.drawFloodlight(w * 0.1, h * 0.08, w * 0.45, h * 0.65);
    this.drawFloodlight(w * 0.9, h * 0.08, w * 0.55, h * 0.65);
  }

  private drawFloodlight(sourceX: number, sourceY: number, targetX: number, targetY: number): void {
    const ctx = this.ctx;

    // Radial beam
    const beamGrad = ctx.createRadialGradient(
      sourceX,
      sourceY,
      10,
      targetX,
      targetY,
      this.width * 0.6
    );
    beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    beamGrad.addColorStop(0.3, 'rgba(0, 240, 255, 0.07)');
    beamGrad.addColorStop(1, 'rgba(11, 18, 32, 0)');

    ctx.save();
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(sourceX - 25, sourceY);
    ctx.lineTo(targetX - 160, targetY + 120);
    ctx.lineTo(targetX + 160, targetY + 120);
    ctx.lineTo(sourceX + 25, sourceY);
    ctx.closePath();
    ctx.fill();

    // Glowing bulb source
    const flare = ctx.createRadialGradient(sourceX, sourceY, 0, sourceX, sourceY, 35);
    flare.addColorStop(0, '#FFFFFF');
    flare.addColorStop(0.3, 'rgba(200, 240, 255, 0.8)');
    flare.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPitch(w: number, h: number): void {
    const ctx = this.ctx;
    const horizon = h * 0.44;

    // Grass base
    const pitchGrad = ctx.createLinearGradient(0, horizon, 0, h);
    pitchGrad.addColorStop(0, '#102816');
    pitchGrad.addColorStop(0.3, '#14331C');
    pitchGrad.addColorStop(1, '#1A4325');
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Mowed lawn stripes (Perspective trapezoids)
    const stripeCount = 6;
    for (let i = 0; i < stripeCount; i++) {
      if (i % 2 === 0) continue;
      const topY = horizon + (i / stripeCount) * (h - horizon);
      const botY = horizon + ((i + 1) / stripeCount) * (h - horizon);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.fillRect(0, topY, w, botY - topY);
    }

    // Goal line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(this.goal.left - 40, this.goal.bottom);
    ctx.lineTo(this.goal.right + 40, this.goal.bottom);
    ctx.stroke();

    // 18-yard box markings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    // Perspective box lines
    ctx.moveTo(this.goal.left - 60, this.goal.bottom);
    ctx.lineTo(this.goal.left - 120, h * 0.95);
    ctx.moveTo(this.goal.right + 60, this.goal.bottom);
    ctx.lineTo(this.goal.right + 120, h * 0.95);
    ctx.stroke();

    // Penalty Spot
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(this.spotPos.x, this.spotPos.y, 6.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spot ring / chalk glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(this.spotPos.x, this.spotPos.y, 11, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawGoalAndNet(): void {
    const ctx = this.ctx;
    const { left, right, top, bottom, depthOffset } = this.goal;

    const backLeft = left + depthOffset;
    const backRight = right - depthOffset;
    const backTop = top - depthOffset * 0.5;
    const backBottom = bottom - depthOffset * 0.6;

    // Net rear frame shadows
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(backLeft, backBottom);
    ctx.lineTo(backRight, backBottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Net Mesh
    ctx.save();
    ctx.strokeStyle = 'rgba(230, 240, 255, 0.38)';
    ctx.lineWidth = 1.2;

    const cols = 20;
    const rows = 12;

    // Net horizontal rows
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const frontY = top + (bottom - top) * t;
      const backY = backTop + (backBottom - backTop) * t;

      ctx.beginPath();
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const frontX = left + (right - left) * u;
        const rearX = backLeft + (backRight - backLeft) * u;

        // Bulge interpolation
        let netX = frontX * 0.25 + rearX * 0.75;
        let netY = frontY * 0.25 + backY * 0.75;

        if (this.netBulge.intensity > 0) {
          const dist = Math.hypot(netX - this.netBulge.x, netY - this.netBulge.y);
          if (dist < 180) {
            const pull = (1 - dist / 180) * this.netBulge.intensity * 26;
            netY += pull * 0.5;
            netX += (netX > this.netBulge.x ? 1 : -1) * pull * 0.3;
          }
        }

        if (c === 0) ctx.moveTo(netX, netY);
        else ctx.lineTo(netX, netY);
      }
      ctx.stroke();
    }

    // Net vertical columns
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const frontX = left + (right - left) * u;
      const rearX = backLeft + (backRight - backLeft) * u;

      ctx.beginPath();
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const frontY = top + (bottom - top) * t;
        const backY = backTop + (backBottom - backTop) * t;

        let netX = frontX * 0.25 + rearX * 0.75;
        let netY = frontY * 0.25 + backY * 0.75;

        if (this.netBulge.intensity > 0) {
          const dist = Math.hypot(netX - this.netBulge.x, netY - this.netBulge.y);
          if (dist < 180) {
            const pull = (1 - dist / 180) * this.netBulge.intensity * 26;
            netY += pull * 0.5;
          }
        }

        if (r === 0) ctx.moveTo(netX, netY);
        else ctx.lineTo(netX, netY);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Goal Posts & Crossbar (Crisp 3D White Tubing)
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Back support bars (Dark grey)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(backLeft, backTop);
    ctx.lineTo(backLeft, backBottom);
    ctx.moveTo(right, top);
    ctx.lineTo(backRight, backTop);
    ctx.lineTo(backRight, backBottom);
    ctx.stroke();

    // Primary White Frame
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 7;
    ctx.beginPath();
    // Left post
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, top);
    // Crossbar
    ctx.lineTo(right, top);
    // Right post
    ctx.lineTo(right, bottom);
    ctx.stroke();

    // Frame Specular Highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(left - 1, bottom);
    ctx.lineTo(left - 1, top - 1);
    ctx.lineTo(right + 1, top - 1);
    ctx.lineTo(right + 1, bottom);
    ctx.stroke();

    ctx.restore();
  }

  private drawGoalkeeper(): void {
    const ctx = this.ctx;
    const { x, y } = this.keeperPos;
    const lean = this.keeperLean; // -1 to 1

    ctx.save();
    ctx.translate(x, y);

    // Keeper Shadow on pitch
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(lean * 15, 6, 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stance angle
    ctx.rotate(lean * 0.35);

    // Legs & Cleats
    ctx.fillStyle = '#0F172A';
    // Left leg
    ctx.fillRect(-15, -28, 8, 28);
    // Right leg
    ctx.fillRect(7, -28, 8, 28);
    // Neon boots
    ctx.fillStyle = '#FFE600';
    ctx.fillRect(-18, -4, 12, 6);
    ctx.fillRect(6, -4, 12, 6);

    // Shorts
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(-17, -42, 34, 18);

    // Goalkeeper Torso
    ctx.fillStyle = this.keeperJerseyColor;
    ctx.beginPath();
    ctx.moveTo(-18, -42);
    ctx.lineTo(-22, -80);
    ctx.lineTo(22, -80);
    ctx.lineTo(18, -42);
    ctx.closePath();
    ctx.fill();

    // Number 1 on keeper jersey
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -60);

    // Arms & Goalkeeper Gloves
    // In dive or tell, arms stretch out dynamically
    const armSpread = 34 + Math.abs(lean) * 15;
    const armElevation = -65 - Math.abs(lean) * 12;

    ctx.strokeStyle = this.keeperJerseyColor;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';

    // Left arm
    ctx.beginPath();
    ctx.moveTo(-18, -75);
    ctx.lineTo(-armSpread, armElevation);
    ctx.stroke();

    // Right arm
    ctx.beginPath();
    ctx.moveTo(18, -75);
    ctx.lineTo(armSpread, armElevation);
    ctx.stroke();

    // Neon Padded Goalkeeper Gloves
    ctx.fillStyle = '#00F0FF';
    ctx.beginPath();
    ctx.arc(-armSpread - 2, armElevation, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(armSpread + 2, armElevation, 8, 0, Math.PI * 2);
    ctx.fill();

    // Goalkeeper Head
    ctx.fillStyle = '#FBBF24'; // Stylized skin tone
    ctx.beginPath();
    ctx.arc(0, -90, 11, 0, Math.PI * 2);
    ctx.fill();

    // Tell visual indicator: Eyes darting or head tilting (AI keeper only)
    if (this.currentTellZone && !this.isRevealing && !this.isHumanKeeper) {
      const isLeft = this.currentTellZone.endsWith('L');
      const isRight = this.currentTellZone.endsWith('R');
      const eyeDir = isLeft ? -3.5 : isRight ? 3.5 : 0;
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-4 + eyeDir, -92, 3, 3);
      ctx.fillRect(2 + eyeDir, -92, 3, 3);
    }

    ctx.restore();
  }

  private drawShooter(): void {
    const ctx = this.ctx;
    const { x, y } = this.shooterPos;

    ctx.save();
    ctx.translate(x, y);

    // Shooter Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 22, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-12, -26, 7, 26);
    // Kicking leg with swing
    ctx.save();
    ctx.translate(6, -26);
    ctx.rotate(this.shooterLegSwing);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 7, 26);
    // Striker boot
    ctx.fillStyle = '#00F0FF';
    ctx.fillRect(-1, 22, 11, 6);
    ctx.restore();

    // Left boot
    ctx.fillStyle = '#00F0FF';
    ctx.fillRect(-15, -3, 11, 6);

    // Shorts
    ctx.fillStyle = '#334155';
    ctx.fillRect(-14, -38, 28, 16);

    // Striker Jersey
    ctx.fillStyle = this.shooterJerseyColor;
    ctx.beginPath();
    ctx.moveTo(-15, -38);
    ctx.lineTo(-18, -72);
    ctx.lineTo(18, -72);
    ctx.lineTo(15, -38);
    ctx.closePath();
    ctx.fill();

    // Striker Number 10
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10', 0, -54);

    // Head
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.arc(0, -82, 10, 0, Math.PI * 2);
    ctx.fill();

    // AI shooter tell (glances towards intended target zone)
    if (this.currentTellZone && !this.isRevealing && this.isHumanKeeper) {
      const isLeft = this.currentTellZone.endsWith('L');
      const isRight = this.currentTellZone.endsWith('R');
      const glanceDir = isLeft ? -3.5 : isRight ? 3.5 : 0;
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-3 + glanceDir, -84, 2.5, 2.5);
      ctx.fillRect(2 + glanceDir, -84, 2.5, 2.5);
    }

    ctx.restore();
  }

  private drawBall(): void {
    const ctx = this.ctx;
    const { x, y } = this.ballPos;
    const scale = this.ballScale;
    const baseRadius = 14;
    const r = baseRadius * scale;

    ctx.save();

    // Projected ground shadow underneath the ball
    const shadowY = this.spotPos.y + (this.goal.bottom - this.spotPos.y) * ((this.spotPos.y - y) / (this.spotPos.y - this.goal.top));
    const shadowScale = Math.max(0.3, scale);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, shadowY > y ? shadowY : y + 10, r * 1.3, r * 0.45 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(x, y);
    ctx.rotate(this.ballRotation);

    // Ball Base (Crisp 3D Shaded Sphere)
    const ballGrad = ctx.createRadialGradient(
      -r * 0.3,
      -r * 0.3,
      r * 0.1,
      0,
      0,
      r
    );
    ballGrad.addColorStop(0, '#FFFFFF');
    ballGrad.addColorStop(0.75, '#E2E8F0');
    ballGrad.addColorStop(1, '#94A3B8');

    ctx.fillStyle = ballGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Soccer Ball Pentagon Patches
    ctx.fillStyle = '#0F172A';
    // Center pentagon
    this.drawPentagon(ctx, 0, 0, r * 0.36);

    // Surrounding patches
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const px = Math.cos(angle) * r * 0.72;
      const py = Math.sin(angle) * r * 0.72;
      this.drawPentagon(ctx, px, py, r * 0.22, angle);
    }

    // Ball Outer Outline
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawPentagon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rotation = 0
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawVignetteAndEffects(w: number, h: number): void {
    const ctx = this.ctx;

    // Screen Flash on Post Hit (if any)
    if (this.screenFlash > 0 && !this.reducedMotion) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.screenFlash * 0.6})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
