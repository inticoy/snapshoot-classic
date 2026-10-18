/**
 * 온라인 대전 화면 (경기 시작 전): 빠른 매칭 검색 · 코드 입력 · 방 대기 · 접속 중 · 오류.
 * 게임(Game)이 만들어지기 전에 #overlay에 그린다. 모든 상태에 '취소'가 있어 처음 화면으로 돌아갈 수 있다.
 */
export type OnlineView =
  | { kind: 'searching' }
  | { kind: 'join'; error?: string }
  | { kind: 'room'; code: string; text: string }
  | { kind: 'connecting'; text: string }
  | { kind: 'error'; text: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class OnlineScreen {
  /** 코드 입력에서 '입장'을 누르면 */
  onJoin: (code: string) => void = () => {};

  constructor(private readonly root: HTMLElement) {}

  show(view: OnlineView): void {
    const body = (() => {
      switch (view.kind) {
        case 'searching':
          return `<p class="ol-status"><i class="ol-spin"></i>상대를 찾는 중…</p><p class="ol-hint">비슷한 시간에 빠른 매칭을 누른 사람과 연결돼요</p>`;
        case 'join':
          return `<form class="ol-join"><label for="ol-code">방 코드 6자리</label>
            <input id="ol-code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="ABC123">
            ${view.error ? `<p class="ol-error">${esc(view.error)}</p>` : ''}
            <button type="submit" class="ol-primary">입장</button></form>`;
        case 'room': {
          const link = `${location.origin}${location.pathname}?room=${view.code}`;
          return `<p class="ol-status"><i class="ol-spin"></i>${esc(view.text)}</p>
            <div class="ol-code" aria-label="방 코드">${esc(view.code)}</div>
            <button type="button" class="ol-primary" data-copy="${esc(link)}">초대 링크 복사</button>
            <p class="ol-link">${esc(link)}</p>`;
        }
        case 'connecting':
          return `<p class="ol-status"><i class="ol-spin"></i>${esc(view.text)}</p>`;
        case 'error':
          return `<p class="ol-error">${esc(view.text)}</p>`;
      }
    })();
    this.root.innerHTML = `<section class="ol-card" role="dialog" aria-label="온라인 대전">
      <h1 class="ol-title">온라인 대전</h1>${body}
      <button type="button" class="ol-cancel">${view.kind === 'error' ? '처음 화면으로' : '취소'}</button></section>`;
    this.root.querySelector('.ol-cancel')!.addEventListener('click', () => { location.search = ''; });
    const copy = this.root.querySelector<HTMLButtonElement>('[data-copy]');
    copy?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(copy.dataset.copy!); copy.textContent = '복사했어요'; } catch { copy.textContent = '링크를 길게 눌러 복사하세요'; }
    });
    const form = this.root.querySelector<HTMLFormElement>('.ol-join');
    if (form) {
      const input = form.querySelector<HTMLInputElement>('#ol-code')!;
      input.focus();
      input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (/^[A-Z0-9]{6}$/.test(input.value)) this.onJoin(input.value);
        else this.show({ kind: 'join', error: '6자리 코드를 입력해 주세요' });
      });
    }
  }

  clear(): void {
    this.root.innerHTML = '';
  }
}
