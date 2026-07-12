import { register } from 'node:module';

register('./three-loader.mjs', import.meta.url);
