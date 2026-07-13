export class FaunaManager {
  constructor({ scene, camera, waveField, boat, audio }, types) {
    this.wildlife = new types.Wildlife(scene, camera, waveField, audio);
    this.fish = new types.FishLife(scene, camera, waveField, boat);
    this.dolphins = new types.Dolphins(scene, camera, waveField, boat);
    this.whales = new types.Whales(scene, camera, waveField);
    this.seabed = new types.Seabed(scene, camera, waveField, boat);
    this.turtles = new types.Turtles(scene, camera, waveField, boat);
    this.mantas = new types.Mantas(scene, camera, waveField, boat);
    this.birds = new types.Birds(scene, camera, waveField, audio);

    this.achievementSources = {
      dolphins: this.dolphins,
      whales: this.whales,
      turtles: this.turtles,
      mantas: this.mantas,
      fish: this.fish,
    };
  }

  setPerformanceBudget(quality) {
    this.seabed.setPerformanceBudget(quality);
  }

  update(dt) {
    this.wildlife.update(dt);
    this.fish.update(dt);
    this.dolphins.update(dt);
    this.whales.update(dt);
    this.seabed.update(dt);
    this.turtles.update(dt);
    this.mantas.update(dt);
    this.birds.update(dt);
  }
}
