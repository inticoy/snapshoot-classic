import './net/installMath';
import { Game } from './core/Game';
import { NetSession } from './net/NetSession';
import { loadCharacterAsset, loadMotionLibrary } from './entities/SkinnedPlayerModel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
overlay.innerHTML = '<div class="loading"><div class="loading-bar"><i></i></div><span>LOADING</span></div>';

// 동작 라이브러리가 없으면(로드 실패) 예전 코드 오버레이로 동작한다
await Promise.all([loadCharacterAsset('assets/models/player.glb'), loadMotionLibrary('assets/motions.json')]);
// 개발 페이지도 별도 시뮬레이터 없이 본 경기의 입력·루프·카메라를 사용한다.
const Playground = new URLSearchParams(location.search).has('playground')
  ? (await import('./playground/Playground')).Playground : undefined;
// 온라인 1:1: ?room=코드 (없으면 ?online 으로 방을 만든다). 중계 서버는 ?relay= (기본: 로컬 개발 서버)
const params = new URLSearchParams(location.search);
// 기본 중계 서버: Cloudflare Workers (server/). 로컬 개발 서버는 &relay=http://127.0.0.1:8787
const relay = params.get('relay') ?? 'https://snapshoot-relay.woojoo.workers.dev';
if (params.has('online') && !params.get('room')) {
  const code = await NetSession.createRoom(relay);
  params.set('room', code);
  params.delete('online');
  location.search = params.toString();
} else if (params.get('room')) {
  const session = new NetSession(relay, params.get('room')!.toUpperCase());
  const link = `${location.origin}${location.pathname}?room=${session.code}`;
  const status = (text: string) => {
    overlay.innerHTML = `<div class="online-wait"><b>온라인 대전</b><span>${text}</span>
      <div class="code">${session.code}</div>
      <button type="button" id="copy-room">초대 링크 복사</button><small>${link}</small></div>`;
    overlay.querySelector('#copy-room')?.addEventListener('click', () => void navigator.clipboard?.writeText(link));
  };
  status('중계 서버 접속 중');
  const start = await session.connect(status).catch(() => {
    status('중계 서버에 접속하지 못했어요. 새로고침해 주세요');
    throw new Error('relay unavailable');
  });
  overlay.innerHTML = '';
  const game = new Game(canvas, { online: { session, start } });
  game.run();
  game.startOnline();
} else {
  new Game(canvas, { playground: Playground }).run();
}
