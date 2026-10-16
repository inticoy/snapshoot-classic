import { Game } from './core/Game';
import { loadCharacterAsset, loadMotionLibrary } from './entities/SkinnedPlayerModel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
overlay.innerHTML = '<div class="loading"><div class="loading-bar"><i></i></div><span>LOADING</span></div>';

// 동작 라이브러리가 없으면(로드 실패) 예전 코드 오버레이로 동작한다
await Promise.all([loadCharacterAsset('assets/models/player.glb'), loadMotionLibrary('assets/motions.json')]);
new Game(canvas).run();
