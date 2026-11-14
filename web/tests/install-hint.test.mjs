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
  assert.equal(installMode(IOS_CHROME, false, false), 'ios-browser');
  assert.equal(installMode(ANDROID, false, false), 'none');
});

test('삼성인터넷은 설치 창 신호가 없으면 메뉴 경로를 안내하고, 신호가 오면 설치 창을 쓴다', () => {
  assert.equal(installMode(SAMSUNG, false, false), 'samsung');
  assert.equal(installMode(SAMSUNG, false, true), 'prompt');
  assert.equal(installMode(SAMSUNG, true, false), 'none');
});

const UA = {
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  operaAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/80.0.0.0',
  whaleAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Whale/3.0.0.0',
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36;KAKAOTALK 2510000',
  naverAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)',
  instaIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 330.0.0.0 (iPhone14,5)',
  kakaoIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.0.0',
  edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0 Mobile/15E148 Safari/605.1.15',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
  ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

test('브라우저별 메뉴 안내 모드', () => {
  assert.equal(installMode(IOS_CHROME, false, false), 'ios-browser');
  assert.equal(installMode(UA.edgeIos, false, false), 'ios-browser');
  assert.equal(installMode(UA.firefoxIos, false, false), 'ios-open-safari');
  assert.equal(installMode(UA.ipadSafari, false, false), 'ios');
  assert.equal(installMode(UA.firefoxAndroid, false, false), 'firefox');
  assert.equal(installMode(UA.edgeAndroid, false, false), 'menu');
  assert.equal(installMode(UA.operaAndroid, false, false), 'menu');
  assert.equal(installMode(UA.whaleAndroid, false, false), 'menu');
  assert.equal(installMode(UA.desktop, false, false), 'none');
});

test('앱 속 브라우저는 OS와 상관없이 다른 브라우저로 열기를 안내한다', () => {
  for (const ua of [UA.kakaoAndroid, UA.naverAndroid, UA.instaIos, UA.kakaoIos]) assert.equal(installMode(ua, false, false), 'in-app');
});

test('설치 창 신호가 오면 어느 브라우저든 prompt가 먼저다', () => {
  for (const ua of Object.values(UA)) assert.equal(installMode(ua, false, true), 'prompt');
});

test('설치 배너: 처음엔 보이고, 한 번 닫으면 14일 쉬고, 두 번 닫으면 끝', async () => {
  const { installBannerDue, installBannerDismissed } = await import('../src/install-hint.ts');
  const day = 24 * 60 * 60 * 1000;
  assert.equal(installBannerDue(null, 0), true);
  const once = installBannerDismissed(null, 1000);
  assert.equal(once, '1:1000');
  assert.equal(installBannerDue(once, 1000 + 13 * day), false);
  assert.equal(installBannerDue(once, 1000 + 14 * day), true);
  assert.equal(installBannerDue(installBannerDismissed(once, 5), 5 + 99 * day), false);
  assert.equal(installBannerDue('깨짐', 0), false);
});
