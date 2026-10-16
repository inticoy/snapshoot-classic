import { Game } from './core/Game';
import { loadCharacterAsset, loadMotionLibrary } from './entities/SkinnedPlayerModel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
overlay.innerHTML = '<div class="loading"><div class="loading-bar"><i></i></div><span>LOADING</span></div>';

// 동작 라이브러리가 없으면(로드 실패) 예전 코드 오버레이로 동작한다
await Promise.all([loadCharacterAsset('assets/models/player.glb'), loadMotionLibrary('assets/motions.json')]);
// 개발 페이지도 별도 시뮬레이터 없이 본 경기의 입력·루프·카메라를 사용한다.
const Playground = import.meta.env.DEV && new URLSearchParams(location.search).has('playground')
  ? (await import('./playground/Playground')).Playground : undefined;
new Game(canvas, { playground: Playground }).run();
