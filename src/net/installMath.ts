// 가장 먼저 import해 다른 모듈이 실행되기 전에 결정적 수학 함수로 바꿔 끼운다 (멀티플레이 락스텝)
import { installDeterministicMath } from './DetMath';

installDeterministicMath();
