import './net/installMath';
import { Game } from './core/Game';
import { NetSession } from './net/NetSession';
import { OnlineScreen } from './ui/OnlineScreen';
import { settings } from './core/Settings';
import { loadCharacterAsset, loadMotionLibrary } from './entities/SkinnedPlayerModel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
overlay.innerHTML = '<div class="loading"><div class="loading-bar"><i></i></div><span>LOADING</span></div>';

// 동작 라이브러리가 없으면(로드 실패) 예전 코드 오버레이로 동작한다
await Promise.all([loadCharacterAsset('assets/models/player.glb'), loadMotionLibrary('assets/motions.json')]);
// 개발 페이지도 별도 시뮬레이터 없이 본 경기의 입력·루프·카메라를 사용한다.
const Playground = new URLSearchParams(location.search).has('playground')
  ? (await import('./playground/Playground')).Playground : undefined;
// 온라인 1:1: ?quick 빠른 매칭 · ?online 방 만들기 · ?join 코드 입력 · ?room=코드 입장. 중계 서버는 ?relay= (기본: Cloudflare)
const params = new URLSearchParams(location.search);
// 기본 중계 서버: Cloudflare Workers (server/). 로컬 개발 서버는 &relay=http://127.0.0.1:8787
const relay = params.get('relay') ?? 'https://snapshoot-relay.woojoo.workers.dev';
const goRoom = (code: string) => {
  const next = new URLSearchParams();
  next.set('room', code);
  if (params.get('relay')) next.set('relay', params.get('relay')!);
  location.replace(`${location.pathname}?${next}`);
};
const online = params.has('quick') || params.has('online') || params.has('join') || !!params.get('room');
if (online) {
  overlay.innerHTML = '';
  const screen = new OnlineScreen(overlay);
  const fail = (text: string) => screen.show({ kind: 'error', text });
  if (params.has('quick')) {
    screen.show({ kind: 'searching' });
    NetSession.quickMatch(relay).then(goRoom, () => fail('매칭 서버에 접속하지 못했어요. 잠시 뒤 다시 시도해 주세요'));
  } else if (params.has('online')) {
    screen.show({ kind: 'connecting', text: '방을 만드는 중' });
    NetSession.createRoom(relay).then(goRoom, () => fail('방을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요'));
  } else if (params.has('join')) {
    screen.onJoin = goRoom;
    screen.show({ kind: 'join' });
  } else {
    const code = params.get('room')!.toUpperCase();
    const session = new NetSession(relay, code);
    // 내 설정: 보정은 내 팀에만, 경기 시간·승부차기·물리는 방장(팀 0) 것이 양쪽에 쓰인다
    const prefs = { pass: settings.passAssist, shot: settings.shotAssist, move: settings.moveAssist, duration: settings.duration, shootout: settings.shootout, physics: settings.physicsPreset };
    screen.show({ kind: 'connecting', text: '중계 서버 접속 중' });
    session.connect(prefs, (text) => screen.show(text.includes('기다리는') ? { kind: 'room', code, text: '상대를 기다리는 중' } : { kind: 'connecting', text }))
      .then((start) => {
        screen.clear();
        const game = new Game(canvas, { online: { session, start } });
        game.run();
        game.startOnline();
      }, () => fail('방에 들어가지 못했어요. 코드를 확인하거나 방이 이미 찼는지 확인해 주세요'));
  }
} else {
  new Game(canvas, { playground: Playground }).run();
}
