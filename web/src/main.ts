import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createComponent } from '@lit/react';
import { NoticeApp } from './notice-app';
import { registerSW } from 'virtual:pwa-register';

// The React root keeps the existing screen available while it is migrated piece by piece.
const LegacyNoticeApp = createComponent({ react: React, tagName: 'notice-app', elementClass: NoticeApp });
const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing');
createRoot(root).render(React.createElement(LegacyNoticeApp));

registerSW({ immediate: true });
