import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './notice-app';
import { registerSW } from 'virtual:pwa-register';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing');
root.append(document.createElement('notice-app'));

registerSW({ immediate: true });
