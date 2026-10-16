import { Game } from './core/Game';
import { loadCharacterAsset } from './entities/SkinnedPlayerModel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
overlay.innerHTML = '<div class="loading"><div class="loading-bar"><i></i></div><span>LOADING</span></div>';

await loadCharacterAsset('assets/models/player.glb');
new Game(canvas).run();
