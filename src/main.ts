import './style.css';
import { PenaltyApp } from './ui/app';

const appContainer = document.querySelector<HTMLElement>('#app');
if (appContainer) {
  new PenaltyApp(appContainer);
} else {
  console.error('App container #app not found in DOM');
}
