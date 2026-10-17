import * as THREE from 'three';
import type { UserCommand } from '../gameplay/Match';

/** 빈 명령 하나 (검사·재생용) */
export function command(): UserCommand {
  const b = () => ({ held: false, pressed: false, released: false });
  return { move: new THREE.Vector3(), sprint: false, shoot: b(), pass: b(), through: b(), lob: b(), modifier: b(), finesse: b(), contain: b(), tackle: b() };
}
