export class BoatHud {
  constructor(speedElement, throttleElement, rudderElement) {
    this.speedElement = speedElement;
    this.throttleElement = throttleElement;
    this.rudderElement = rudderElement;
    this.speedText = null;
    this.throttleWidth = null;
    this.reverse = null;
    this.rudderLeft = null;
    this.rudderElement.style.width = '4px';
  }

  update(speedKn, throttle, wheel) {
    const speedText = speedKn.toFixed(1);
    if (speedText !== this.speedText) {
      this.speedText = speedText;
      this.speedElement.textContent = speedText;
    }

    const throttleWidth = `${Math.abs(throttle) * 100}%`;
    if (throttleWidth !== this.throttleWidth) {
      this.throttleWidth = throttleWidth;
      this.throttleElement.style.width = throttleWidth;
    }

    const reverse = throttle < 0;
    if (reverse !== this.reverse) {
      this.reverse = reverse;
      this.throttleElement.classList.toggle('reverse', reverse);
    }

    const rudderLeft = `${(0.5 + wheel * 0.5) * 136}px`;
    if (rudderLeft !== this.rudderLeft) {
      this.rudderLeft = rudderLeft;
      this.rudderElement.style.marginLeft = rudderLeft;
    }
  }
}
