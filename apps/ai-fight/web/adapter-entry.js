import {installOriginalTransport} from './transport.js';
await installOriginalTransport();
await import('./js/app.js');
