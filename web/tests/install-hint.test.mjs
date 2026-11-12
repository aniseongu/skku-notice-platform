import test from 'node:test';
import assert from 'node:assert/strict';
import { installMode } from '../src/install-hint.ts';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';

test('이미 설치해 연 앱에서는 설치 안내를 보이지 않는다', () => {
  assert.equal(installMode(ANDROID, true, true), 'none');
  assert.equal(installMode(IOS_SAFARI, true, false), 'none');
});

test('브라우저가 설치 창을 줄 수 있으면 prompt', () => {
  assert.equal(installMode(ANDROID, false, true), 'prompt');
});

test('iOS Safari는 설치 창이 없어 홈 화면 추가 방법을 안내한다', () => {
  assert.equal(installMode(IOS_SAFARI, false, false), 'ios');
});

test('iOS의 다른 브라우저와 설치를 지원하지 않는 곳에서는 보이지 않는다', () => {
  assert.equal(installMode(IOS_CHROME, false, false), 'none');
  assert.equal(installMode(ANDROID, false, false), 'none');
});

test('삼성인터넷은 설치 창 신호가 없으면 메뉴 경로를 안내하고, 신호가 오면 설치 창을 쓴다', () => {
  assert.equal(installMode(SAMSUNG, false, false), 'samsung');
  assert.equal(installMode(SAMSUNG, false, true), 'prompt');
  assert.equal(installMode(SAMSUNG, true, false), 'none');
});
