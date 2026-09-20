import { createInstance, type i18n } from 'i18next';

import { gameResources } from './game-resources';

export const gameI18n: i18n = createInstance();

void gameI18n.init({
  resources: gameResources,
  lng: 'ko',
  fallbackLng: 'ko',
  ns: ['game'],
  defaultNS: 'game',
  initAsync: false,
  interpolation: { escapeValue: false },
});
