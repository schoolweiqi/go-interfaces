// Mandatory thinking pause before the next move.
// The timer is armed only when an opponent move has just been received/applied.
(() => {
  let timer = null;

  const controller = {
    enabled: false,
    delaySeconds: 5,
    lockedUntil: 0,

    setEnabled(value) {
      this.enabled = Boolean(value);
      if (!this.enabled) this.clear();
      this.emit();
    },

    setDelay(value) {
      const numeric = Number(value);
      this.delaySeconds = Math.max(0, Math.min(3600, Number.isFinite(numeric) ? Math.round(numeric) : 5));
      if (this.isLocked()) {
        this.lockedUntil = Date.now() + this.delaySeconds * 1000;
        this.scheduleUnlock();
      }
      this.emit();
    },

    arm() {
      if (!this.enabled || this.delaySeconds <= 0) {
        this.clear();
        return;
      }
      this.lockedUntil = Date.now() + this.delaySeconds * 1000;
      this.scheduleUnlock();
      this.emit();
    },

    clear() {
      this.lockedUntil = 0;
      if (timer) clearTimeout(timer);
      timer = null;
      this.emit();
    },

    isLocked() {
      return this.enabled && Date.now() < this.lockedUntil;
    },

    remainingSeconds() {
      if (!this.isLocked()) return 0;
      return Math.max(1, Math.ceil((this.lockedUntil - Date.now()) / 1000));
    },

    scheduleUnlock() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.lockedUntil = 0;
        this.emit();
      }, Math.max(0, this.lockedUntil - Date.now()) + 20);
    },

    emit() {
      window.dispatchEvent(new CustomEvent('move-pause-change', {
        detail: {
          enabled: this.enabled,
          delaySeconds: this.delaySeconds,
          locked: this.isLocked(),
          remainingSeconds: this.remainingSeconds()
        }
      }));
    }
  };

  window.movePause = controller;
})();
