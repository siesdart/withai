import type { gameResources } from './game-resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'game';
    resources: typeof gameResources.en;
  }
}
