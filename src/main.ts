import { Game } from './core/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
new Game(canvas).run();
