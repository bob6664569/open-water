import { Wildlife } from './wildlife.js';
import { FishLife } from './fish.js';
import { Dolphins } from './dolphins.js';
import { Whales } from './whale.js';
import { Seabed } from './seabed.js';
import { Turtles } from './turtles.js';
import { Mantas } from './manta.js';
import { Birds } from './birds.js';
import { FaunaManager } from './fauna-manager.js';

const FAUNA_TYPES = {
  Wildlife,
  FishLife,
  Dolphins,
  Whales,
  Seabed,
  Turtles,
  Mantas,
  Birds,
};

export function createFaunaManager(dependencies) {
  return new FaunaManager(dependencies, FAUNA_TYPES);
}
